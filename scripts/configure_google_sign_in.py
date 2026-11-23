"""Configure Google sign-in for Supabase Auth locally or on hosted Supabase; preview by default.

The Google client ID is public and is printed. The client secret and the Supabase access token come from ignored
supabase/.env or the process environment and are never printed. The console steps that create the Google clients are in
docs/operations/GOOGLE-SIGN-IN.md; this script only tells Supabase about them and reads the result back.

  python scripts/configure_google_sign_in.py --target local            # read back what the local stack loaded
  python scripts/configure_google_sign_in.py --target hosted           # read the hosted settings and show the change
  python scripts/configure_google_sign_in.py --target hosted --apply   # only on the owner's instruction
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.error
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
CLIENT_ID=re.compile(r'[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com')
KEYS=('SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID','SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET','SUPABASE_PROJECT_REF','SUPABASE_ACCESS_TOKEN','PUBLIC_SITE_URL')
LOCAL_REDIRECTS=('http://localhost:3000/**','http://127.0.0.1:3000/**')

class ConfigurationError(Exception): pass

def load_settings(path):
    settings={}
    if path.exists():
        for raw in path.read_text(encoding='utf-8-sig').splitlines():
            line=raw.strip()
            if not line or line.startswith('#'): continue
            if '=' not in line: raise ConfigurationError('Environment file must contain NAME=value lines.')
            key,value=line.split('=',1)
            value=value.strip()
            if len(value)>=2 and value[0]==value[-1] and value[0] in ('"',"'"): value=value[1:-1]
            settings[key.strip()]=value
    for key in KEYS:
        if key in os.environ: settings[key]=os.environ[key]
    return settings

def site_url(settings):
    return settings.get('PUBLIC_SITE_URL','').rstrip('/')

def validate(settings,target,apply=False):
    missing=[]
    if not CLIENT_ID.fullmatch(settings.get('SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID','')):
        missing.append('SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID (the Web client ID, ending in .apps.googleusercontent.com)')
    if target=='hosted':
        if not re.fullmatch('[a-z0-9]{20}',settings.get('SUPABASE_PROJECT_REF','')): missing.append('SUPABASE_PROJECT_REF (20-character project reference)')
        if not settings.get('SUPABASE_ACCESS_TOKEN'): missing.append('SUPABASE_ACCESS_TOKEN')
        if not re.fullmatch(r'https://[A-Za-z0-9.-]+(:\d+)?',site_url(settings)): missing.append('PUBLIC_SITE_URL (the deployed HTTPS web address)')
        if apply and not settings.get('SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET'): missing.append('SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET')
    if missing: raise ConfigurationError('Fill these backend settings: '+', '.join(missing))
    if any('\n' in str(value) or '\r' in str(value) for value in settings.values()): raise ConfigurationError('Multiline environment values are not supported.')

def redirects(current,settings):
    """The existing allow-list with the web app added. Nothing already there is removed."""
    entries=[entry.strip() for entry in (current or '').split(',') if entry.strip()]
    wanted=site_url(settings)+'/**'
    return ','.join(entries if wanted in entries else entries+[wanted])

def hosted_payload(settings,current):
    return {'external_google_enabled':True,'external_google_client_id':settings['SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID'],
        'external_google_secret':settings['SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET'],'external_google_skip_nonce_check':False,
        'uri_allow_list':redirects(current.get('uri_allow_list'),settings)}

def api(settings,payload=None):
    url='https://api.supabase.com/v1/projects/'+settings['SUPABASE_PROJECT_REF']+'/config/auth'
    request=urllib.request.Request(url,data=json.dumps(payload).encode() if payload is not None else None,
        headers={'Authorization':'Bearer '+settings['SUPABASE_ACCESS_TOKEN'],'Content-Type':'application/json'},method='PATCH' if payload is not None else 'GET')
    try:
        with urllib.request.urlopen(request,timeout=40) as response:
            raw=response.read();return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        raise ConfigurationError(f'Supabase Auth configuration request failed (HTTP {error.code}); no response body was logged.') from None
    except (OSError,ValueError): raise ConfigurationError('Supabase Auth configuration request failed; check connectivity and access.') from None

def describe(current):
    """Only public values: whether Google is on, its client ID, the nonce check and the redirect list."""
    return {'enabled':bool(current.get('external_google_enabled')),'client_id':current.get('external_google_client_id') or '',
        'nonce_check':not current.get('external_google_skip_nonce_check'),
        'redirects':[entry for entry in (current.get('uri_allow_list') or '').split(',') if entry]}

def verify(current,settings):
    shown=describe(current)
    problems=[]
    if not shown['enabled']: problems.append('Google is off')
    if shown['client_id']!=settings['SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID']: problems.append('the client ID differs')
    if not shown['nonce_check']: problems.append('the nonce check is skipped')
    if site_url(settings)+'/**' not in shown['redirects']: problems.append('the web app is missing from the redirect list')
    return shown,problems

def report(shown):
    print('Google provider:','on' if shown['enabled'] else 'off','| client ID:',shown['client_id'] or '(none)','| nonce check:','on' if shown['nonce_check'] else 'SKIPPED')
    print('Redirect allow-list:',', '.join(shown['redirects']) or '(empty)')

def hosted(settings,apply):
    current=api(settings)
    if not apply:
        report(describe(current))
        payload=hosted_payload(settings,current)
        print('Would set: Google on, client ID',payload['external_google_client_id']+', nonce check on, redirect allow-list',payload['uri_allow_list'])
        print('Preview only; no hosted settings changed. Applying waits for the owner\'s instruction.')
        return
    api(settings,hosted_payload(settings,current))
    shown,problems=verify(api(settings),settings)
    report(shown)
    if problems: raise ConfigurationError('Google settings were submitted but the read-back did not match: '+'; '.join(problems))
    print('Hosted Google sign-in applied and read back. A real Google account has not signed in yet; see the follow-up checklist.')

def local_auth_environment():
    inspection=subprocess.run(['docker','inspect','supabase_auth_motivance'],capture_output=True,text=True)
    if inspection.returncode: raise ConfigurationError('The local Auth container is not running. Start the stack first.')
    return dict(value.split('=',1) for value in json.loads(inspection.stdout)[0]['Config']['Env'] if '=' in value)

def local(settings):
    env=local_auth_environment()
    shown={'enabled':env.get('GOTRUE_EXTERNAL_GOOGLE_ENABLED')=='true','client_id':env.get('GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID',''),
        'nonce_check':env.get('GOTRUE_EXTERNAL_GOOGLE_SKIP_NONCE_CHECK')!='true','redirects':[e for e in env.get('GOTRUE_URI_ALLOW_LIST','').split(',') if e]}
    report(shown)
    problems=[]
    if not shown['enabled']: problems.append('Google is off in supabase/config.toml')
    if shown['client_id']!=settings['SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID']: problems.append('the stack has not loaded the client ID from supabase/.env; restart it (stop, then start)')
    if not env.get('GOTRUE_EXTERNAL_GOOGLE_SECRET','').strip() or env.get('GOTRUE_EXTERNAL_GOOGLE_SECRET','').startswith('env('):
        problems.append('the client secret is not loaded, so the web redirect cannot finish (Android ID tokens still work)')
    if not shown['nonce_check']: problems.append('the nonce check is skipped')
    if not set(LOCAL_REDIRECTS)<=set(shown['redirects']): problems.append('the local web address is missing from the redirect list')
    if problems: raise ConfigurationError('Local Google sign-in is not ready: '+'; '.join(problems))
    print('Local stack has Google sign-in on with this client ID. The secret was checked for presence only.')

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--target',choices=['local','hosted'],required=True)
    parser.add_argument('--env-file',type=Path,default=ROOT/'supabase/.env')
    parser.add_argument('--apply',action='store_true',help='Hosted only: change the hosted settings, then read them back.')
    args=parser.parse_args(argv)
    if args.apply and args.target=='local': raise ConfigurationError('The local stack reads supabase/config.toml; restart it instead of applying.')
    settings=load_settings(args.env_file)
    validate(settings,args.target,args.apply)
    if args.target=='hosted': hosted(settings,args.apply)
    else: local(settings)

if __name__=='__main__':
    try: main()
    except ConfigurationError as error: print(str(error),file=sys.stderr);sys.exit(1)
