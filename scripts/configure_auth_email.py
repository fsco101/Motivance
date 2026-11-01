"""Configure code-based Auth email locally or on hosted Supabase; dry-run by default.

Credentials stay in ignored supabase/.env or process environment. Output never includes
passwords/tokens or raw CLI/API responses. No email is sent by this setup command.
"""
import argparse
import json
import os
from pathlib import Path
import re
import smtplib
import ssl
import subprocess
import sys
import urllib.error
import urllib.request

ROOT=Path(__file__).resolve().parents[1]

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
    for key in ('SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASS','SMTP_FROM_EMAIL','SMTP_SENDER_NAME','SUPABASE_PROJECT_REF','SUPABASE_ACCESS_TOKEN'):
        if key in os.environ: settings[key]=os.environ[key]
    return settings

def templates():
    return {kind:(ROOT/'supabase/templates'/f'{kind}.html').read_text(encoding='utf-8') for kind in ('confirmation','recovery')}

def validate(settings,target,secrets=False):
    missing=[k for k in ('SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_FROM_EMAIL') if not settings.get(k)]
    if target=='hosted' and not re.fullmatch('[a-z0-9]{20}',settings.get('SUPABASE_PROJECT_REF','')):
        missing.append('SUPABASE_PROJECT_REF (20-character project reference)')
    if secrets:
        missing += [k for k in ('SMTP_PASS',) if not settings.get(k)]
        if target=='hosted' and not settings.get('SUPABASE_ACCESS_TOKEN'): missing.append('SUPABASE_ACCESS_TOKEN')
    if missing: raise ConfigurationError('Fill these backend settings: '+', '.join(missing))
    if settings['SMTP_PORT'] not in ('465','587'): raise ConfigurationError('Use SMTP TLS port 465 or STARTTLS port 587.')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.-]*',settings['SMTP_HOST']): raise ConfigurationError('SMTP_HOST must be a hostname, not a URL.')
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',settings['SMTP_FROM_EMAIL']): raise ConfigurationError('SMTP_FROM_EMAIL must be a valid sender address.')
    if any('\n' in str(value) or '\r' in str(value) for value in settings.values()): raise ConfigurationError('Multiline environment values are not supported.')
    if settings['SMTP_HOST'].lower()=='smtp.gmail.com':
        if settings['SMTP_USER'].lower()!=settings['SMTP_FROM_EMAIL'].lower(): raise ConfigurationError('For Gmail, use the authenticated account as SMTP_FROM_EMAIL.')
        settings['SMTP_PASS']=settings.get('SMTP_PASS','').replace(' ','')
        if secrets and not settings['SMTP_PASS']: raise ConfigurationError('Fill the Gmail SMTP_PASS App Password.')
    for content in templates().values():
        if '{{ .Token }}' not in content: raise ConfigurationError('Email templates must contain the entered-code Token variable.')

def hosted_payload(settings):
    content=templates()
    return {'external_email_enabled':True,'disable_signup':False,'mailer_autoconfirm':False,
        'mailer_otp_length':6,'mailer_otp_exp':600,'smtp_max_frequency':60,
        'smtp_host':settings['SMTP_HOST'],'smtp_port':settings['SMTP_PORT'],
        'smtp_user':settings['SMTP_USER'],'smtp_pass':settings.get('SMTP_PASS',''),
        'smtp_admin_email':settings['SMTP_FROM_EMAIL'],'smtp_sender_name':settings.get('SMTP_SENDER_NAME') or 'Motivance',
        'mailer_subjects_confirmation':'Confirm your Motivance account','mailer_subjects_recovery':'Reset your Motivance password',
        'mailer_templates_confirmation_content':content['confirmation'],'mailer_templates_recovery_content':content['recovery']}

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

def apply_hosted(settings):
    payload=hosted_payload(settings)
    api(settings,payload)
    current=api(settings)
    for key in payload.keys()-{'smtp_pass'}:
        if str(current.get(key))!=str(payload[key]): raise ConfigurationError('Auth settings were submitted but read-back verification did not match: '+key)
    print('Hosted SMTP, confirmation and password-reset templates applied and read back successfully. Inbox delivery remains to be tested.')

