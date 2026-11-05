"""Custom exercise access rules on the local stack, using disposable synthetic accounts.

With an emulator attached this also runs LiveCustomExerciseTest, which drives the app's real repository, cache and upload
code. Install the app and test APKs first with `adb install -r`, as Gradle's connected task signs out the emulator:

    adb install -r android/app/build/outputs/apk/debug/app-debug.apk
    adb install -r -t android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
    python scripts/test_custom_exercises.py
"""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
ADB = shutil.which('adb') or os.path.expandvars(r'%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe')
TEST = 'com.motivance.feature.rehabilitation.LiveCustomExerciseTest'
RUNNER = 'com.motivance.debug.test/androidx.test.runner.AndroidJUnitRunner'
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
        email = f'motivance-custom-{uuid.uuid4().hex}@example.test'; password = uuid.uuid4().hex + 'Aa!9'
        code, result = api('/auth/v1/admin/users', {'email': email, 'password': password, 'email_confirm': True}, admin=True)
        assert code == 200
        uid = str(uuid.UUID(result['id'])); users.append(uid)
        sql(f"delete from public.user_roles where user_id='{uid}'; insert into public.user_roles(user_id,role) values('{uid}','{role}');")
        code, result = api('/auth/v1/token?grant_type=password', {'email': email, 'password': password}); assert code == 200
        return {'id': uid, 'email': email, 'password': password, 'token': result['access_token']}

    def link(therapist, patient):
        code = rpc('invite_patient', {'p_email': patient['email']}, therapist['token'])[1]['code']
        assert rpc('accept_patient_invitation', {'p_code': code}, patient['token'])[0] == 200

    def readable(version, account):
        return api(f'/rest/v1/exercise_versions?select=id,definition&id=eq.{version}', token=account['token'])[1] != []

    try:
        t1, t2, p1, p2 = user('therapist'), user('therapist'), user('patient'), user('patient')
        link(t1, p1); link(t2, p2)
        exercise = str(uuid.uuid4())
        draft = {'p_id': exercise, 'p_name': ' Seated knee extension ', 'p_joint': 'KNEE', 'p_english': 'Sit tall.', 'p_filipino': 'Umupo nang tuwid.'}

        check(rpc('create_custom_exercise', draft, None)[0] >= 400, 'Anonymous cannot create an exercise')
        check(rpc('create_custom_exercise', draft, p1['token'])[0] >= 400, 'Patient cannot create an exercise')
        check(rpc('create_custom_exercise', dict(draft, p_joint='NECK'), t1['token'])[0] >= 400, 'A joint the app cannot measure is rejected')
        check(rpc('create_custom_exercise', dict(draft, p_name='   '), t1['token'])[0] >= 400, 'A blank name is rejected')
        check(rpc('create_custom_exercise', dict(draft, p_english=''), t1['token'])[0] >= 400, 'Blank instructions are rejected')
        check(rpc('create_custom_exercise', dict(draft, p_name='x' * 121), t1['token'])[0] >= 400, 'An overlong name is rejected')

        code, version = rpc('create_custom_exercise', draft, t1['token'])
        check(code == 200 and uuid.UUID(version), 'Therapist creates a custom exercise')
        check(rpc('create_custom_exercise', draft, t1['token'])[1] == version, 'A retry returns the same exercise')
        check(rpc('create_custom_exercise', dict(draft, p_name='Changed'), t1['token'])[0] >= 400, 'A reused request ID with different content is rejected')
        check(rpc('create_custom_exercise', draft, t2['token'])[0] >= 400, 'Another therapist cannot take over a request ID')
        code, rows = api(f'/rest/v1/exercise_versions?select=definition&id=eq.{version}', token=t1['token'])
        check(rows[0]['definition']['name'] == 'Seated knee extension' and rows[0]['definition']['measured_joint'] == 'KNEE', 'The name is trimmed and the joint stored')
        code, rows = api(f'/rest/v1/exercise_versions?select=id,exercises(id,owner_id)&id=eq.{version}', token=t1['token'])
        check(rows[0]['exercises']['owner_id'] == t1['id'], 'The owner sees their exercise in the catalogue query')

        check(not readable(version, t2), 'Another therapist cannot read a custom exercise')
        check(not readable(version, p1), 'A patient cannot read it before it is assigned')
        check(readable(ELBOW, t2) and readable(ELBOW, p2), 'Built-in exercises stay readable by everyone')

        def prescription(patient, version_id, **extra):
            return dict({'p_assignment': str(uuid.uuid4()), 'p_version': str(uuid.uuid4()), 'p_patient': patient['id'], 'p_exercise': version_id, 'p_side': 'right', 'p_low': 15, 'p_high': 80, 'p_repetitions': 6, 'p_parameters': {}}, **extra)

        check(rpc('publish_prescription', prescription(p2, version), t2['token'])[0] >= 400, "Another therapist cannot prescribe it to their own patient")
        check(rpc('publish_prescription', prescription(p2, version), t1['token'])[0] >= 400, 'The owner cannot prescribe it to an unlinked patient')
        assigned = prescription(p1, version)
        check(rpc('publish_prescription', assigned, t1['token'])[0] == 200, 'The owner prescribes it to their patient')
        check(rpc('publish_prescription', prescription(p1, ELBOW), t1['token'])[0] == 200, 'Built-in exercises can still be prescribed')
        check(readable(version, p1), 'The assigned patient can read it')
        check(not readable(version, p2) and not readable(version, t2), 'Unrelated accounts still cannot read it')

        now = int(time.time() * 1000); grant = str(uuid.uuid4())
        assert rpc('record_consent', {'p_id': grant, 'p_event': 'granted', 'p_version': 'movement-summary-v1', 'p_occurred_at': datetime.fromtimestamp((now - 30000) / 1000, timezone.utc).isoformat()}, p1['token'])[0] == 200

        def session(**rules):
            return {'p_payload': {'schemaVersion': 2, 'sessionId': str(uuid.uuid4()), 'ownerId': p1['id'], 'consentId': grant, 'startedAt': now - 20000, 'endedAt': now - 10000,
                'rules': dict({'kind': 'CUSTOM', 'measuredJoint': 'KNEE', 'focusJoint': 'KNEE', 'exerciseName': 'Seated knee extension', 'side': 'RIGHT', 'low': 15, 'high': 80, 'target': 6, 'confidence': .7, 'stableFrames': 5,
                               'minimumCycleMs': 600, 'maximumCycleMs': 30000, 'peakHoldMs': 100, 'maxTrunkLean': 20, 'maxSpeed': 600, 'version': version, 'prescription': assigned['p_version'], 'demo': False}, **rules),
                'metrics': {'time': 1000, 'angle': 10, 'min': 10, 'max': 85, 'completed': 6, 'incomplete': 0, 'duration': 1000, 'valid': 40, 'invalid': 2, 'reasons': {}}}}

        check(rpc('ingest_session', session(measuredJoint='ELBOW'), p1['token'])[0] >= 400, 'An upload measuring a different joint is rejected')
        check(rpc('ingest_session', session(kind='ELBOW_FLEXION'), p1['token'])[0] >= 400, 'An upload claiming a built-in kind is rejected')
        check(rpc('ingest_session', session(focusJoint='HIP'), p1['token'])[0] >= 400, 'An upload with a different focus is rejected')
        check(rpc('ingest_session', session(), p1['token'])[0] == 200, 'A matching session uploads')
        check(sql(f"select count(*) from public.session_measurements m join public.sessions s on s.id=m.session_id where s.patient_id='{p1['id']}' and m.metric_key='joint-angle-v1'") == '1', 'The therapist-facing result is stored under the custom measurement')

        check(rpc('archive_custom_exercise', {'p_exercise': exercise}, t2['token'])[0] >= 400, 'Another therapist cannot remove it')
        check(rpc('archive_custom_exercise', {'p_exercise': exercise}, p1['token'])[0] >= 400, 'A patient cannot remove it')
        check(rpc('archive_custom_exercise', {'p_exercise': ELBOW}, t1['token'])[0] >= 400, 'A therapist cannot remove a built-in exercise')
        check(rpc('archive_custom_exercise', {'p_exercise': exercise}, t1['token'])[0] < 300, 'The owner removes it')
        check(rpc('publish_prescription', prescription(p1, version), t1['token'])[0] >= 400, 'A removed exercise cannot be newly prescribed')
        check(readable(version, p1) and readable(version, t1), 'Existing assignments and history keep the exercise')
        code, rows = api(f'/rest/v1/exercise_versions?select=id,exercises(id)&id=eq.{version}', token=t1['token'])
        check(rows[0]['exercises'] is None, 'The catalogue query can tell it has been removed')
        check(rpc('ingest_session', session(), p1['token'])[0] == 200, 'A session recorded before removal still uploads')

        devices = subprocess.run([ADB, 'devices'], capture_output=True, text=True).stdout if Path(ADB).exists() or shutil.which('adb') else ''
        if 'emulator-' in devices:
            t3, p3 = user('therapist'), user('patient')
            link(t3, p3)
            output = subprocess.run([ADB, 'shell', 'am', 'instrument', '-w', '-e', 'class', TEST, '-e', 'therapistEmail', t3['email'], '-e', 'therapistPassword', t3['password'],
                                     '-e', 'patientEmail', p3['email'], '-e', 'patientPassword', p3['password'], '-e', 'patientId', p3['id'], RUNNER], capture_output=True, text=True, timeout=240).stdout
            print(output.replace(t3['password'], '***').replace(p3['password'], '***'))
            check('OK (1 test)' in output, 'The app carries a custom exercise from therapist to patient and back')
        else:
            print('SKIPPED LiveCustomExerciseTest: no emulator attached')
        print(f'{len(passed)} custom exercise checks passed.')
        return 0
    finally:
        if users:
            ids = ','.join("'" + str(uuid.UUID(u)) + "'" for u in users)
            # Scoped fixture cleanup; immutable-history triggers are bypassed only in this admin transaction.
            sql(f"""begin; set local session_replication_role=replica;
delete from public.session_measurements where session_id in (select id from public.sessions where patient_id in ({ids}));
delete from public.sessions where patient_id in ({ids}); delete from public.consents where patient_id in ({ids});
delete from public.prescription_versions where patient_id in ({ids}); delete from public.exercise_assignments where patient_id in ({ids});
delete from public.exercise_versions where exercise_id in (select id from public.exercises where owner_id in ({ids}));
delete from public.exercises where owner_id in ({ids});
delete from public.patient_invitations where therapist_id in ({ids});
delete from public.therapist_patients where therapist_id in ({ids}) or patient_id in ({ids});
delete from public.audit_events where actor_id in ({ids}) or target_id in ({ids});
delete from public.patients where id in ({ids}); delete from public.user_roles where user_id in ({ids});
delete from public.profiles where id in ({ids}); delete from auth.users where id in ({ids}); commit;""")


if __name__ == '__main__':
    sys.exit(main())
