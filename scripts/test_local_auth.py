"""Exercise real GoTrue + PostgREST + captured local email. Never prints tokens.

Run only against this project's isolated local Supabase stack. Synthetic accounts
are removed using targeted SQL at the end; no real email is delivered.
"""
import json
from pathlib import Path
import re
import subprocess
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]

def run():
    inspection=subprocess.run(['docker','inspect','supabase_auth_motivance'],capture_output=True,text=True,check=True)
    environment=dict(value.split('=',1) for value in json.loads(inspection.stdout)[0]['Config']['Env'] if '=' in value)
    if environment.get('GOTRUE_SMTP_HOST') not in ('supabase_inbucket_motivance','supabase_mailpit_motivance'):
        raise RuntimeError('Refusing synthetic email tests while real SMTP is active; restart the local capture profile first.')
    result = subprocess.run(['npx.cmd' if __import__('os').name=='nt' else 'npx','--yes','supabase@2.20.12','status','-o','json'],cwd=ROOT,capture_output=True,text=True,encoding='utf-8',check=True)
    status=json.loads(result.stdout)
    base=status['API_URL'].rstrip('/')
    if base not in ['http://127.0.0.1:54321','http://localhost:54321']:
        raise RuntimeError('Refusing to test an endpoint outside the local development stack')
    key=status['ANON_KEY']
    mailbox_base=status.get('INBUCKET_URL','http://127.0.0.1:54324').rstrip('/')
    if not mailbox_base.startswith(('http://127.0.0.1:','http://localhost:')):
        raise RuntimeError('Refusing nonlocal mailbox')
    checks=[]; created=[]

    def request(path,body=None,token=None,method=None):
        headers={'apikey':key,'Content-Type':'application/json'}
        if token: headers['Authorization']='Bearer '+token
        req=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers=headers,method=method or ('POST' if body is not None else 'GET'))
        try:
            with urllib.request.urlopen(req,timeout=20) as response:
                raw=response.read(); return response.status,json.loads(raw) if raw else {}
        except urllib.error.HTTPError as error:
            # Preserve code and generic error type only; never include tokens/passwords.
            return error.code,{}

    def check(condition,description):
        if not condition: raise AssertionError(description)
        checks.append(description); print('PASS '+description,flush=True)

    def code_for(mailbox,kind='confirm'):
        for _ in range(30):
            try:
                with urllib.request.urlopen(mailbox_base+'/api/v1/messages',timeout=10) as response:
                    messages=json.load(response)['messages']
                paths=[]
                for message in messages:
                    subject=message.get('Subject','').lower()
                    relevant=('confirm' in subject) if kind=='confirm' else ('recover' in subject or 'reset' in subject)
                    if relevant and mailbox+'@example.test' in json.dumps(message.get('To',[])):
                        paths.append('/api/v1/message/'+str(message['ID']))
            except (urllib.error.HTTPError,json.JSONDecodeError,KeyError,TypeError):
                with urllib.request.urlopen(mailbox_base+'/api/v1/mailbox/'+mailbox,timeout=10) as response:
                    messages=json.load(response)
                paths=[]
                for message in sorted(messages,key=lambda m:m.get('date',''),reverse=True):
                    subject=message.get('subject','').lower()
                    relevant=('confirm' in subject) if kind=='confirm' else ('recover' in subject or 'reset' in subject)
                    if relevant: paths.append('/api/v1/mailbox/'+mailbox+'/'+str(message['id']))
            for path in paths:
                with urllib.request.urlopen(mailbox_base+path,timeout=10) as response: detail=json.load(response)
                text=json.dumps(detail)
                found=re.search(r'<strong>(\d{6,10})</strong>',text)
                if found: return found.group(1)
            time.sleep(1)
        raise AssertionError('Local email verification code was not captured')

    def signup(suffix):
        mailbox='motivance-s1-'+uuid.uuid4().hex[:12]+suffix
        email=mailbox+'@example.test'
        password=uuid.uuid4().hex+'Aa!9'
        code,response=request('/auth/v1/signup',{'email':email,'password':password,'data':{'role':'admin'}})
        check(code==200,'Registration '+suffix+' accepted')
        # With confirmation required, raw GoTrue returns the user object directly.
        created.append((response.get('user') or response)['id'])
        code,_=request('/auth/v1/token?grant_type=password',{'email':email,'password':password})
        check(code>=400,'Unconfirmed account '+suffix+' cannot sign in')
        if suffix=='a':
            time.sleep(1.1) # Local capture profile only; real SMTP profiles are refused above.
            code,_=request('/auth/v1/resend',{'email':email,'type':'signup'})
            check(code==200,'Confirmation code resend accepted')
        otp=code_for(mailbox)
        wrong='000000' if otp!='000000' else '111111'
        code,_=request('/auth/v1/verify',{'email':email,'token':wrong,'type':'signup'})
        check(code>=400,'Incorrect confirmation code '+suffix+' is rejected')
        code,response=request('/auth/v1/verify',{'email':email,'token':otp,'type':'signup'})
        check(code==200 and bool(response.get('access_token')),'Email confirmation '+suffix+' creates a session')
        code,_=request('/auth/v1/verify',{'email':email,'token':otp,'type':'signup'})
        check(code>=400,'Consumed confirmation code '+suffix+' cannot be reused')
        return mailbox,email,password,response

    try:
        mailbox,email,password,session=signup('a')
        _,email_b,password_b,session_b=signup('b')
        code,roles=request('/rest/v1/user_roles?select=role',token=session['access_token'])
        check(code==200 and roles==[{'role':'patient'}],'Signup metadata cannot grant an admin role')
        code,patients=request('/rest/v1/patients?select=id',token=session_b['access_token'])
        check(code==200 and len(patients)==1 and patients[0]['id']==session_b['user']['id'],'Real API isolates patient profiles')
        code,_=request('/rest/v1/user_roles',{'user_id':session['user']['id'],'role':'admin'},session['access_token'])
        check(code>=400,'Real API rejects role self-promotion')
        for resource in [
            'profiles?select=display_name',
            'patients?select=id',
            'sessions?select=id,patient_id,started_at,status&order=started_at.desc&limit=20',
            'exercise_assignments?select=id,patient_id&active=eq.true',
            'exercise_assignments?select=id,patient_id,prescription_versions(id,version,side,minimum_degrees,maximum_degrees,target_repetitions,exercise_versions(id,algorithm_key,definition))&active=eq.true&patient_id=eq.'+session['user']['id'],
        ]:
            code,rows=request('/rest/v1/'+resource,token=session['access_token'])
            check(code==200 and isinstance(rows,list),'Dashboard read succeeds: '+resource.split('?')[0])
        code,session=request('/auth/v1/token?grant_type=password',{'email':email,'password':password})
        check(code==200,'Confirmed patient signs in')
        code,session=request('/auth/v1/token?grant_type=refresh_token',{'refresh_token':session['refresh_token']})
        check(code==200,'Refresh token produces a new session')
        code,_=request('/auth/v1/recover',{'email':email})
        check(code==200,'Recovery request accepted by local mail capture')
        otp=code_for(mailbox,'recovery')
        wrong='000000' if otp!='000000' else '111111'
        code,_=request('/auth/v1/verify',{'email':email,'token':wrong,'type':'recovery'})
        check(code>=400,'Incorrect recovery code is rejected')
        code,recovery=request('/auth/v1/verify',{'email':email,'token':otp,'type':'recovery'})
        check(code==200,'Recovery email code is verified')
        code,_=request('/auth/v1/verify',{'email':email,'token':otp,'type':'recovery'})
        check(code>=400,'Consumed recovery code cannot be reused')
        new_password=uuid.uuid4().hex+'Bb!8'
        code,_=request('/auth/v1/user',{'password':new_password},recovery['access_token'],'PUT')
        check(code==200,'Recovery session can set a new password')
        code,_=request('/auth/v1/token?grant_type=password',{'email':email,'password':password})
        check(code>=400,'Old password is rejected after recovery')
        code,session=request('/auth/v1/token?grant_type=password',{'email':email,'password':new_password})
        check(code==200,'New password signs in')
        refresh=session['refresh_token']
        code,_=request('/auth/v1/logout',{},session['access_token'])
        check(code in [200,204],'Logout succeeds')
        code,_=request('/auth/v1/token?grant_type=refresh_token',{'refresh_token':refresh})
        check(code>=400,'Revoked refresh token cannot create another session')
        code,_=request('/auth/v1/token?grant_type=refresh_token',{'refresh_token':'invalid-fixture'})
        check(code>=400,'Invalid refresh token is rejected')
        report={'environment':'isolated local Supabase; email captured locally','checks_passed':len(checks),'checks':checks,'limitations':['No hosted SMTP or Android device transport is tested by this script.']}
        (ROOT/'docs/validation/local-auth-results.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    finally:
        # Only remove UUIDs returned by this run; do not reset a user's database.
        if created:
            ids=','.join("'"+str(uuid.UUID(value))+"'" for value in created)
            sql=f'begin; delete from public.patients where id in ({ids}); delete from public.user_roles where user_id in ({ids}); delete from public.profiles where id in ({ids}); delete from auth.users where id in ({ids}); commit;'
            result=subprocess.run(['docker','exec','-i','supabase_db_motivance','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],input=sql,capture_output=True,text=True)
            if result.returncode: raise RuntimeError('Synthetic-account cleanup failed; inspect the local test stack')

if __name__=='__main__': run()
