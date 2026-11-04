"""Configure Cloudinary profile-photo uploads in Supabase Vault, locally or on hosted Supabase. Dry run by default.

Credentials come from the ignored supabase/.env file or the process environment: either CLOUDINARY_URL
(cloudinary://<api_key>:<api_secret>@<cloud_name>, as shown on the Cloudinary dashboard) or CLOUDINARY_CLOUD_NAME,
CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET. They are written to Vault, where the database signs uploads. They are
never placed in android/.env or the APK, and output never includes the API key or secret.

  python scripts/configure_cloudinary.py --target local                    # preview
  python scripts/configure_cloudinary.py --target local --check --apply    # verify credentials, then store
  python scripts/configure_cloudinary.py --target hosted --check --apply   # needs SUPABASE_PROJECT_REF/ACCESS_TOKEN
"""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
KEYS=('CLOUDINARY_URL','CLOUDINARY_CLOUD_NAME','CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET','SUPABASE_PROJECT_REF','SUPABASE_ACCESS_TOKEN','CLOUDINARY_API_BASE')
PATTERNS={'cloud_name':r'[A-Za-z0-9_-]{1,64}','api_key':r'[A-Za-z0-9]{6,64}','api_secret':r'[A-Za-z0-9_-]{10,128}'}

class ConfigurationError(Exception): pass

def load_settings(path):
    settings={}
    if path.exists():
        for raw in path.read_text(encoding='utf-8-sig').splitlines():
            line=raw.strip()
            if not line or line.startswith('#'): continue
            if '=' not in line: raise ConfigurationError('Environment file must contain NAME=value lines.')
            key,value=line.split('=',1);value=value.strip()
            if len(value)>=2 and value[0]==value[-1] and value[0] in ('"',"'"): value=value[1:-1]
            settings[key.strip()]=value
    for key in KEYS:
        if key in os.environ: settings[key]=os.environ[key]
    return settings

def credentials(settings):
    """Returns {cloud_name, api_key, api_secret}. Separate variables take precedence over CLOUDINARY_URL."""
    values={}
    url=settings.get('CLOUDINARY_URL','').strip()
    if url:
        parsed=urllib.parse.urlsplit(url)
        if parsed.scheme!='cloudinary' or not parsed.hostname or parsed.username is None or parsed.password is None:
            raise ConfigurationError('CLOUDINARY_URL must look like cloudinary://<api_key>:<api_secret>@<cloud_name>.')
        values={'cloud_name':parsed.hostname,'api_key':urllib.parse.unquote(parsed.username),'api_secret':urllib.parse.unquote(parsed.password)}
    for name in PATTERNS:
        explicit=settings.get('CLOUDINARY_'+name.upper(),'').strip()
        if explicit: values[name]=explicit
    for name,pattern in PATTERNS.items():
        if not re.fullmatch(pattern,values.get(name,'')):
            raise ConfigurationError(f'Missing or invalid Cloudinary {name.replace("_"," ")}. Set CLOUDINARY_URL or CLOUDINARY_{name.upper()}.')
    return values

def api_base(settings): return settings.get('CLOUDINARY_API_BASE','https://api.cloudinary.com').rstrip('/')

def check_credentials(settings,values):
    """Calls the Cloudinary Admin API ping endpoint with the key and secret. No asset is created."""
    token=base64.b64encode(f"{values['api_key']}:{values['api_secret']}".encode()).decode()
    request=urllib.request.Request(f"{api_base(settings)}/v1_1/{values['cloud_name']}/ping",headers={'Authorization':'Basic '+token})
    try:
        with urllib.request.urlopen(request,timeout=20) as response:
            if json.loads(response.read() or b'{}').get('status')!='ok': raise ConfigurationError('Cloudinary did not confirm the credentials.')
    except urllib.error.HTTPError as e:
        raise ConfigurationError(f'Cloudinary rejected the credentials (HTTP {e.code}). Check the cloud name, API key and API secret.') from None
    except urllib.error.URLError:
        raise ConfigurationError('Cloudinary could not be reached. Check the network connection.') from None

def vault_sql(values):
    # Values are restricted to [A-Za-z0-9_-] by PATTERNS, so they cannot terminate the quoted literals.
    rows=','.join(f"('cloudinary_{name}','{values[name]}')" for name in PATTERNS)
    return f"""do $$ declare s record; existing uuid; begin
 for s in select * from (values {rows}) v(name,value) loop
  select id into existing from vault.secrets where name=s.name;
  if existing is null then perform vault.create_secret(s.value,s.name,'Motivance Cloudinary profile photos');
  else perform vault.update_secret(existing,s.value); end if;
 end loop;
end $$;"""

def run_local(statement):
    p=subprocess.run(['docker','exec','-i','supabase_db_motivance','psql','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1'],
        input=statement,capture_output=True,text=True)
    if p.returncode: raise ConfigurationError('Local database command failed. Start Supabase and apply migrations first.')
    return p.stdout

def run_hosted(settings,statement):
    ref=settings.get('SUPABASE_PROJECT_REF','');token=settings.get('SUPABASE_ACCESS_TOKEN','')
    if not re.fullmatch(r'[a-z0-9]{20}',ref) or not token: raise ConfigurationError('Hosted target needs SUPABASE_PROJECT_REF (20 characters) and SUPABASE_ACCESS_TOKEN.')
    request=urllib.request.Request(f'https://api.supabase.com/v1/projects/{ref}/database/query',data=json.dumps({'query':statement}).encode(),
        headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},method='POST')
    try:
        with urllib.request.urlopen(request,timeout=30) as response: return json.loads(response.read() or b'[]')
    except urllib.error.HTTPError as e:
        raise ConfigurationError(f'Supabase Management API rejected the request (HTTP {e.code}).') from None

def execute(settings,target,statement): return run_local(statement) if target=='local' else run_hosted(settings,statement)

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--target',choices=['local','hosted'],required=True)
    parser.add_argument('--env-file',type=Path,default=ROOT/'supabase/.env')
    parser.add_argument('--check',action='store_true',help='Verify the credentials with the Cloudinary ping endpoint.')
    parser.add_argument('--apply',action='store_true',help='Store the configuration in Vault. Without it, nothing changes.')
    args=parser.parse_args(argv)
    try:
        settings=load_settings(args.env_file)
        values=credentials(settings)
        print(f"Cloudinary cloud '{values['cloud_name']}' with an API key and secret found (values not shown).")
        if args.check: check_credentials(settings,values);print('Cloudinary accepted the credentials.')
        if not args.apply:
            print(f'Dry run: no {args.target} configuration changed. Add --apply to store the values in Supabase Vault.');return 0
        execute(settings,args.target,vault_sql(values))
        print(f'Stored Cloudinary configuration in {args.target} Supabase Vault. Profile photo uploads are enabled.')
        return 0
    except ConfigurationError as e:
        print('Configuration error: '+str(e),file=sys.stderr);return 2

if __name__=='__main__': sys.exit(main())
