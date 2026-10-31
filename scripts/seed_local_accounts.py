"""Create/reuse two owned local-only Auth fixtures, roles and a therapist link.

Credentials are saved in an ignored local document, never in the Android app.
The optional --with-prescription flag adds an engineering demonstration assignment,
never a clinical-approval record.
"""
import json
import argparse
import os
from pathlib import Path
import secrets
import subprocess
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
CREDENTIALS = ROOT / 'docs/operations/local-test-accounts.json'
FIXTURES = [('therapist', 'therapist@motivance.test', 'Demo Therapist'),
            ('patient', 'patient@motivance.test', 'Demo Patient')]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--with-prescription',action='store_true',help='Add one development-only elbow assignment if the demo patient has none')
    args=parser.parse_args()
    result = subprocess.run(
        ['npx.cmd' if os.name == 'nt' else 'npx', '--yes', 'supabase@2.20.12', 'status', '-o', 'json'],
        cwd=ROOT, capture_output=True, text=True, encoding='utf-8', check=True)
    config = json.loads(result.stdout)
    base = config['API_URL'].rstrip('/')
    if base not in {'http://127.0.0.1:54321', 'http://localhost:54321'}:
        raise RuntimeError('This script only supports the local Motivance stack')

    def request(path, body=None, token=None, privileged=False, method=None):
        key = config['SERVICE_ROLE_KEY'] if privileged else config['ANON_KEY']
        headers = {'apikey': key, 'Content-Type': 'application/json'}
        if token or privileged:
            headers['Authorization'] = 'Bearer ' + (token or key)
        req = urllib.request.Request(base + path, headers=headers,
            data=json.dumps(body).encode() if body is not None else None,
            method=method or ('POST' if body is not None else 'GET'))
        try:
            with urllib.request.urlopen(req, timeout=20) as response:
                raw = response.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as error:
            raise RuntimeError(f'Local Auth/API request failed: HTTP {error.code}') from None

    # Look up only our reserved synthetic addresses, without listing other users.
    lookup = subprocess.run(
        ['docker', 'exec', '-i', 'supabase_db_motivance', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'],
        input="select email || '|' || id::text from auth.users where email in ('therapist@motivance.test','patient@motivance.test');",
        text=True, capture_output=True, check=True)
    existing = dict(line.split('|', 1) for line in lookup.stdout.splitlines() if line)
    old = json.loads(CREDENTIALS.read_text(encoding='utf-8')) if CREDENTIALS.exists() else {}
    cached = {account['email']: account for account in old.get('accounts', [])}
    accounts = []
    for role, email, display_name in FIXTURES:
        password = cached.get(email, {}).get('password') or ('MvDemo!' + secrets.token_urlsafe(12))
        if email in existing:
            user_id = str(uuid.UUID(existing[email]))
            current = request('/auth/v1/admin/users/' + user_id, privileged=True)
            if current.get('app_metadata', {}).get('motivance_local_fixture') is not True:
                raise RuntimeError(f'Refusing to modify an account not created by this fixture script: {email}')
            request('/auth/v1/admin/users/' + user_id,
                    {'password': password, 'email_confirm': True}, privileged=True, method='PUT')
        else:
            user = request('/auth/v1/admin/users', {'email': email, 'password': password,
                'email_confirm': True, 'app_metadata': {'motivance_local_fixture': True}}, privileged=True)
            user_id = str(uuid.UUID(user['id']))
        accounts.append({'role': role, 'email': email, 'password': password,
                         'user_id': user_id, 'display_name': display_name})

    therapist, patient = accounts
    t, p = therapist['user_id'], patient['user_id']
    sql = f"""begin;
update public.profiles set display_name='Demo Therapist', active=true where id='{t}';
update public.profiles set display_name='Demo Patient', active=true where id='{p}';
delete from public.user_roles where user_id in ('{t}','{p}');
insert into public.user_roles(user_id,role) values ('{t}','therapist'),('{p}','patient');
insert into public.therapist_patients(therapist_id,patient_id,active,assigned_by)
values ('{t}','{p}',true,'{t}')
on conflict (therapist_id,patient_id) do update set active=true;
commit;"""
    provision = subprocess.run(
        ['docker', 'exec', '-i', 'supabase_db_motivance', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
        input=sql, capture_output=True, text=True)
    if provision.returncode:
        raise RuntimeError('Local fixture role/link provisioning failed')

    for account in accounts:
        session = request('/auth/v1/token?grant_type=password',
                          {'email': account['email'], 'password': account['password']})
        roles = request('/rest/v1/user_roles?select=role&user_id=eq.' + account['user_id'], token=session['access_token'])
        if roles != [{'role': account['role']}]:
            raise RuntimeError('Local fixture role verification failed')
        if account['role'] == 'therapist':
            rows = request('/rest/v1/patients?select=id&id=eq.' + p, token=session['access_token'])
            if rows != [{'id': p}]:
                raise RuntimeError('Therapist cannot read the linked demo patient')
            if args.with_prescription:
                assignments=request('/rest/v1/exercise_assignments?select=id&active=eq.true&patient_id=eq.'+p,token=session['access_token'])
                if not assignments:
                    assignment=str(uuid.uuid5(uuid.NAMESPACE_URL,'motivance-demo-assignment:'+p))
                    version=str(uuid.uuid5(uuid.NAMESPACE_URL,'motivance-demo-prescription:'+p))
                    request('/rest/v1/rpc/publish_prescription',{'p_assignment':assignment,'p_version':version,'p_patient':p,'p_exercise':'21000000-0000-0000-0000-000000000001','p_side':'left','p_low':20,'p_high':90,'p_repetitions':5,'p_parameters':{}},token=session['access_token'])
                    print('Created one development-only elbow assignment for the demo patient')
        request('/auth/v1/logout', {}, token=session['access_token'])
        print('Verified local sign-in and role:', account['role'], account['email'])

    CREDENTIALS.write_text(json.dumps({'environment': 'local development only',
        'api_url': base, 'accounts': accounts}, indent=2) + '\n', encoding='utf-8')
    if os.name != 'nt':
        CREDENTIALS.chmod(0o600)
    print('Credentials saved to ignored docs/operations/local-test-accounts.json')


if __name__ == '__main__':
    main()
