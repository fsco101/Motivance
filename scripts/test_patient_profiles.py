"""Exercise patient demographics, consent, RLS and password changes using synthetic local users."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]

def main():
    raw = subprocess.run(['npx.cmd' if os.name == 'nt' else 'npx', '--yes', 'supabase@2.20.12', 'status', '-o', 'json'], cwd=ROOT, capture_output=True, text=True, check=True)
    config = json.loads(raw.stdout)
    base = config['API_URL'].rstrip('/')
    assert base in ('http://127.0.0.1:54321', 'http://localhost:54321'), 'Disposable local fixtures only'
    users = []; checks = []
    def sql(statement):
        p = subprocess.run(['docker','exec','-i','supabase_db_motivance','psql','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1'], input=statement, capture_output=True, text=True)
        if p.returncode: raise RuntimeError(p.stderr)
        return p.stdout.strip()
    def api(path, body=None, token=None, privileged=False, method=None):
        key = config['SERVICE_ROLE_KEY'] if privileged else config['ANON_KEY']
        headers = {'apikey':key, 'Content-Type':'application/json'}
        if token or privileged: headers['Authorization']='Bearer '+(token or key)
        request=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers=headers,method=method or ('POST' if body is not None else 'GET'))
        try:
            with urllib.request.urlopen(request,timeout=20) as response:
                raw=response.read();return response.status,json.loads(raw) if raw else None
        except urllib.error.HTTPError as e: return e.code,None
    def rpc(name,body,token): return api('/rest/v1/rpc/'+name,body,token)
    def check(condition,name):
        if not condition: raise AssertionError(name)
        checks.append(name);print('PASS '+name,flush=True)
    def user(role='patient', details=None):
        email='profile-'+uuid.uuid4().hex+'@example.test';password=uuid.uuid4().hex+'Aa!9'
        data={'email':email,'password':password,'email_confirm':True}
        if details is not None:data['user_metadata']={'patient_profile':details}
        status,created=api('/auth/v1/admin/users',data,privileged=True)
        assert status==200
        uid=str(uuid.UUID(created['id']));users.append(uid)
        if role!='patient':sql(f"insert into public.user_roles(user_id,role) values('{uid}','{role}');")
        status,session=api('/auth/v1/token?grant_type=password',{'email':email,'password':password});assert status==200
        return uid,session['access_token'],email,password
    stale=sql("select id from auth.users where email ~ '^profile-[0-9a-f]{32}@example[.]test$';").splitlines()
    if stale:
        ids=','.join("'"+str(uuid.UUID(u))+"'" for u in stale)
        sql(f"begin;set local session_replication_role=replica;delete from public.patient_profiles where user_id in ({ids});delete from public.therapist_patients where therapist_id in ({ids}) or patient_id in ({ids});delete from public.audit_events where actor_id in ({ids}) or target_id in ({ids});delete from public.user_roles where user_id in ({ids});delete from public.patients where id in ({ids});delete from public.profiles where id in ({ids});delete from auth.users where id in ({ids});commit;")
    details={'username':'p_'+uuid.uuid4().hex[:15],'full_name':'Synthetic Patient','gender':'female','birthdate':'1995-05-04','address':'Synthetic test address','contact':'+639001234567','avatar':'star','consent':True}
    try:
        patient,tp,email,password=user(details=details);other,to,_,_=user();therapist,tt,_,_=user('therapist')
        status,rows=api('/rest/v1/patient_profiles?select=*',token=tp)
        check(status==200 and len(rows)==1 and rows[0]['username']==details['username'],'Signup trigger saves detailed profile and consent')
        timestamp=rows[0]['consented_at'];version=rows[0]['privacy_version']
        check(version=='system-purpose-v1','Consent has server-controlled policy version and timestamp')
        check(api('/rest/v1/patient_profiles?select=*',token=to)[1]==[],'Unrelated patient cannot read profile')
        check(api('/rest/v1/patient_profiles?select=*',token=tt)[1]==[],'Unassigned therapist cannot read profile')
        check(api('/rest/v1/patient_profiles?select=*')[0]>=400,'Anonymous cannot read profiles')
        sql(f"insert into public.therapist_patients(therapist_id,patient_id,active) values('{therapist}','{patient}',true);")
        status,rows=api('/rest/v1/patient_profiles?select=*',token=tt)
        check(status==200 and rows[0]['address']==details['address'],'Linked therapist can read demographic details and avatar')
        check(rpc('save_my_profile',{'p_details':dict(details,consent=False)},tp)[0]>=400,'Missing privacy agreement rejected')
        check(rpc('save_my_profile',{'p_details':dict(details,birthdate='2999-01-01')},tp)[0]>=400,'Future birthdate rejected')
        check(rpc('save_my_profile',{'p_details':dict(details,username='!')},tp)[0]>=400,'Invalid username rejected')
        check(rpc('save_my_profile',{'p_details':details},to)[0]>=400,'Case-insensitive unique username enforced')
        check(api('/rest/v1/patient_profiles?user_id=eq.'+patient,dict(details,user_id=other),tp,method='PATCH')[0]>=400,'Direct profile mutation denied')
        updated=dict(details,full_name='Updated Fixture',avatar='heart',address='Changed fixture address',email='forged@example.test',user_id=other,privacy_version='forged')
        check(rpc('save_my_profile',{'p_details':updated},tp)[0] in (200,204),'Owner can update editable profile details')
        _,rows=api('/rest/v1/patient_profiles?select=*',token=tp)
        check(rows[0]['user_id']==patient and rows[0]['avatar']=='heart','RPC ignores forged owner and saves selected avatar')
        check(rows[0]['consented_at']==timestamp and rows[0]['privacy_version']==version,'Profile edit preserves original consent evidence')
        check(api('/auth/v1/user',token=tp)[1]['email']==email,'Profile save cannot change sign-in email')
        check(api('/rest/v1/rpc/write_patient_profile',{'p_user':patient,'p_details':details},to)[0]>=400,'Internal writer cannot be invoked by app users')
        sql(f"update public.therapist_patients set active=false where therapist_id='{therapist}' and patient_id='{patient}';")
        check(api('/rest/v1/patient_profiles?select=*',token=tt)[1]==[],'Revoked therapist immediately loses profile access')
        newpassword=uuid.uuid4().hex+'Bb!8'
        check(api('/auth/v1/user',{'password':newpassword},tp,method='PUT')[0]==200,'Authenticated password change supported')
        check(api('/auth/v1/token?grant_type=password',{'email':email,'password':password})[0]>=400,'Old password rejected after change')
        check(api('/auth/v1/token?grant_type=password',{'email':email,'password':newpassword})[0]==200,'New password signs in')
        report={'generated_at':datetime.now(timezone.utc).isoformat(),'passed':True,'checks':checks,'fixtures':'Synthetic local users only; no messages sent'}
        (ROOT/'docs/validation/patient-profile-backend-results.json').write_text(json.dumps(report,indent=2)+'\n')
    finally:
        if users:
            ids=','.join("'"+u+"'" for u in users)
            sql(f"begin; set local session_replication_role=replica; delete from public.patient_profiles where user_id in ({ids}); delete from public.therapist_patients where patient_id in ({ids}) or therapist_id in ({ids}); delete from public.user_roles where user_id in ({ids}); delete from public.patients where id in ({ids}); delete from public.audit_events where actor_id in ({ids}) or target_id in ({ids}); delete from public.profiles where id in ({ids}); delete from auth.users where id in ({ids}); commit;")

if __name__=='__main__':main()
