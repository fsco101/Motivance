"""Isolated Cloudinary configuration and cleanup checks: parsing, validation, secret redaction, signing. No network."""
import contextlib
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.parse

import configure_cloudinary as config
import cleanup_profile_photos as cleanup

SECRET='Fixture_Secret-1234567890'
KEY='123456789012345'
PID='motivance/avatars/'+'0'*8+'-0000-0000-0000-'+'0'*12+'/'+'a'*32


class Response:
    def __init__(self,body): self.body=json.dumps(body).encode()
    def read(self): return self.body
    def __enter__(self): return self
    def __exit__(self,*_): return False


class CloudinaryConfigurationTest(unittest.TestCase):
    def env(self,directory,**values):
        path=Path(directory)/'.env'
        path.write_text('\n'.join(f'{k}={v}' for k,v in values.items()),encoding='utf-8')
        return path

    def run_main(self,module,args):
        out,err=io.StringIO(),io.StringIO()
        with patch.dict(config.os.environ,{},clear=True),contextlib.redirect_stdout(out),contextlib.redirect_stderr(err):
            code=module.main(args)
        return code,out.getvalue()+err.getvalue()

    def test_cloudinary_url_is_parsed_and_separate_values_take_precedence(self):
        values=config.credentials({'CLOUDINARY_URL':f'cloudinary://{KEY}:{SECRET}@demo-cloud'})
        self.assertEqual(values,{'cloud_name':'demo-cloud','api_key':KEY,'api_secret':SECRET})
        values=config.credentials({'CLOUDINARY_URL':f'cloudinary://{KEY}:{SECRET}@demo-cloud','CLOUDINARY_CLOUD_NAME':'other'})
        self.assertEqual(values['cloud_name'],'other')

    def test_invalid_or_injecting_values_are_rejected(self):
        for settings in ({},{'CLOUDINARY_URL':'https://example.test'},
                         {'CLOUDINARY_CLOUD_NAME':"x');drop table t;--",'CLOUDINARY_API_KEY':KEY,'CLOUDINARY_API_SECRET':SECRET},
                         {'CLOUDINARY_CLOUD_NAME':'demo','CLOUDINARY_API_KEY':KEY,'CLOUDINARY_API_SECRET':"short'"}):
            with self.assertRaises(config.ConfigurationError): config.credentials(settings)

    def test_preview_changes_nothing_and_never_prints_credentials(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(config,'execute') as execute, patch.object(config,'check_credentials') as check:
            code,output=self.run_main(config,['--target','hosted','--env-file',str(self.env(directory,CLOUDINARY_URL=f'cloudinary://{KEY}:{SECRET}@demo-cloud'))])
        self.assertEqual(code,0);execute.assert_not_called();check.assert_not_called()
        self.assertIn('demo-cloud',output);self.assertNotIn(SECRET,output);self.assertNotIn(KEY,output)

    def test_apply_writes_all_three_vault_secrets_and_redacts_output(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(config,'run_local') as local:
            code,output=self.run_main(config,['--target','local','--apply','--env-file',str(self.env(directory,
                CLOUDINARY_CLOUD_NAME='demo-cloud',CLOUDINARY_API_KEY=KEY,CLOUDINARY_API_SECRET=SECRET))])
        self.assertEqual(code,0)
        statement=local.call_args.args[0]
        for name in ('cloudinary_cloud_name','cloudinary_api_key','cloudinary_api_secret',SECRET,'vault.update_secret','vault.create_secret'):
            self.assertIn(name,statement)
        self.assertNotIn(SECRET,output)

    def test_hosted_apply_requires_project_reference_and_token(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(config.urllib.request,'urlopen') as urlopen:
            code,output=self.run_main(config,['--target','hosted','--apply','--env-file',str(self.env(directory,CLOUDINARY_URL=f'cloudinary://{KEY}:{SECRET}@demo'))])
        self.assertEqual(code,2);urlopen.assert_not_called();self.assertIn('SUPABASE_PROJECT_REF',output)

    def test_hosted_apply_posts_sql_to_the_management_api(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(config.urllib.request,'urlopen',return_value=Response([])) as urlopen:
            code,_=self.run_main(config,['--target','hosted','--apply','--env-file',str(self.env(directory,
                CLOUDINARY_URL=f'cloudinary://{KEY}:{SECRET}@demo',SUPABASE_PROJECT_REF='a'*20,SUPABASE_ACCESS_TOKEN='pat'))])
        self.assertEqual(code,0)
        request=urlopen.call_args.args[0]
        self.assertEqual(request.full_url,'https://api.supabase.com/v1/projects/'+'a'*20+'/database/query')
        self.assertEqual(request.get_header('Authorization'),'Bearer pat')
        self.assertIn('cloudinary_api_secret',json.loads(request.data)['query'])

    def test_credential_check_uses_basic_auth_ping(self):
        with patch.object(config.urllib.request,'urlopen',return_value=Response({'status':'ok'})) as urlopen:
            config.check_credentials({},{'cloud_name':'demo','api_key':KEY,'api_secret':SECRET})
        request=urlopen.call_args.args[0]
        self.assertEqual(request.full_url,'https://api.cloudinary.com/v1_1/demo/ping')
        self.assertTrue(request.get_header('Authorization').startswith('Basic '))

    def test_cleanup_destroy_is_signed_and_invalidates_cdn(self):
        with patch.object(cleanup.urllib.request,'urlopen',return_value=Response({'result':'not found'})) as urlopen, patch.object(cleanup.time,'time',return_value=1700000000):
            self.assertTrue(cleanup.destroy({},{'cloud_name':'demo','api_key':KEY,'api_secret':SECRET},PID))
        request=urlopen.call_args.args[0]
        form=dict(urllib.parse.parse_qsl(request.data.decode()))
        self.assertEqual(request.full_url,'https://api.cloudinary.com/v1_1/demo/image/destroy')
        self.assertEqual(form['invalidate'],'true')
        self.assertEqual(form['signature'],hashlib.sha1(f'invalidate=true&public_id={PID}&timestamp=1700000000{SECRET}'.encode()).hexdigest())
        self.assertNotIn('api_secret',form)

    def test_cleanup_marks_only_successful_deletions(self):
        settings={'CLOUDINARY_URL':f'cloudinary://{KEY}:{SECRET}@demo'}
        other=PID[:-1]+'b'
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(cleanup.config,'execute',side_effect=[PID+'\n'+other+'\nnot-a-public-id\n',None]) as execute, \
             patch.object(cleanup,'destroy',side_effect=[True,False]):
            code,output=self.run_main(cleanup,['--target','local','--apply','--env-file',str(self.env(directory,**settings))])
        self.assertEqual(code,1);self.assertIn('Deleted 1 of 2',output)
        update=execute.call_args_list[1].args[2]
        self.assertIn(PID,update);self.assertNotIn(other,update)


if __name__=='__main__': unittest.main()
