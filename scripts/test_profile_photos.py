"""Exercise signed Cloudinary profile-photo RPCs through real local Auth/PostgREST with disposable users.

Cloudinary itself is not contacted. The test computes the signatures Cloudinary would compute and checks that
the server issues and verifies them. If no Cloudinary configuration exists in local Vault, temporary fixture
secrets are created and removed afterwards. An existing configuration is used read-only and never printed.
"""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
NAMES = ('cloud_name', 'api_key', 'api_secret')

def main():
    raw = subprocess.run(['npx.cmd' if os.name == 'nt' else 'npx', '--yes', 'supabase@2.20.12', 'status', '-o', 'json'], cwd=ROOT, capture_output=True, text=True, check=True)
    config = json.loads(raw.stdout)
    base = config['API_URL'].rstrip('/')
    assert base in ('http://127.0.0.1:54321', 'http://localhost:54321'), 'Disposable local fixtures only'
    users = []; checks = []; fixture_secrets = False
    def sql(statement):
        p = subprocess.run(['docker','exec','-i','supabase_db_motivance','psql','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1'], input=statement, capture_output=True, text=True)
        if p.returncode: raise RuntimeError('SQL failed')
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
    def rpc(name,body,token=None): return api('/rest/v1/rpc/'+name,body,token)
    def check(condition,name):
        if not condition: raise AssertionError(name)
        checks.append(name);print('PASS '+name,flush=True)
    def user(role='patient'):
        email='photo-'+uuid.uuid4().hex+'@example.test';password=uuid.uuid4().hex+'Aa!9'
        status,created=api('/auth/v1/admin/users',{'email':email,'password':password,'email_confirm':True},privileged=True);assert status==200
        uid=str(uuid.UUID(created['id']));users.append(uid)
        if role!='patient': sql(f"insert into public.user_roles(user_id,role) values('{uid}','{role}');")
        status,session=api('/auth/v1/token?grant_type=password',{'email':email,'password':password});assert status==200
        return uid,session['access_token']
    def secret(name): return sql(f"select decrypted_secret from vault.decrypted_secrets where name='cloudinary_{name}' order by created_at desc limit 1;")
    def sign(payload,value,algorithm='sha1'): return hashlib.new(algorithm,(payload+value).encode()).hexdigest()
    try:
        configured=all(secret(n) for n in NAMES)
        patient,tp=user();other,to=user();therapist,tt=user('therapist');admin,ta=user('admin')
        if not configured:
            check(rpc('profile_photo_upload',{},tp)[0]==503,'Unconfigured uploads report service unavailable')
            fixture_secrets=True
            values={'cloud_name':'motivance-fixture','api_key':'123456789012345','api_secret':'fixture-'+uuid.uuid4().hex}
            sql(''.join(f"select vault.create_secret('{v}','cloudinary_{k}','Temporary test fixture');" for k,v in values.items()))
        cloud,api_secret=secret('cloud_name'),secret('api_secret')
        check(rpc('profile_photo_upload',{})[0]>=400,'Anonymous cannot request an upload signature')
        check(rpc('set_my_profile_photo',{'p_public_id':'x','p_version':1,'p_signature':'x'})[0]>=400,'Anonymous cannot save a photo')
        code,ticket=rpc('profile_photo_upload',{},tp)
        check(code==200 and {'cloud_name','api_key','timestamp','public_id','signature'}<=set(ticket),'Active user receives an upload ticket')
        check('api_secret' not in json.dumps(ticket) and api_secret not in json.dumps(ticket),'Ticket never contains the API secret')
        check(re.fullmatch(rf'motivance/avatars/{patient}/[0-9a-f]{{32}}',ticket['public_id']) is not None,'Public ID is server chosen inside the caller folder')
        check(ticket['signature']==sign(f"public_id={ticket['public_id']}&timestamp={ticket['timestamp']}",api_secret),'Upload signature matches Cloudinary request signing')
        check(abs(ticket['timestamp']-datetime.now(timezone.utc).timestamp())<120,'Ticket timestamp is current')
        pid=ticket['public_id'];version=1730700000
        check(rpc('set_my_profile_photo',{'p_public_id':pid,'p_version':version,'p_signature':'0'*40},tp)[0]>=400,'Forged response signature rejected')
        valid=sign(f'public_id={pid}&version={version}',api_secret)
        check(rpc('set_my_profile_photo',{'p_public_id':pid,'p_version':version,'p_signature':valid},to)[0]>=400,'Another user cannot claim this upload')
        check(sql(f"select photo_url is null from public.profiles where id='{patient}';")=='t','Rejected attempts leave no photo')
        code,url=rpc('set_my_profile_photo',{'p_public_id':pid,'p_version':version,'p_signature':valid.upper()},tp)
        check(code==200 and url==f'https://res.cloudinary.com/{cloud}/image/upload/v{version}/{pid}','Verified upload is saved as a delivery URL')
        check(rpc('set_my_profile_photo',{'p_public_id':pid,'p_version':version,'p_signature':valid},tp)[0]>=400,'An upload cannot be applied twice')
        code,rows=api(f'/rest/v1/profiles?select=photo_url&id=eq.{patient}',token=tp)
        check(code==200 and rows==[{'photo_url':url}],'Owner reads own photo')
        check(api(f'/rest/v1/profiles?select=photo_url&id=eq.{patient}',token=to)[1]==[],'Unrelated patient cannot read the photo')
        check(api(f'/rest/v1/profiles?select=photo_url&id=eq.{patient}',token=tt)[1]==[],'Unlinked therapist cannot read the photo')
        sql(f"insert into public.therapist_patients(therapist_id,patient_id,active) values('{therapist}','{patient}',true);")
        code,rows=api('/rest/v1/patients?select=id,profiles:profiles!patients_id_fkey(display_name,photo_url)&id=eq.'+patient,token=tt)
        check(code==200 and rows and rows[0]['profiles']['photo_url']==url,'Linked therapist reads the photo through the patient list embed')
        api(f'/rest/v1/profiles?id=eq.{patient}',{'photo_url':None},tp,method='PATCH')
        check(sql(f"select photo_url from public.profiles where id='{patient}';")==url,'Owner cannot write the photo column directly')
        _,second=rpc('profile_photo_upload',{},tp)
        sha256=sign(f"public_id={second['public_id']}&version=2",api_secret,'sha256')
        code,url2=rpc('set_my_profile_photo',{'p_public_id':second['public_id'],'p_version':2,'p_signature':sha256},tp)
        check(code==200 and url2.endswith(second['public_id']),'SHA-256 response signatures are accepted')
        check(sql(f"select retired_at is not null from public.profile_photo_uploads where public_id='{pid}';")=='t','Replaced photo is marked for Cloudinary cleanup')
        code,accounts=rpc('admin_accounts',{'p_search':str(patient)},ta)
        check(code==200 and accounts[0]['photo_url']==url2,'Administrator directory includes the photo')
        check(rpc('admin_clear_photo',{'p_user':patient},tt)[0]>=400,'Therapist cannot use photo moderation')
        check(rpc('admin_clear_photo',{'p_user':patient},ta)[0] in (200,204),'Administrator removes a photo')
        check(sql(f"select photo_url is null from public.profiles where id='{patient}';")=='t','Moderated photo is cleared')
        check(sql(f"select count(*) from public.audit_events where actor_id='{admin}' and action='remove_photo' and target_id='{patient}';")=='1','Photo moderation is audited with the administrator as actor')
        _,third=rpc('profile_photo_upload',{},to)
        rpc('set_my_profile_photo',{'p_public_id':third['public_id'],'p_version':3,'p_signature':sign(f"public_id={third['public_id']}&version=3",api_secret)},to)
        check(rpc('clear_my_profile_photo',{},to)[0] in (200,204) and sql(f"select photo_url is null from public.profiles where id='{other}';")=='t','Owner removes own photo')
        statuses=[rpc('profile_photo_upload',{},to)[0] for _ in range(10)]
        check(statuses[:9]==[200]*9 and statuses[9]==429,'Upload tickets are limited to ten per hour')
        check(sql(f"select count(*) from public.audit_events where actor_id='{patient}' and action='update_photo';")=='2','Photo changes are audited')
        report={'generated_at':datetime.now(timezone.utc).isoformat(),'checks_passed':len(checks),'checks':checks,
                'environment':'real local Auth/PostgREST; disposable users; '+('temporary fixture Vault secrets' if fixture_secrets else 'existing local Vault configuration (not recorded)'),
                'limitations':['Cloudinary was not contacted; signatures follow the documented Cloudinary algorithm.']}
        (ROOT/'docs/validation/profile-photo-backend-results.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    finally:
        if users:
            ids=','.join("'"+str(uuid.UUID(u))+"'" for u in users)
            sql(f"""begin; set local session_replication_role=replica;
delete from public.profile_photo_uploads where user_id in ({ids});
delete from public.therapist_patients where therapist_id in ({ids}) or patient_id in ({ids});
delete from public.audit_events where actor_id in ({ids}) or target_id in ({ids});
delete from public.patients where id in ({ids}); delete from public.user_roles where user_id in ({ids});
delete from public.notification_deliveries where notification_id in (select id from public.notifications where user_id in ({ids}) or subject_id in ({ids})); delete from public.notifications where user_id in ({ids}) or subject_id in ({ids}); delete from public.notification_settings where user_id in ({ids}); delete from public.profiles where id in ({ids}); delete from auth.users where id in ({ids}); commit;""")
        if fixture_secrets: sql("delete from vault.secrets where name like 'cloudinary\\_%' and description='Temporary test fixture';")

if __name__=='__main__': main()
