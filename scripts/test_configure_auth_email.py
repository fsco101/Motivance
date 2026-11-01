"""Isolated configuration, secret-redaction and rollback checks; no external mail."""
import contextlib
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

import configure_auth_email as email


class AuthEmailConfigurationTest(unittest.TestCase):
    def settings(self):
        return dict(SMTP_HOST='smtp.gmail.com', SMTP_PORT='587',
                    SMTP_USER='fixture@gmail.com', SMTP_PASS='secret app password',
                    SMTP_FROM_EMAIL='fixture@gmail.com', SMTP_SENDER_NAME='Motivance',
                    SUPABASE_PROJECT_REF='a' * 20, SUPABASE_ACCESS_TOKEN='private-pat')

    def test_preview_does_not_authenticate_or_mutate_backend(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'.env'
            path.write_text('\n'.join(k+'='+v for k,v in self.settings().items()),encoding='utf-8')
            output=io.StringIO()
            with patch.dict(email.os.environ,{},clear=True), patch.object(email,'api') as api, patch.object(email,'check_smtp') as smtp, patch.object(email,'apply_local') as local, contextlib.redirect_stdout(output):
                email.main(['--target','hosted','--env-file',str(path)])
            api.assert_not_called();smtp.assert_not_called();local.assert_not_called()
            self.assertNotIn('secret',output.getvalue())
            self.assertNotIn('private-pat',output.getvalue())
            self.assertNotIn('fixture@gmail.com',output.getvalue())

    def test_missing_secrets_and_invalid_project_fail_before_network(self):
        settings=self.settings();settings['SMTP_PASS']=''
        with self.assertRaises(email.ConfigurationError): email.validate(settings,'hosted',secrets=True)
        settings=self.settings();settings['SUPABASE_PROJECT_REF']='../other'
        with self.assertRaises(email.ConfigurationError): email.validate(settings,'hosted')

    def test_gmail_requires_matching_sender_and_normalizes_app_password(self):
        settings=self.settings();email.validate(settings,'local',secrets=True)
        self.assertEqual('secretapppassword',settings['SMTP_PASS'])
        settings['SMTP_FROM_EMAIL']='other@gmail.com'
        with self.assertRaises(email.ConfigurationError): email.validate(settings,'local')

    def test_hosted_requires_confirmation_and_code_templates_for_both_flows(self):
        payload=email.hosted_payload(self.settings())
        self.assertFalse(payload['mailer_autoconfirm'])
        self.assertEqual(6,payload['mailer_otp_length'])
        self.assertEqual(600,payload['mailer_otp_exp'])
        for kind in ('confirmation','recovery'):
            self.assertIn('{{ .Token }}',payload['mailer_templates_'+kind+'_content'])

    def test_local_restart_failure_restores_original_config_and_redacts_cli(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'supabase').mkdir()
            config=root/'supabase/config.toml'
            original='[auth.email]\nenable_confirmations = true\nmax_frequency = "1s"\n'
            config.write_text(original,encoding='utf-8')
            def fail(command,**kwargs):
                active=config.read_text(encoding='utf-8')
                self.assertIn('max_frequency = "60s"',active)
                self.assertIn('pass = "env(SMTP_PASS)"',active)
                self.assertNotIn('secret app password',active)
                return email.subprocess.CompletedProcess(command,1,stdout='private-pat',stderr='secret app password')
            with patch.object(email,'ROOT',root),patch.object(email.subprocess,'run',side_effect=fail):
                with self.assertRaises(email.ConfigurationError) as caught: email.apply_local(self.settings())
            self.assertEqual(original,config.read_text(encoding='utf-8'))
            self.assertNotIn('private-pat',str(caught.exception))
            self.assertNotIn('secret app password',str(caught.exception))

    def test_api_error_does_not_disclose_response_or_token(self):
        error=urllib.error.HTTPError('https://api.supabase.com',403,'secret provider response',{},io.BytesIO(b'private-pat'))
        with patch.object(email.urllib.request,'urlopen',side_effect=error):
            with self.assertRaises(email.ConfigurationError) as caught: email.api(self.settings())
        self.assertIn('403',str(caught.exception))
        self.assertNotIn('secret',str(caught.exception))
        self.assertNotIn('private-pat',str(caught.exception))

    def test_hosted_does_not_claim_verified_when_readback_differs(self):
        with patch.object(email,'api',side_effect=[{},{}]):
            with self.assertRaises(email.ConfigurationError): email.apply_hosted(self.settings())


if __name__=='__main__': unittest.main()
