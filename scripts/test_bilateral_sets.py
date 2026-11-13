"""Both-sides prescriptions and a time per side, on the local stack, using disposable synthetic accounts.

A Both prescription is one plan whose sides are recorded as separate sessions. Each upload carries the side it measured,
and that side is what the measurement stores. A time per side is pinned to the plan like the other timing rules.

    python scripts/test_bilateral_sets.py
"""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
ELBOW = '21000000-0000-0000-0000-000000000001'


def main():
    raw = subprocess.run(['npx.cmd' if os.name == 'nt' else 'npx', '--yes', 'supabase@2.20.12', 'status', '-o', 'json'], cwd=ROOT, capture_output=True, text=True, check=True)
    config = json.loads(raw.stdout)
    base = config['API_URL'].rstrip('/')
    assert base in ['http://127.0.0.1:54321', 'http://localhost:54321'], 'Local stack only'
    users = []
    passed = []

    def sql(statement):
        result = subprocess.run(['docker', 'exec', '-i', 'supabase_db_motivance', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], input=statement, capture_output=True, text=True)
        if result.returncode: raise RuntimeError('Local SQL fixture operation failed: ' + result.stderr)
        return result.stdout.strip()

    def api(path, body=None, token=None, admin=False):
        key = config['SERVICE_ROLE_KEY'] if admin else config['ANON_KEY']
        headers = {'apikey': key, 'Content-Type': 'application/json'}
        if token or admin: headers['Authorization'] = 'Bearer ' + (token or key)
        request = urllib.request.Request(base + path, headers=headers, method='POST' if body is not None else 'GET', data=json.dumps(body).encode() if body is not None else None)
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                data = response.read()
                return response.status, json.loads(data) if data else None
        except urllib.error.HTTPError as error:
            return error.code, None

    def rpc(name, body, token): return api('/rest/v1/rpc/' + name, body, token)

    def check(condition, name):
        if not condition: raise AssertionError(name)
        passed.append(name); print('PASS ' + name, flush=True)

    def user(role):
        email = f'motivance-sets-{uuid.uuid4().hex}@example.test'; password = uuid.uuid4().hex + 'Aa!9'
        code, result = api('/auth/v1/admin/users', {'email': email, 'password': password, 'email_confirm': True}, admin=True)
        assert code == 200
        uid = str(uuid.UUID(result['id'])); users.append(uid)
        sql(f"delete from public.user_roles where user_id='{uid}'; insert into public.user_roles(user_id,role) values('{uid}','{role}');")
        code, result = api('/auth/v1/token?grant_type=password', {'email': email, 'password': password}); assert code == 200
        return {'id': uid, 'email': email, 'password': password, 'token': result['access_token']}

    def link(therapist, patient):
        code = rpc('invite_patient', {'p_email': patient['email']}, therapist['token'])[1]['code']
        assert rpc('accept_patient_invitation', {'p_code': code}, patient['token'])[0] == 200

    try:
        therapist, patient = user('therapist'), user('patient')
        link(therapist, patient)

        def plan(side, parameters):
            return {'p_assignment': str(uuid.uuid4()), 'p_version': str(uuid.uuid4()), 'p_patient': patient['id'], 'p_exercise': ELBOW,
                    'p_side': side, 'p_low': 20, 'p_high': 90, 'p_repetitions': 5, 'p_parameters': parameters}

        def publish(side, parameters): return rpc('publish_prescription', plan(side, parameters), therapist['token'])[0]

        both = plan('bilateral', {'side_seconds': 90})
        check(publish('bilateral', {}) == 200, 'Both sides publishes')
        check(rpc('publish_prescription', both, therapist['token'])[0] == 200, 'Both sides with a time publishes')
        check(publish('bilateral', {'side_seconds': 14}) >= 400, 'A time below 15 s is rejected')
        check(publish('bilateral', {'side_seconds': 1801}) >= 400, 'A time above 30 min is rejected')
        check(publish('bilateral', {'side_seconds': 20.5}) >= 400, 'A fractional time is rejected')
        check(publish('bilateral', {'side_seconds': '90'}) >= 400, 'A text time is rejected')
        left = plan('left', {})
        timed_left = plan('left', {'side_seconds': 15})
        check(rpc('publish_prescription', left, therapist['token'])[0] == 200, 'A single side publishes')
        check(rpc('publish_prescription', timed_left, therapist['token'])[0] == 200, 'A single side with a time publishes')

        now = int(time.time() * 1000); grant = str(uuid.uuid4())
        assert rpc('record_consent', {'p_id': grant, 'p_event': 'granted', 'p_version': 'movement-summary-v1', 'p_occurred_at': datetime.fromtimestamp((now - 30000) / 1000, timezone.utc).isoformat()}, patient['token'])[0] == 200

        def upload(prescription, drop=(), **rules):
            recorded = dict({'kind': 'ELBOW_FLEXION', 'side': 'LEFT', 'low': 20, 'high': 90, 'target': 5, 'confidence': .7, 'stableFrames': 5,
                             'minimumCycleMs': 600, 'maximumCycleMs': 30000, 'peakHoldMs': 100, 'maxTrunkLean': 20, 'maxSpeed': 600,
                             'version': ELBOW, 'prescription': prescription['p_version'], 'demo': False}, **rules)
            for key in drop: recorded.pop(key)
            session = str(uuid.uuid4())
            code = rpc('ingest_session', {'p_payload': {'schemaVersion': 2, 'sessionId': session, 'ownerId': patient['id'], 'consentId': grant,
                'startedAt': now - 20000, 'endedAt': now - 10000, 'rules': recorded,
                'metrics': {'time': 1000, 'angle': 10, 'min': 10, 'max': 85, 'completed': 6, 'incomplete': 0, 'duration': 1000, 'valid': 40, 'invalid': 2, 'reasons': {}}}}, patient['token'])[0]
            return code, session

        def measured_side(session): return sql(f"select side from public.session_measurements where session_id='{session}'")

        code, session = upload(both, side='LEFT', bilateral=True, sideSeconds=90)
        check(code == 200 and measured_side(session) == 'left', 'The left side of a Both set uploads and stores left')
        code, session = upload(both, side='RIGHT', bilateral=True, sideSeconds=90)
        check(code == 200 and measured_side(session) == 'right', 'The right side of a Both set uploads and stores right')
        check(upload(both, side='BILATERAL', bilateral=True, sideSeconds=90)[0] >= 400, 'A recorded side of BILATERAL is rejected')
        check(upload(both, side='LEFT', sideSeconds=90)[0] >= 400, 'A Both set upload without the bilateral flag is rejected')
        check(upload(both, side='LEFT', bilateral=True, sideSeconds=60)[0] >= 400, 'A recorded time that differs is rejected')
        check(upload(both, side='LEFT', bilateral=True)[0] >= 400, 'A recorded time missing from a timed plan is rejected')
        check(upload(left, side='LEFT', bilateral=True)[0] >= 400, 'The bilateral flag on a single-side plan is rejected')
        check(upload(left, side='RIGHT')[0] >= 400, 'A single-side plan still rejects the other side')
        check(upload(left, side='LEFT', sideSeconds=15)[0] >= 400, 'A time on an untimed plan is rejected')
        code, session = upload(left, side='LEFT')
        check(code == 200 and measured_side(session) == 'left', 'A legacy single-side upload still works')
        check(upload(timed_left, side='LEFT', sideSeconds=15)[0] == 200, 'A single-side upload with its matching time works')
        return 0
    finally:
        if users:
            ids = ','.join("'" + str(uuid.UUID(u)) + "'" for u in users)
            # Scoped fixture cleanup; immutable-history triggers are bypassed only in this admin transaction.
            sql(f"""begin; set local session_replication_role=replica;
delete from public.session_measurements where session_id in (select id from public.sessions where patient_id in ({ids}));
delete from public.sessions where patient_id in ({ids}); delete from public.consents where patient_id in ({ids});
delete from public.prescription_versions where patient_id in ({ids}); delete from public.exercise_assignments where patient_id in ({ids});
delete from public.patient_invitations where therapist_id in ({ids});
delete from public.therapist_patients where therapist_id in ({ids}) or patient_id in ({ids});
delete from public.audit_events where actor_id in ({ids}) or target_id in ({ids});
delete from public.patients where id in ({ids}); delete from public.user_roles where user_id in ({ids});
delete from public.notification_deliveries where notification_id in (select id from public.notifications where user_id in ({ids}) or subject_id in ({ids})); delete from public.notifications where user_id in ({ids}) or subject_id in ({ids}); delete from public.notification_settings where user_id in ({ids}); delete from public.profiles where id in ({ids}); delete from auth.users where id in ({ids}); commit;""")
            print(f'{len(passed)} checks passed', flush=True)


if __name__ == '__main__':
    sys.exit(main())
