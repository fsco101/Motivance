"""Therapist-to-patient delivery on an emulator against the local stack, using disposable synthetic accounts.

Install the app and test APKs first. This uses `adb install -r` rather than Gradle's connected task, which uninstalls
the app and would sign out whoever is using the emulator:

    adb install -r android/app/build/outputs/apk/debug/app-debug.apk
    adb install -r -t android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
    python scripts/test_assignment_delivery.py
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
ADB = shutil.which('adb') or os.path.expandvars(r'%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe')
TEST = 'com.motivance.feature.rehabilitation.LiveAssignmentDeliveryTest'
RUNNER = 'com.motivance.debug.test/androidx.test.runner.AndroidJUnitRunner'


def main():
    raw = subprocess.run(['npx.cmd' if os.name == 'nt' else 'npx', '--yes', 'supabase@2.20.12', 'status', '-o', 'json'], cwd=ROOT, capture_output=True, text=True, check=True)
    config = json.loads(raw.stdout)
    base = config['API_URL'].rstrip('/')
    assert base in ['http://127.0.0.1:54321', 'http://localhost:54321'], 'Local stack only'

    def sql(statement):
        result = subprocess.run(['docker', 'exec', '-i', 'supabase_db_motivance', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], input=statement, capture_output=True, text=True)
        if result.returncode: raise RuntimeError('Local SQL fixture operation failed: ' + result.stderr)
        return result.stdout.strip()

    def api(path, body, token=None, admin=False):
        key = config['SERVICE_ROLE_KEY'] if admin else config['ANON_KEY']
        headers = {'apikey': key, 'Content-Type': 'application/json'}
        if token or admin: headers['Authorization'] = 'Bearer ' + (token or key)
        request = urllib.request.Request(base + path, headers=headers, method='POST', data=json.dumps(body).encode())
        with urllib.request.urlopen(request, timeout=20) as response:
            data = response.read()
            return json.loads(data) if data else None

    users = []

    def user(role):
        email = f'motivance-delivery-{uuid.uuid4().hex}@example.test'; password = uuid.uuid4().hex + 'Aa!9'
        uid = str(uuid.UUID(api('/auth/v1/admin/users', {'email': email, 'password': password, 'email_confirm': True}, admin=True)['id']))
        users.append(uid)
        sql(f"delete from public.user_roles where user_id='{uid}'; insert into public.user_roles(user_id,role) values('{uid}','{role}');")
        token = api('/auth/v1/token?grant_type=password', {'email': email, 'password': password})['access_token']
        return {'id': uid, 'email': email, 'password': password, 'token': token}

    try:
        therapist = user('therapist'); patient = user('patient')
        code = api('/rest/v1/rpc/invite_patient', {'p_email': patient['email']}, therapist['token'])['code']
        api('/rest/v1/rpc/accept_patient_invitation', {'p_code': code}, patient['token'])
        output = subprocess.run([ADB, 'shell', 'am', 'instrument', '-w', '-e', 'class', TEST,
                                 '-e', 'therapistEmail', therapist['email'], '-e', 'therapistPassword', therapist['password'],
                                 '-e', 'patientEmail', patient['email'], '-e', 'patientPassword', patient['password'],
                                 '-e', 'patientId', patient['id'], RUNNER], capture_output=True, text=True, timeout=240).stdout
        print(output.replace(therapist['password'], '***').replace(patient['password'], '***'))
        return 0 if 'OK (1 test)' in output else 1
    finally:
        if users:
            ids = ','.join("'" + str(uuid.UUID(u)) + "'" for u in users)
            # Scoped fixture cleanup; immutable-history triggers are bypassed only in this admin transaction.
            sql(f"""begin; set local session_replication_role=replica;
delete from public.prescription_versions where patient_id in ({ids}); delete from public.exercise_assignments where patient_id in ({ids});
delete from public.patient_invitations where therapist_id in ({ids});
delete from public.therapist_patients where therapist_id in ({ids}) or patient_id in ({ids});
delete from public.audit_events where actor_id in ({ids}) or target_id in ({ids});
delete from public.patients where id in ({ids}); delete from public.user_roles where user_id in ({ids});
delete from public.profiles where id in ({ids}); delete from auth.users where id in ({ids}); commit;""")


if __name__ == '__main__':
    sys.exit(main())
