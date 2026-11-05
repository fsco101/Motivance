"""One sign-in page routing each role to its workspace, in the real app on the local stack, with disposable accounts.

Needs a signed-out app, so run it on a throwaway emulator: this signs accounts in and out of the app.

    emulator -avd Pixel_6 -read-only -no-snapshot-save -no-window
    adb install -r android/app/build/outputs/apk/debug/app-debug.apk
    adb install -r -t android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
    adb shell pm clear com.motivance.debug
    python scripts/test_role_routing.py
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
TEST = 'com.motivance.navigation.LiveRoleRoutingTest'
RUNNER = 'com.motivance.debug.test/androidx.test.runner.AndroidJUnitRunner'


def main():
    raw = subprocess.run(['npx.cmd' if os.name == 'nt' else 'npx', '--yes', 'supabase@2.20.12', 'status', '-o', 'json'], cwd=ROOT, capture_output=True, text=True, check=True)
    config = json.loads(raw.stdout)
    base = config['API_URL'].rstrip('/')
    assert base in ['http://127.0.0.1:54321', 'http://localhost:54321'], 'Local stack only'
    password = uuid.uuid4().hex + 'Aa!9'
    users = []

    def sql(statement):
        result = subprocess.run(['docker', 'exec', '-i', 'supabase_db_motivance', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], input=statement, capture_output=True, text=True)
        if result.returncode: raise RuntimeError('Local SQL fixture operation failed: ' + result.stderr)
        return result.stdout.strip()

    def user(*roles):
        email = f'motivance-routing-{uuid.uuid4().hex}@example.test'
        key = config['SERVICE_ROLE_KEY']
        request = urllib.request.Request(base + '/auth/v1/admin/users', method='POST', data=json.dumps({'email': email, 'password': password, 'email_confirm': True}).encode(),
                                         headers={'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=20) as response:
            uid = str(uuid.UUID(json.loads(response.read())['id']))
        users.append(uid)
        values = ','.join(f"('{uid}','{role}')" for role in roles)
        sql(f"delete from public.user_roles where user_id='{uid}'; insert into public.user_roles(user_id,role) values{values};")
        return email

    try:
        accounts = {'patientEmail': user('patient'), 'therapistEmail': user('therapist'), 'therapistPatientEmail': user('patient', 'therapist'), 'adminEmail': user('patient', 'admin')}
        command = [ADB, 'shell', 'am', 'instrument', '-w', '-e', 'class', TEST, '-e', 'password', password]
        for name, email in accounts.items(): command += ['-e', name, email]
        output = subprocess.run(command + [RUNNER], capture_output=True, text=True, timeout=300).stdout
        print(output.replace(password, '***'))
        return 0 if 'OK (1 test)' in output else 1
    finally:
        if users:
            ids = ','.join("'" + str(uuid.UUID(u)) + "'" for u in users)
            # Scoped fixture cleanup; immutable-history triggers are bypassed only in this admin transaction.
            sql(f"""begin; set local session_replication_role=replica;
delete from public.audit_events where actor_id in ({ids}) or target_id in ({ids});
delete from public.patients where id in ({ids}); delete from public.user_roles where user_id in ({ids});
delete from public.profiles where id in ({ids}); delete from auth.users where id in ({ids}); commit;""")


if __name__ == '__main__':
    sys.exit(main())
