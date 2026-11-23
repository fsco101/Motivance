"""What a Google sign-in may create and link (#167), against the disposable local stack only. Never prints tokens.

Auth checks a Google ID token against Google's own signing keys, so no test can make one. These tests therefore do two things:
* Ask the real local Auth: Google is on, and a token Google did not sign (for the configured audience or any other) is refused
  without creating an account.
* Make, directly in the database, the same rows Auth writes when a Google sign-in creates or links an account, and check what
  Motivance's own triggers, cleanup job and my_sign_in() do with them.
A sign-in with a real Google account is listed in docs/validation/POST-IMPLEMENTATION-CHECKLIST.md.
"""
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.request
import uuid

ROOT=Path(__file__).resolve().parents[1]
PREFIX='google-test-'

def main():
    raw=subprocess.run(['npx.cmd' if os.name=='nt' else 'npx','--yes','supabase@2.20.12','status','-o','json'],cwd=ROOT,capture_output=True,text=True,check=True)
    config=json.loads(raw.stdout)
    base=config['API_URL'].rstrip('/')
    assert base in ('http://127.0.0.1:54321','http://localhost:54321'),'Disposable local fixtures only'
    users=[];checks=[]

    def sql(statement):
        p=subprocess.run(['docker','exec','-i','supabase_db_motivance','psql','-q','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1'],input=statement,capture_output=True,text=True)
        if p.returncode: raise RuntimeError(p.stderr)
        return p.stdout.strip()

    def api(path,body=None,token=None,privileged=False,method=None):
        key=config['SERVICE_ROLE_KEY'] if privileged else config['ANON_KEY']
        headers={'apikey':key,'Content-Type':'application/json'}
        if token or privileged: headers['Authorization']='Bearer '+(token or key)
        request=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers=headers,method=method or ('POST' if body is not None else 'GET'))
        try:
            with urllib.request.urlopen(request,timeout=30) as response:
                raw=response.read();return response.status,json.loads(raw) if raw else None
        except urllib.error.HTTPError as e: return e.code,None

    def check(condition,name):
        if not condition: raise AssertionError(name)
        checks.append(name);print('PASS '+name,flush=True)

    def email(): return PREFIX+uuid.uuid4().hex+'@example.test'

    def as_user(uid,statement):
        """Runs one statement as the signed-in account, the way PostgREST would."""
        claims=json.dumps({'sub':uid,'role':'authenticated'})
        return sql(f"begin;set local role authenticated;set local request.jwt.claims='{claims}';{statement};rollback;")

    def sign_in_methods(uid): return json.loads(as_user(uid,'select public.my_sign_in()'))

    def google_identity(uid,address):
        """The identity row Auth adds when a Google account signs in or is linked."""
        sub=str(int(uuid.uuid4().int%10**21))
        data=json.dumps({'sub':sub,'email':address,'email_verified':True,'iss':'https://accounts.google.com','name':'Synthetic Google Person','role':'admin'})
        sql(f"insert into auth.identities(provider_id,user_id,identity_data,provider,last_sign_in_at,created_at,updated_at) values('{sub}','{uid}','{data}','google',now(),now(),now());")

    def password_account(roles=('patient',)):
        address=email();password=uuid.uuid4().hex+'Aa!9'
        status,created=api('/auth/v1/admin/users',{'email':address,'password':password,'email_confirm':True},privileged=True)
        assert status==200
        uid=str(uuid.UUID(created['id']));users.append(uid)
        for role in roles:
            if role!='patient': sql(f"insert into public.user_roles(user_id,role) values('{uid}','{role}');")
        return uid,address

    def google_only_account(address=None,metadata=None,confirmed=True):
        """A user row as Auth writes it for a new Google sign-in: no password, and Google's verified address."""
        uid=str(uuid.uuid4());address=address or email();users.append(uid)
        meta=json.dumps(metadata or {'name':'Synthetic Google Person','email_verified':True,'role':'admin','roles':['admin','therapist']})
        sql(f"""insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values('00000000-0000-0000-0000-000000000000','{uid}','authenticated','authenticated','{address}','',{'now()' if confirmed else 'null'},
 '{{"provider":"google","providers":["google"],"role":"admin"}}','{meta}',now(),now());""")
        google_identity(uid,address)
        return uid,address

    def cleanup():
        stale=sql(f"select id from auth.users where email like '{PREFIX}%@example.test';").splitlines()
        ids=','.join("'"+str(uuid.UUID(u))+"'" for u in set(stale+users))
        if not ids: return
        sql(f"""begin;set local session_replication_role=replica;
delete from public.therapist_patients where therapist_id in ({ids}) or patient_id in ({ids});
delete from public.patient_invitations where therapist_id in ({ids});
delete from public.audit_events where actor_id in ({ids}) or target_id in ({ids});
delete from public.patient_profiles where user_id in ({ids});delete from public.patients where id in ({ids});delete from public.user_roles where user_id in ({ids});
delete from public.notification_settings where user_id in ({ids});delete from public.profiles where id in ({ids});
delete from auth.identities where user_id in ({ids});delete from auth.users where id in ({ids});commit;""")

    def token(payload):
        part=lambda value: base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b'=').decode()
        head=part({'alg':'HS256','typ':'JWT','kid':'not-google'})+'.'+part(payload)
        return head+'.'+base64.urlsafe_b64encode(hmac.new(b'not-google',head.encode(),hashlib.sha256).digest()).rstrip(b'=').decode()

    cleanup()
    try:
        status,settings=api('/auth/v1/settings')
        check(status==200 and settings['external'].get('google') is True,'Local Auth has the Google provider on')

        inspection=json.loads(subprocess.run(['docker','inspect','supabase_auth_motivance'],capture_output=True,text=True,check=True).stdout)[0]['Config']['Env']
        audience=dict(value.split('=',1) for value in inspection if '=' in value).get('GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID','')
        before=int(sql('select count(*) from auth.users;'))
        now=int(time.time())
        for aud,label in [(audience,'the configured Web client ID'),('999-other.apps.googleusercontent.com','another audience')]:
            nonce='raw-nonce-'+uuid.uuid4().hex
            forged=token({'iss':'https://accounts.google.com','aud':aud,'sub':'1'+str(now),'email':email(),'email_verified':True,
                'iat':now,'exp':now+600,'nonce':hashlib.sha256(nonce.encode()).hexdigest()})
            status,body=api('/auth/v1/token?grant_type=id_token',{'provider':'google','id_token':forged,'nonce':nonce})
            check(status>=400 and not (body or {}).get('access_token'),'A token Google did not sign is refused for '+label)
        check(int(sql('select count(*) from auth.users;'))==before,'A refused Google token creates no account')

        # Linking: Auth adds a Google identity to the account that already has the verified email.
        therapist,address=password_account(('patient','therapist'))
        patient,_=password_account()
        sql(f"insert into public.therapist_patients(therapist_id,patient_id,active) values('{therapist}','{patient}',true);")
        google_identity(therapist,address)
        check(sql(f"select count(*) from auth.users where lower(email)=lower('{address}');")=='1','Linking Google to an existing email makes no second account')
        check(sql(f"select string_agg(role,',' order by role) from public.user_roles where user_id='{therapist}';")=='patient,therapist','A linked account keeps its roles')
        check(sql(f"select count(*) from public.therapist_patients where therapist_id='{therapist}' and active;")=='1','A linked account keeps its patients')
        methods=sign_in_methods(therapist)
        check(methods=={'password':True,'google':True,'profile_required':False},'A linked staff account keeps its password and is not asked for patient details')

        # A new email: a patient, never staff, whatever Google's claims say.
        fresh,_=google_only_account()
        check(sql(f"select string_agg(role,',') from public.user_roles where user_id='{fresh}';")=='patient','A new Google account becomes a patient and nothing else')
        check(sql(f"select count(*) from public.patients where id='{fresh}';")=='1','A new Google account gets its patient record')
        check(sql(f"select count(*) from public.patient_profiles where user_id='{fresh}';")=='0','A new Google account has no invented patient details')
        check(sign_in_methods(fresh)=={'password':False,'google':True,'profile_required':True},'A new Google patient has no password and must finish their profile')
        details={'username':'g'+uuid.uuid4().hex[:12],'first_name':'Synthetic','last_name':'Person','gender':'female','birthdate':'1990-01-01',
            'address':'Synthetic Street 1','contact':'09001234567','consent':True}
        claims=json.dumps({'sub':fresh,'role':'authenticated'})
        sql(f"begin;set local role authenticated;set local request.jwt.claims='{claims}';select public.save_my_profile('{json.dumps(details)}'::jsonb);commit;")
        check(sign_in_methods(fresh)['profile_required'] is False,'Finishing the profile lets the Google patient reach Home')
        check(sql(f"select consented_at is not null from public.patient_profiles where user_id='{fresh}';")=='t','The Google patient gives the privacy agreement themselves')

        # A pending email sign-up confirmed by Google keeps none of the form's details or agreement.
        pending,pending_email=google_only_account(metadata={'patient_profile':dict(details,username='p'+uuid.uuid4().hex[:12])},confirmed=False)
        check(sql(f"select count(*) from public.user_roles where user_id='{pending}';")=='0','An unconfirmed sign-up has no account yet')
        sql(f"update auth.users set email_confirmed_at=now() where id='{pending}';")
        check(sql(f"select count(*) from public.patient_profiles where user_id='{pending}';")=='0','A Google sign-in that confirms a pending sign-up does not adopt its details or agreement')
        check(sql(f"select string_agg(role,',') from public.user_roles where user_id='{pending}';")=='patient','That account is provisioned as a patient')

        # Cleanup of never-confirmed sign-ups leaves Google accounts alone, however old.
        sql(f"update auth.users set created_at=now()-interval '2 days',confirmation_sent_at=null where id in ('{fresh}','{pending}');")
        old,_=google_only_account()
        sql(f"update auth.users set created_at=now()-interval '30 days' where id='{old}';")
        sql('select public.delete_expired_signups();')
        check(sql(f"select count(*) from auth.users where id in ('{fresh}','{pending}','{old}');")=='3','The expired sign-up cleanup leaves Google accounts alone')

        # Only the signed-in person can ask, and only about themselves.
        status,_=api('/rest/v1/rpc/my_sign_in',{})
        check(status in (401,403),'Signed-out callers cannot read sign-in methods')
        check(sql("select has_function_privilege('anon','public.my_sign_in()','execute');")=='f','The anonymous role cannot run my_sign_in')
        sql(f"update public.profiles set active=false where id='{old}';")
        check(as_user(old,'select public.my_sign_in()')=='','A disabled account reads nothing')
    finally:
        cleanup()
    print(f'{len(checks)} Google sign-in checks passed.')

if __name__=='__main__':
    main()
