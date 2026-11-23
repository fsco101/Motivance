"""Isolated checks for the Google sign-in setup: validation, secret redaction, the redirect merge and the read-back."""
import contextlib
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import configure_google_sign_in as google

CLIENT='123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com'


class GoogleSignInConfigurationTest(unittest.TestCase):
    def settings(self):
        return dict(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=CLIENT,SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET='fixture-client-secret',
            SUPABASE_PROJECT_REF='a'*20,SUPABASE_ACCESS_TOKEN='private-pat',PUBLIC_SITE_URL='https://motivance.example/')

    def hosted_state(self,**changes):
        state={'external_google_enabled':False,'external_google_client_id':'','external_google_skip_nonce_check':False,
            'uri_allow_list':'https://motivance.example/reset'}
        state.update(changes)
        return state

    def run_main(self,args,settings,responses):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'.env'
            path.write_text('\n'.join(k+'='+v for k,v in settings.items()),encoding='utf-8')
            output=io.StringIO()
            with patch.dict(google.os.environ,{},clear=True), patch.object(google,'api',side_effect=responses) as api, contextlib.redirect_stdout(output):
                google.main(args+['--env-file',str(path)])
            return api,output.getvalue()

    def test_preview_reads_only_and_never_prints_secrets(self):
        api,output=self.run_main(['--target','hosted'],self.settings(),[self.hosted_state()])
        self.assertEqual(api.call_count,1)
        self.assertEqual(len(api.call_args.args),1,'A preview only reads')
        self.assertIn(CLIENT,output)
        self.assertNotIn('fixture-client-secret',output);self.assertNotIn('private-pat',output)

    def test_apply_keeps_existing_redirects_and_reads_back(self):
        applied=self.hosted_state(external_google_enabled=True,external_google_client_id=CLIENT,uri_allow_list='https://motivance.example/reset,https://motivance.example/**')
        api,output=self.run_main(['--target','hosted','--apply'],self.settings(),[self.hosted_state(),{},applied])
        payload=api.call_args_list[1].args[1]
        self.assertEqual(payload['uri_allow_list'],'https://motivance.example/reset,https://motivance.example/**')
        self.assertTrue(payload['external_google_enabled']);self.assertFalse(payload['external_google_skip_nonce_check'])
        self.assertEqual(payload['external_google_client_id'],CLIENT)
        self.assertNotIn('fixture-client-secret',output)

    def test_apply_fails_when_read_back_differs(self):
        wrong=self.hosted_state(external_google_enabled=True,external_google_client_id='other',uri_allow_list='https://motivance.example/**')
        with self.assertRaises(google.ConfigurationError) as raised:
            self.run_main(['--target','hosted','--apply'],self.settings(),[self.hosted_state(),{},wrong])
        self.assertIn('client ID',str(raised.exception))

    def test_skipped_nonce_check_is_reported(self):
        skipped=self.hosted_state(external_google_enabled=True,external_google_client_id=CLIENT,external_google_skip_nonce_check=True,uri_allow_list='https://motivance.example/**')
        with self.assertRaises(google.ConfigurationError) as raised:
            self.run_main(['--target','hosted','--apply'],self.settings(),[self.hosted_state(),{},skipped])
        self.assertIn('nonce',str(raised.exception))

    def test_redirect_merge_does_not_duplicate(self):
        self.assertEqual(google.redirects('https://motivance.example/**',self.settings()),'https://motivance.example/**')
        self.assertEqual(google.redirects('',self.settings()),'https://motivance.example/**')

    def test_invalid_values_fail_before_network(self):
        for key,value in [('SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID','not-a-client'),('SUPABASE_PROJECT_REF','../other'),('PUBLIC_SITE_URL','http://insecure.example')]:
            settings=self.settings();settings[key]=value
            with self.assertRaises(google.ConfigurationError): google.validate(settings,'hosted')
        settings=self.settings();settings['SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET']=''
        google.validate(settings,'hosted')
        with self.assertRaises(google.ConfigurationError): google.validate(settings,'hosted',apply=True)

    def test_local_apply_is_refused(self):
        with self.assertRaises(google.ConfigurationError): google.main(['--target','local','--apply'])

    def test_local_read_back_explains_a_missing_client_id(self):
        env={'GOTRUE_EXTERNAL_GOOGLE_ENABLED':'true','GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID':'env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)',
            'GOTRUE_EXTERNAL_GOOGLE_SECRET':'env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)','GOTRUE_EXTERNAL_GOOGLE_SKIP_NONCE_CHECK':'false',
            'GOTRUE_URI_ALLOW_LIST':'http://localhost:3000/**,http://127.0.0.1:3000/**'}
        with patch.object(google,'local_auth_environment',return_value=env), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(google.ConfigurationError) as raised: google.local(self.settings())
        self.assertIn('restart',str(raised.exception))
        env.update(GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID=CLIENT,GOTRUE_EXTERNAL_GOOGLE_SECRET='fixture-client-secret')
        output=io.StringIO()
        with patch.object(google,'local_auth_environment',return_value=env), contextlib.redirect_stdout(output): google.local(self.settings())
        self.assertNotIn('fixture-client-secret',output.getvalue())

    def test_config_toml_keeps_secret_out_and_nonce_check_on(self):
        config=(google.ROOT/'supabase/config.toml').read_text(encoding='utf-8')
        block=config.split('[auth.external.google]')[1].split('\n[')[0]
        self.assertIn('secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"',block)
        self.assertIn('client_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"',block)
        self.assertIn('skip_nonce_check = false',block)
        for redirect in google.LOCAL_REDIRECTS: self.assertIn(redirect,config)


if __name__=='__main__':
    unittest.main()
