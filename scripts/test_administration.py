"""Exercise administrator RPCs through real local Auth/PostgREST; preserve existing data."""
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
    users = []; checks = []; exercise = str(uuid.uuid4())
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
    def user(role):
        password=uuid.uuid4().hex+'Aa!9';email='motivance-s4-'+uuid.uuid4().hex+'@example.test'
        code,data=api('/auth/v1/admin/users',{'email':email,'password':password,'email_confirm':True},privileged=True)
        assert code==200
        uid=str(uuid.UUID(data['id']));users.append(uid)
        if role!='patient': sql(f"insert into public.user_roles(user_id,role) values('{uid}','{role}');")
        code,data=api('/auth/v1/token?grant_type=password',{'email':email,'password':password});assert code==200
        return uid,data['access_token']
    try:
        check(sql("select count(*) from public.exercise_versions where version=2 and algorithm_key in ('elbow-flexion-v1','shoulder-abduction-v1') and length(definition->>'instructions_fil')>0;")=='2','Bilingual catalogue appends two supported development versions')
        admin,ta=user('admin');therapist,tt=user('therapist');patient,tp=user('patient');other,to=user('patient')
        operations={
          'admin_accounts':{}, 'admin_set_account':{'p_user':other,'p_active':False},
          'admin_set_role':{'p_user':other,'p_role':'admin','p_granted':True},
          'admin_set_link':{'p_therapist':therapist,'p_patient':patient,'p_active':True},
          'admin_set_exercise':{'p_exercise':exercise,'p_active':False},
          'admin_publish_exercise':{'p_exercise':exercise,'p_name':'Fixture','p_english':'Fixture','p_filipino':'Fixture'}}
        for name,body in operations.items():
            for label,token in [('anonymous',None),('patient',tp),('therapist',tt)]:
                check(rpc(name,body,token)[0]>=400,label+' denied '+name)
        check(api('/rest/v1/user_roles',{'user_id':other,'role':'admin'},tp)[0]>=400,'Direct role self promotion denied')
        check(api('/rest/v1/profiles?id=eq.'+other,{'active':False},tp,method='PATCH')[0]>=400,'Direct protected profile update denied')
        code,accounts=rpc('admin_accounts',{},ta)
        check(code==200 and {admin,therapist,patient,other}.issubset({a['id'] for a in accounts}),'Admin reads account directory')
        check([a['id'] for a in accounts]==sorted(a['id'] for a in accounts),'Account directory has deterministic UUID order')
        _,page=rpc('admin_accounts',{'p_after':patient},ta)
        check(all(a['id']>patient for a in page),'Account cursor excludes preceding records')
        check(rpc('admin_set_account',{'p_user':admin,'p_active':False},ta)[0]>=400,'Admin cannot disable own account')
        check(rpc('admin_set_role',{'p_user':admin,'p_role':'admin','p_granted':False},ta)[0]>=400,'Admin cannot remove own administrator role')
        check(rpc('admin_set_role',{'p_user':other,'p_role':'unknown','p_granted':True},ta)[0]>=400,'Unknown roles rejected')
        check(rpc('admin_set_role',{'p_user':other,'p_role':'therapist','p_granted':True},ta)[0] in (200,204),'Admin grants trusted therapist role')
        check(rpc('admin_set_link',{'p_therapist':other,'p_patient':patient,'p_active':True},ta)[0] in (200,204),'Admin activates therapist patient link')
        code,rows=api('/rest/v1/patients?select=id&id=eq.'+patient,token=to)
        check(code==200 and len(rows)==1,'Existing JWT observes newly granted server role')
        check(rpc('admin_set_link',{'p_therapist':patient,'p_patient':therapist,'p_active':True},ta)[0]>=400,'Non therapist link rejected')
        # A fixture catalogue entry avoids changing the actual development catalogue.
        sql(f"insert into public.exercises(id,code,active) values('{exercise}','s4-{exercise}',true); insert into public.exercise_versions(exercise_id,version,algorithm_key,definition,published) select '{exercise}',1,algorithm_key,definition,true from public.exercise_versions where id='21000000-0000-0000-0000-000000000001';")
        old=sql(f"select id from public.exercise_versions where exercise_id='{exercise}';")
        assignment=str(uuid.uuid4());version=str(uuid.uuid4())
        body={'p_assignment':assignment,'p_version':version,'p_patient':patient,'p_exercise':old,'p_side':'left','p_low':20,'p_high':90,'p_repetitions':5,'p_parameters':{}}
        check(rpc('publish_prescription',body,to)[0]==200,'Granted therapist publishes fixture prescription')
        _,new=rpc('admin_publish_exercise',{'p_exercise':exercise,'p_name':'Fixture v2','p_english':'Updated fixture instructions','p_filipino':'Bagong tagubilin'},ta)
        check(new is not None and new!=old,'Catalogue edit appends an immutable version')
        check(sql(f"select exercise_version_id from public.prescription_versions where id='{version}';")==old,'Existing prescription retains original exercise version')
        check(sql(f"select count(distinct algorithm_key) from public.exercise_versions where exercise_id='{exercise}';")=='1','Catalogue edit preserves supported algorithm')
        check(api('/rest/v1/exercise_versions?id=eq.'+old,{'definition':{}},ta,method='PATCH')[0]>=400,'Even admin cannot mutate published historical version directly')
        check(rpc('admin_publish_exercise',{'p_exercise':exercise,'p_name':'','p_english':'x','p_filipino':'x'},ta)[0]>=400,'Blank exercise name rejected')
        check(rpc('admin_set_exercise',{'p_exercise':exercise,'p_active':False},ta)[0] in (200,204),'Admin deactivates catalogue entry')
        body.update(p_assignment=str(uuid.uuid4()),p_version=str(uuid.uuid4()))
        check(rpc('publish_prescription',body,to)[0]>=400,'Inactive catalogue prevents new prescriptions')
        check(rpc('admin_set_link',{'p_therapist':other,'p_patient':patient,'p_active':False},ta)[0] in (200,204),'Admin revokes link')
        check(sql(f"select active from public.exercise_assignments where id='{assignment}';")=='f','Revocation deactivates associated prescription assignments')
        _,rows=api('/rest/v1/patients?select=id&id=eq.'+patient,token=to)
        check(rows==[],'Link revocation removes future patient reads')
        check(rpc('admin_set_link',{'p_therapist':other,'p_patient':patient,'p_active':True},ta)[0] in (200,204),'Admin can relink patient')
        check(sql(f"select active from public.exercise_assignments where id='{assignment}';")=='f','Relink never silently reactivates old prescriptions')
        check(rpc('admin_set_role',{'p_user':other,'p_role':'therapist','p_granted':False},ta)[0] in (200,204),'Admin removes therapist role')
        check(sql(f"select active from public.therapist_patients where therapist_id='{other}' and patient_id='{patient}';")=='f','Role removal revokes old links')
        check(rpc('admin_set_account',{'p_user':patient,'p_active':False},ta)[0] in (200,204),'Admin disables account')
        _,rows=api('/rest/v1/patients?select=id',token=tp)
        check(rows==[],'Disabled account old token cannot read patients')
        check(rpc('record_consent',{'p_id':str(uuid.uuid4()),'p_event':'granted','p_version':'movement-summary-v1','p_occurred_at':datetime.now(timezone.utc).isoformat()},tp)[0]>=400,'Disabled account cannot write consent')
        check(rpc('admin_set_account',{'p_user':patient,'p_active':True},ta)[0] in (200,204),'Admin enables account')
        check(int(sql(f"select count(*) from public.audit_events where actor_id='{admin}';"))>=8,'Administrative changes produce protected audit records')
        check(rpc('admin_set_role',{'p_user':other,'p_role':'admin','p_granted':True},ta)[0] in (200,204),'Administrator can provision another administrator')
        check(rpc('admin_accounts',{},to)[0]==200,'Server checks current administrator role rather than stale UI claims')
        check(rpc('admin_set_account',{'p_user':other,'p_active':False},ta)[0] in (200,204),'Admin disables another administrator')
        check(rpc('admin_accounts',{},to)[0]>=400,'Disabled administrator old JWT loses admin access')
        report={'generated_at':datetime.now(timezone.utc).isoformat(),'checks_passed':len(checks),'checks':checks,'environment':'real local Auth/PostgREST; disposable fixtures','limitations':['No hosted deployment, physical device or clinical approval claimed.']}
        (ROOT/'docs/validation/sprint-04-admin-backend-results.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    finally:
        if users:
            ids=','.join("'"+str(uuid.UUID(u))+"'" for u in users)
            sql(f"""begin; set local session_replication_role=replica;
delete from public.prescription_versions where patient_id in ({ids}); delete from public.exercise_assignments where patient_id in ({ids});
delete from public.exercise_versions where exercise_id='{exercise}'; delete from public.exercises where id='{exercise}';
delete from public.patient_invitations where therapist_id in ({ids});
delete from public.therapist_patients where therapist_id in ({ids}) or patient_id in ({ids});
delete from public.audit_events where actor_id in ({ids}) or target_id in ({ids});
delete from public.patients where id in ({ids}); delete from public.user_roles where user_id in ({ids});
delete from public.profiles where id in ({ids}); delete from auth.users where id in ({ids}); commit;""")

if __name__=='__main__': main()