def check_smtp(settings):
    context=ssl.create_default_context()
    try:
        if settings['SMTP_PORT']=='465': client=smtplib.SMTP_SSL(settings['SMTP_HOST'],465,timeout=20,context=context)
        else:
            client=smtplib.SMTP(settings['SMTP_HOST'],587,timeout=20);client.ehlo();client.starttls(context=context);client.ehlo()
        with client: client.login(settings['SMTP_USER'],settings['SMTP_PASS'])
    except smtplib.SMTPAuthenticationError: raise ConfigurationError('SMTP authentication failed. For Gmail, check 2-Step Verification and the App Password.') from None
    except (OSError,smtplib.SMTPException): raise ConfigurationError('SMTP TLS/connectivity check failed. No provider response or credential was logged.') from None
    print('SMTP TLS and authentication passed. No message was sent; inbox delivery remains untested.')

def local_config(original):
    if re.search(r'^\[auth\.email\.smtp\]',original,re.M): raise ConfigurationError('An SMTP block already exists; review it before applying the local profile.')
    def email_policy(match):
        block=match.group(0)
        for key,value in [('enable_signup','true'),('enable_confirmations','true'),('max_frequency','"60s"'),('otp_length','6'),('otp_expiry','600')]:
            if re.search(r'^'+key+r'\s*=',block,re.M): block=re.sub(r'^'+key+r'\s*=.*$',key+' = '+value,block,flags=re.M)
            else: block+='\n'+key+' = '+value+'\n'
        return block
    original=re.sub(r'^\[auth\.email\]\n.*?(?=^\[|\Z)',email_policy,original,flags=re.M|re.S)
    return original+'''
[auth.email.smtp]
enabled = true
host = "env(SMTP_HOST)"
port = 587
user = "env(SMTP_USER)"
pass = "env(SMTP_PASS)"
admin_email = "env(SMTP_FROM_EMAIL)"
sender_name = "env(SMTP_SENDER_NAME)"
'''

def apply_local(settings):
    path=ROOT/'supabase/config.toml';original=path.read_text(encoding='utf-8')
    changed=local_config(original).replace('port = 587\nuser =',f'port = {settings["SMTP_PORT"]}\nuser =')
    env=dict(os.environ);env.update(settings);env['SMTP_SENDER_NAME']=settings.get('SMTP_SENDER_NAME') or 'Motivance'
    executable='npx.cmd' if os.name=='nt' else 'npx'
    try:
        path.write_text(changed,encoding='utf-8')
        for operation in ('stop','start'):
            result=subprocess.run([executable,'--yes','supabase@2.20.12',operation],cwd=ROOT,env=env,capture_output=True,text=True)
            if result.returncode: raise ConfigurationError('Local stack '+operation+' failed. Raw output was withheld because CLI status may contain credentials.')
    finally: path.write_text(original,encoding='utf-8')
    print('Local stack restarted with real SMTP; no database reset. The tracked capture configuration was restored for future starts. Inbox delivery remains to be tested.')

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target',choices=['local','hosted'],required=True)
    parser.add_argument('--env-file',type=Path,default=ROOT/'supabase/.env')
    parser.add_argument('--apply',action='store_true')
    parser.add_argument('--check-smtp',action='store_true',help='Authenticate using TLS without sending email.')
    args=parser.parse_args(argv)
    settings=load_settings(args.env_file)
    validate(settings,args.target,secrets=args.apply or args.check_smtp)
    print('Email setup target:',args.target,'| SMTP host:',settings['SMTP_HOST'],'| TLS port:',settings['SMTP_PORT'])
    print('Confirmation required; six-digit codes; verification/reset templates use entered codes. Passwords/tokens are withheld.')
    if args.check_smtp: check_smtp(settings)
    if args.apply:
        if args.target=='hosted': apply_hosted(settings)
        else: apply_local(settings)
    else: print('Preview only; no backend settings changed.')

if __name__=='__main__':
    try: main()
    except ConfigurationError as error: print(str(error),file=sys.stderr);sys.exit(1)
