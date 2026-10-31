"""Real local Auth/PostgREST integration checks using disposable synthetic users."""
import copy
from datetime import datetime, timezone
import json
import os
import re
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.request
import urllib.parse
import uuid

ROOT = Path(__file__).resolve().parents[1]


def main():
    raw = subprocess.run(['npx.cmd' if os.name == 'nt' else 'npx', '--yes', 'supabase@2.20.12', 'status', '-o', 'json'], cwd=ROOT, capture_output=True, text=True, check=True)
    config = json.loads(raw.stdout)
    base = config['API_URL'].rstrip('/')
    assert base in ['http://127.0.0.1:54321', 'http://localhost:54321'], 'Local stack only'
    users = []; checks = []; history_checks = []

    def sql(statement):
        result = subprocess.run(['docker', 'exec', '-i', 'supabase_db_motivance', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], input=statement, capture_output=True, text=True)
        if result.returncode: raise RuntimeError('Local SQL fixture operation failed: ' + result.stderr)
        return result.stdout.strip()

    def api(path, body=None, token=None, admin=False, method=None):
        key = config['SERVICE_ROLE_KEY'] if admin else config['ANON_KEY']
        headers = {'apikey': key, 'Content-Type': 'application/json'}
        if token or admin: headers['Authorization'] = 'Bearer ' + (token or key)
        req = urllib.request.Request(base+path, headers=headers, method=method or ('POST' if body is not None else 'GET'), data=json.dumps(body).encode() if body is not None else None)
        try:
            with urllib.request.urlopen(req, timeout=20) as response:
                data=response.read(); return response.status,json.loads(data) if data else None
        except urllib.error.HTTPError as error:
            # No server bodies/tokens are included in output.
            return error.code,None

    def check(condition, name):
        if not condition: raise AssertionError(name)
        checks.append(name); print('PASS '+name, flush=True)

    def history_check(condition, name):
        check(condition, name)
        history_checks.append(name)

    def rpc(name, body, token): return api('/rest/v1/rpc/'+name, body, token)

    def user(role):
        email='motivance-s3-'+uuid.uuid4().hex+'@example.test'; password=uuid.uuid4().hex+'Aa!9'
        code,result=api('/auth/v1/admin/users',{'email':email,'password':password,'email_confirm':True},admin=True)
        assert code==200
        uid=str(uuid.UUID(result['id'])); users.append(uid)
        sql(f"delete from public.user_roles where user_id='{uid}'; insert into public.user_roles(user_id,role) values('{uid}','{role}');")
        code,result=api('/auth/v1/token?grant_type=password',{'email':email,'password':password}); assert code==200
        return uid,email,result['access_token']

    try:
        t1,_,tt1=user('therapist'); t2,_,tt2=user('therapist'); p1,email1,tp1=user('patient'); p2,email2,tp2=user('patient')
        check(rpc('invite_patient',{'p_email':email1},None)[0]>=400,'Anonymous cannot invite')
        check(rpc('invite_patient',{'p_email':email1},tp1)[0]>=400,'Patient cannot invite or grant staff access')
        code,invite=rpc('invite_patient',{'p_email':email1},tt1)
        check(code==200 and len(invite['code'])==48,'Therapist prepares an invitation without a patient password')
        check(rpc('accept_patient_invitation',{'p_code':invite['code']},tp2)[0]>=400,'Invitation rejects a different patient email')
        check(rpc('accept_patient_invitation',{'p_code':invite['code']},tp1)[0]==200,'Matching patient accepts invitation')
        check(rpc('accept_patient_invitation',{'p_code':invite['code']},tp1)[0]==200,'Invitation acceptance retry is idempotent')
        _,inv2=rpc('invite_patient',{'p_email':email2},tt2); assert rpc('accept_patient_invitation',{'p_code':inv2['code']},tp2)[0]==200
        code,profiles=api('/rest/v1/patients?select=id,profiles:profiles!patients_id_fkey(display_name)&id=eq.'+p1,token=tt1)
        check(code==200 and len(profiles)==1 and isinstance(profiles[0]['profiles'],dict),'Android patient list uses the explicit profile relationship')
        for token,visible,hidden in [(tt1,p1,p2),(tt2,p2,p1),(tp1,p1,p2),(tp2,p2,p1)]:
            code,rows=api('/rest/v1/patients?select=id&id=in.('+visible+','+hidden+')',token=token)
            check(code==200 and rows==[{'id':visible}],'Direct API patient boundary '+str(len(checks)))
        assignment=str(uuid.uuid4()); version=str(uuid.uuid4()); exercise='21000000-0000-0000-0000-000000000001'
        params={'p_assignment':assignment,'p_version':version,'p_patient':p1,'p_exercise':exercise,'p_side':'left','p_low':20,'p_high':90,'p_repetitions':5,'p_parameters':{}}
        check(rpc('publish_prescription',params,tp1)[0]>=400,'Patient cannot prescribe')
        check(rpc('publish_prescription',params,tt2)[0]>=400,'Unassigned therapist cannot prescribe')
        check(rpc('publish_prescription',dict(params,p_high=10),tt1)[0]>=400,'Invalid target range rejected server-side')
        check(rpc('publish_prescription',dict(params,p_parameters={'minimum_cycle_ms':1}),tt1)[0]>=400,'Invalid timing rules rejected server-side')
        check(rpc('publish_prescription',params,tt1)[0]==200,'Therapist publishes supported versioned prescription')
        check(rpc('publish_prescription',params,tt1)[0]==200,'Prescription retry keeps the same version')
        code,rows=api('/rest/v1/prescription_versions?select=id&assignment_id=eq.'+assignment,token=tp1)
        check(code==200 and len(rows)==1,'Exactly one version after retry')
        check(rpc('publish_prescription',dict(params,p_version=str(uuid.uuid4()),p_high=110),tt1)[0]==200,'Editing appends a second immutable version')
        check(api('/rest/v1/prescription_versions?id=eq.'+version,{'maximum_degrees':170},tt1,method='PATCH')[0]>=400,'Historical prescription cannot be changed in place')
        details='exercise_assignments?select=id,patient_id,prescription_versions(id,version,parameters,side,minimum_degrees,maximum_degrees,target_repetitions,exercise_versions(id,algorithm_key,definition))&id=eq.'+assignment
        code,rows=api('/rest/v1/'+details,token=tp1)
        check(code==200 and len(rows[0]['prescription_versions'])==2,'Patient downloads instructions and both immutable versions')
        now=int(time.time()*1000); grant_id=str(uuid.uuid4())
        payload={'schemaVersion':2,'sessionId':str(uuid.uuid4()),'ownerId':p1,'consentId':grant_id,'startedAt':now-20000,'endedAt':now-10000,
            'rules':{'kind':'ELBOW_FLEXION','side':'LEFT','low':20,'high':90,'target':5,'confidence':.7,'stableFrames':5,'minimumCycleMs':600,'maximumCycleMs':30000,'peakHoldMs':100,'maxTrunkLean':20,'maxSpeed':600,'version':exercise,'prescription':version,'demo':False},
            'metrics':{'time':1000,'angle':10,'min':10,'max':100,'completed':5,'incomplete':0,'duration':1000,'valid':40,'invalid':2,'reasons':{}}}
        check(rpc('ingest_session',{'p_payload':payload},tp1)[0]>=400,'Session cannot upload without recording consent')
        consent={'p_id':grant_id,'p_event':'granted','p_version':'movement-summary-v1','p_occurred_at':datetime.fromtimestamp((now-30000)/1000,timezone.utc).isoformat()}
        check(rpc('record_consent',consent,tp1)[0]==200,'Grant consent recorded before session')
        check(rpc('record_consent',consent,tp1)[0]==200,'Consent upload retries are idempotent')
        check(rpc('ingest_session',{'p_payload':payload},tp2)[0]>=400,'Patient cannot upload another patient payload')
        check(api('/rest/v1/sessions',{},tp1)[0]>=400,'Direct session insert cannot bypass transactional RPC')
        broken=copy.deepcopy(payload); broken['sessionId']=str(uuid.uuid4()); broken['metrics']['completed']=-1
        check(rpc('ingest_session',{'p_payload':broken},tp1)[0]>=400,'Invalid child measurement rejects the entire transaction')
        _,rows=api('/rest/v1/sessions?select=id&id=eq.'+broken['sessionId'],token=tp1)
        check(rows==[],'No parent session remains after failed child insert')
        code,ack=rpc('ingest_session',{'p_payload':payload},tp1)
        check(code==200 and not ack['duplicate'],'Original pinned version uploads after newer prescription exists')
        code,ack=rpc('ingest_session',{'p_payload':payload},tp1)
        check(code==200 and ack['duplicate'],'Lost response after commit safely replays as duplicate acknowledgement')
        _,rows=api('/rest/v1/sessions?select=id,session_measurements(rom_degrees)&id=eq.'+payload['sessionId'],token=tt1)
        check(len(rows)==1 and len(rows[0]['session_measurements'])==1 and rows[0]['session_measurements'][0]['rom_degrees']==90,'Therapist sees exactly one session and one ROM result')
        # Exercise the exact Android embedding, including its explicit composite FK.
        source=(ROOT/'android/app/src/main/java/com/motivance/data/remote/HistoryJson.kt').read_text(encoding='utf-8')
        select_block=source.split('const val SELECT =',1)[1].split('fun path(',1)[0]
        history_select=''.join(re.findall(r'"([^"\n]*)"',select_block))
        history_query=[('select',history_select),('patient_id','eq.'+p1),('order','started_at.desc,id.desc'),('limit','51')]
        def history(token, extra=(), query=None):
            return api('/rest/v1/sessions?'+urllib.parse.urlencode((history_query if query is None else query)+list(extra)),token=token)
        code,history_rows=history(tt1)
        history_check(code==200 and len(history_rows)==1,'Android history embedding resolves the composite prescription relationship')
        recorded=history_rows[0]
        history_check(recorded['prescription']['id']==version and recorded['prescription']['maximum_degrees']==90 and recorded['prescription']['version']==1,
                      'History retains original prescription targets after a newer version is published')
        history_check(recorded['prescription']['exercise']['algorithm_key']=='elbow-flexion-v1' and recorded['session_measurements'][0]['valid_frames']==40,
                      'History includes exercise provenance and tracking counts')
        history_check(history(tt2)[1]==[] and history(tp2)[1]==[], 'History embedding enforces unassigned therapist and other patient isolation')
        history_check(history(tp1)[0]==200 and len(history(tp1)[1])==1,'Patient can read their own detailed history')
        history_check(history(None)[0]>=400,'Anonymous detailed history is denied')
        history_check(history(tt1,[('prescription.side','eq.right')])[1]==[],'Server side filter excludes the opposite prescribed side')
        history_check(history(tt1,[('prescription.exercise_version_id','eq.21000000-0000-0000-0000-000000000002')])[1]==[],
                      'Server exercise filter excludes a different exercise version')
        # Direct trusted fixture inserts deliberately cover historical empty/interrupted/multi-metric records.
        # They are scoped to the disposable patient, and are never clinical or ingestion evidence.
        sql(f"""insert into public.sessions(id,patient_id,prescription_version_id,started_at,ended_at,status,app_version,model_version,algorithm_version)
select gen_random_uuid(),'{p1}','{version}','2026-01-02T00:00:00Z','2026-01-02T00:01:00Z',
case when i=1 then 'interrupted' else 'completed' end,'fixture','fixture','history-fixture-v1' from generate_series(1,60) i;
insert into public.session_measurements(session_id,metric_key,side,minimum_degrees,maximum_degrees,completed_repetitions,incomplete_repetitions,quality,valid_frames,invalid_frames)
select id,'fixture-elbow','left',10,100,3,1,'limited',40,60 from public.sessions
where patient_id='{p1}' and algorithm_version='history-fixture-v1' and status='completed';
insert into public.session_measurements(session_id,metric_key,side,minimum_degrees,maximum_degrees,completed_repetitions,quality,valid_frames,invalid_frames)
values('{payload['sessionId']}','fixture-second','left',null,null,0,'invalid',0,20);""")
        code,first=history(tt1)
        history_check(code==200 and len(first)==51,'History returns a 50-record page plus one lookahead across tied timestamps')
        history_check(len(first[0]['session_measurements'])==2,'History preserves every measurement rather than selecting the first child')
        visible=first[:50]; cursor=visible[-1]
        # A newer upload after page one must not shift the keyset cursor or hide older rows.
        sql(f"""insert into public.sessions(id,patient_id,prescription_version_id,started_at,ended_at,status,app_version,model_version,algorithm_version)
values(gen_random_uuid(),'{p1}','{version}','2026-01-03T00:00:00Z','2026-01-03T00:01:00Z','completed','fixture','fixture','history-newer-fixture');""")
        code,second=history(tt1,[('or',f"(started_at.lt.{cursor['started_at']},and(started_at.eq.{cursor['started_at']},id.lt.{cursor['id']}))")])
        history_check(code==200 and len(second)==11 and not ({r['id'] for r in visible}&{r['id'] for r in second})
                      and len({r['id'] for r in visible+second})==61,'Keyset pagination retains all tied-time rows without overlap after a newer upload')
        date_query=[q for q in history_query if q[0]!='limit']+[('limit','100'),('started_at','gte.2026-01-02T00:00:00Z'),('started_at','lt.2026-01-03T00:00:00Z')]
        code,day=history(tt1,query=date_query)
        history_check(code==200 and len(day)==60,'Inclusive UTC date range includes start midnight and excludes the next day midnight')
        history_check(any(r['status']=='interrupted' and not r['session_measurements'] for r in day),
                      'Empty interrupted sessions remain visible through the history embedding')
        changed=copy.deepcopy(payload); changed['metrics']['completed']=6
        check(rpc('ingest_session',{'p_payload':changed},tp1)[0]>=400,'Reused UUID with changed payload is rejected')
        altered=copy.deepcopy(payload); altered['sessionId']=str(uuid.uuid4()); altered['rules']['high']=110
        check(rpc('ingest_session',{'p_payload':altered},tp1)[0]>=400,'Recorded thresholds cannot tamper with pinned prescription')
        _,rows=api('/rest/v1/session_measurements?select=session_id&session_id=eq.'+payload['sessionId'],token=tt2)
        check(rows==[],'Unassigned therapist cannot read child measurements directly')
        wid=str(uuid.uuid4()); withdrawal=dict(consent,p_id=wid,p_event='withdrawn',p_occurred_at=datetime.fromtimestamp((now-5000)/1000,timezone.utc).isoformat())
        check(rpc('record_consent',withdrawal,tp1)[0]==200,'Consent withdrawal recorded')
        after=copy.deepcopy(payload); after.update(sessionId=str(uuid.uuid4()),startedAt=now-4000,endedAt=now-1000)
        check(rpc('ingest_session',{'p_payload':after},tp1)[0]>=400,'Withdrawal prevents later session ingestion')
        request_id=str(uuid.uuid4())
        for _ in range(2): assert rpc('request_patient_data',{'p_id':request_id,'p_kind':'export'},tp1)[0]==200
        _,rows=api('/rest/v1/data_requests?select=id&id=eq.'+request_id,token=tp1)
        check(len(rows)==1,'Privacy request retry creates one tracked request')
        check(rpc('request_patient_data',{'p_id':request_id,'p_kind':'export'},tp2)[0]>=400,'Privacy request UUID cannot cross accounts')
        check(rpc('revoke_patient_link',{'p_patient':p1},tp1)[0]>=400,'Patient cannot mutate staff access links')
        code,unused_invite=rpc('invite_patient',{'p_email':email1},tt1)
        check(code==200,'Prepare an unused invitation before access revocation')
        check(rpc('revoke_patient_link',{'p_patient':p1},tt1)[0] in (200,204),'Therapist revokes own patient link')
        check(rpc('accept_patient_invitation',{'p_code':unused_invite['code']},tp1)[0]>=400,'Revocation invalidates older unused invitations')
        _,rows=api('/rest/v1/sessions?select=id&id=eq.'+payload['sessionId'],token=tt1)
        check(rows==[],'Revoked therapist loses future history access immediately')
        history_check(history(tt1)[1]==[],'Revoked therapist also loses detailed embedded history access')
        check(rpc('ingest_session',{'p_payload':dict(payload,sessionId=str(uuid.uuid4()))},tp1)[0]>=400,'Revoked assignment rejects new queued uploads')
        check(int(sql(f"select count(*) from public.audit_events where actor_id in ('{t1}','{t2}');"))>=5,'Trusted audit captures invitations, links and prescriptions')
        report={'generated_at':datetime.now(timezone.utc).isoformat(),'environment':'isolated local Supabase; four disposable users','checks_passed':len(checks),'checks':checks,'limitations':['Android network/process behavior is additionally covered by instrumented persistence/sync tests; no physical patient accuracy is asserted.']}
        (ROOT/'docs/validation/sprint-03-backend-results.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
        history_report={'generated_at':datetime.now(timezone.utc).isoformat(),'environment':'local Supabase; disposable synthetic fixtures',
                        'checks_passed':len(history_checks),'checks':history_checks,
                        'limitations':['Fixture-only history; no therapist, clinical accuracy or physical-device validation is claimed.']}
        (ROOT/'docs/validation/sprint-04-history-backend-results.json').write_text(json.dumps(history_report,indent=2)+'\n',encoding='utf-8')
    finally:
        if users:
            ids=','.join("'"+str(uuid.UUID(u))+"'" for u in users)
            # Scoped fixture cleanup; immutable-history triggers are bypassed only in this admin transaction.
            sql(f"""begin; set local session_replication_role=replica;
delete from public.session_measurements where session_id in (select id from public.sessions where patient_id in ({ids}));
delete from public.sessions where patient_id in ({ids}); delete from public.consents where patient_id in ({ids});
delete from public.prescription_versions where patient_id in ({ids}); delete from public.exercise_assignments where patient_id in ({ids});
delete from public.data_requests where patient_id in ({ids}); delete from public.patient_invitations where therapist_id in ({ids});
delete from public.therapist_patients where therapist_id in ({ids}) or patient_id in ({ids});
delete from public.audit_events where actor_id in ({ids}) or target_id in ({ids});
delete from public.patients where id in ({ids}); delete from public.user_roles where user_id in ({ids});
delete from public.profiles where id in ({ids}); delete from auth.users where id in ({ids}); commit;""")


if __name__=='__main__': main()
