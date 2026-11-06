"""Exercise scheduling and booking through real local Auth and PostgREST, with disposable synthetic accounts.

Run after `supabase start` and `supabase migration up --local`. Existing records are left alone: every account this
creates is removed again. Pass a section name, such as `python scripts/test_booking.py roles`, to run one section.
"""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / 'docs/validation/booking-test-results.json'


class Stack:
    """The local backend, and the disposable accounts made on it."""

    def __init__(self):
        raw = subprocess.run(['npx.cmd' if os.name == 'nt' else 'npx', '--yes', 'supabase@2.20.12', 'status', '-o', 'json'], cwd=ROOT, capture_output=True, text=True, check=True)
        self.config = json.loads(raw.stdout)
        self.base = self.config['API_URL'].rstrip('/')
        assert self.base in ('http://127.0.0.1:54321', 'http://localhost:54321'), 'Disposable local fixtures only'
        self.users = []
        self.checks = []

    def sql(self, statement):
        process = subprocess.run(['docker', 'exec', '-i', 'supabase_db_motivance', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'],
                                 input=statement, capture_output=True, text=True, encoding='utf-8')
        if process.returncode:
            raise RuntimeError(process.stderr)
        return process.stdout.strip()

    def api(self, path, body=None, token=None, privileged=False, method=None):
        key = self.config['SERVICE_ROLE_KEY'] if privileged else self.config['ANON_KEY']
        headers = {'apikey': key, 'Content-Type': 'application/json'}
        if token or privileged:
            headers['Authorization'] = 'Bearer ' + (token or key)
        request = urllib.request.Request(self.base + path, data=json.dumps(body).encode() if body is not None else None, headers=headers, method=method or ('POST' if body is not None else 'GET'))
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                raw = response.read()
                return response.status, json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            raw = error.read()
            try:
                return error.code, json.loads(raw) if raw else None
            except ValueError:
                return error.code, None

    def rpc(self, name, body=None, token=None):
        return self.api('/rest/v1/rpc/' + name, body if body is not None else {}, token)

    def check(self, condition, name):
        if not condition:
            raise AssertionError(name)
        self.checks.append(name)
        print('PASS ' + name, flush=True)

    def user(self, *roles, name=None):
        password = uuid.uuid4().hex + 'Aa!9'
        email = 'motivance-booking-' + uuid.uuid4().hex + '@example.test'
        code, data = self.api('/auth/v1/admin/users', {'email': email, 'password': password, 'email_confirm': True}, privileged=True)
        assert code == 200, code
        uid = str(uuid.UUID(data['id']))
        self.users.append(uid)
        for role in roles:
            if role != 'patient':
                self.sql(f"insert into public.user_roles(user_id,role) values('{uid}','{role}');")
        label = name or f'Booking Fixture {len(self.users)} {roles[0]}'
        self.sql(f"update public.profiles set display_name='{label}' where id='{uid}';")
        code, data = self.api('/auth/v1/token?grant_type=password', {'email': email, 'password': password})
        assert code == 200, code
        return uid, data['access_token']

    def clean(self):
        if not self.users:
            return
        ids = ','.join("'" + str(uuid.UUID(user)) + "'" for user in self.users)
        self.sql(f"""begin; set local session_replication_role=replica;
delete from public.session_measurements where session_id in (select id from public.sessions where patient_id in ({ids}));
delete from public.sessions where patient_id in ({ids}); delete from public.consents where patient_id in ({ids});
delete from public.prescription_versions where patient_id in ({ids}); delete from public.exercise_assignments where patient_id in ({ids});
delete from public.patient_profiles where user_id in ({ids});
delete from public.patient_invitations where therapist_id in ({ids});
delete from public.therapist_patients where therapist_id in ({ids}) or patient_id in ({ids});
delete from public.audit_events where actor_id in ({ids}) or target_id in ({ids});
delete from public.patients where id in ({ids}); delete from public.user_roles where user_id in ({ids});
delete from public.profiles where id in ({ids}); delete from auth.users where id in ({ids}); commit;""")
        self.users = []


def scheduler_functions(stack):
    """Every scheduling endpoint with its arguments, read from the database so a new function is covered automatically."""
    rows = stack.sql("""select p.proname||'|'||coalesce((select string_agg(a,',') from unnest(p.proargnames[1:p.pronargs]) a),'')
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'scheduler\\_%' order by 1;""")
    return [(line.split('|')[0], [name for name in line.split('|')[1].split(',') if name]) for line in rows.splitlines()]


def roles(stack):
    """MOT-49: who can hold the role, what it opens, and what it must not."""
    admin, ta = stack.user('patient', 'admin')
    other_admin, tb = stack.user('patient', 'admin')
    therapist, tt = stack.user('patient', 'therapist')
    patient, tp = stack.user('patient', name='Booking Fixture Findable Patient')
    target, tg = stack.user('patient')
    scheduler, ts = stack.user('patient', 'scheduler')

    # Who can assign it.
    for label, token in [('patient', tp), ('therapist', tt), ('Scheduler', ts)]:
        code, _ = stack.rpc('admin_set_role', {'p_user': target, 'p_role': 'scheduler', 'p_granted': True}, token)
        stack.check(code == 403, f'A {label} cannot grant the Scheduler role')
    stack.check(stack.rpc('admin_set_role', {'p_user': target, 'p_role': 'scheduler', 'p_granted': True})[0] == 401, 'Anonymous callers cannot grant the Scheduler role')
    stack.check(stack.api('/rest/v1/user_roles', {'user_id': target, 'role': 'scheduler'}, tg)[0] == 403, 'Nobody can give themselves the role by writing the table')
    stack.check(stack.rpc('admin_set_role', {'p_user': admin, 'p_role': 'scheduler', 'p_granted': True}, ta)[0] >= 400, 'An administrator cannot grant the role to themselves')
    stack.check(stack.sql(f"select count(*) from public.user_roles where user_id='{admin}' and role='scheduler';") == '0', 'A refused self-grant changes nothing')
    stack.check(stack.rpc('admin_set_role', {'p_user': target, 'p_role': 'scheduler', 'p_granted': True}, ta)[0] in (200, 204), 'An administrator grants the Scheduler role')
    stack.check(stack.sql(f"select action from public.audit_events where target_type='user_roles' and target_id='{target}' order by id desc limit 1;") == 'insert', 'Granting the role is audited')
    code, summary = stack.rpc('admin_summary', {}, ta)
    stack.check(code == 200 and summary['schedulers'] >= 2, 'The overview counts Schedulers')
    code, accounts = stack.rpc('admin_accounts', {'p_search': target}, ta)
    stack.check(accounts and 'scheduler' in accounts[0]['roles'], 'The directory shows the Scheduler role')
    patients_before = summary['patients']
    stack.check(stack.rpc('admin_set_role', {'p_user': target, 'p_role': 'scheduler', 'p_granted': False}, ta)[0] in (200, 204), 'An administrator revokes the Scheduler role')
    stack.check(stack.rpc('admin_summary', {}, ta)[1]['patients'] == patients_before + 1, 'A Scheduler is not counted as a patient, and returns to the count when the role goes')

    # What it opens: every scheduling endpoint, for every other role.
    functions = scheduler_functions(stack)
    stack.check(len(functions) >= 1, 'Scheduling endpoints exist to test')
    for name, arguments in functions:
        body = {argument: None for argument in arguments}
        for label, token in [('patient', tp), ('therapist', tt), ('administrator', tb)]:
            stack.check(stack.rpc(name, body, token)[0] == 403, f'{name} answers 403 to a {label}')
        stack.check(stack.rpc(name, body)[0] == 401, f'{name} answers 401 to an anonymous caller')

    code, found = stack.rpc('scheduler_patients', {'p_search': 'findable patient'}, ts)
    stack.check(code == 200 and [row['id'] for row in found] == [patient], 'A Scheduler finds a patient by name')
    stack.check(set(found[0]) == {'id', 'name'}, 'Patient search returns a name and an ID, nothing else')
    stack.check(stack.rpc('scheduler_patients', {'p_search': '%'}, ts)[1] == [], 'Patient search takes wildcards literally')
    stack.check(all(row['id'] != scheduler for row in stack.rpc('scheduler_patients', {'p_limit': 50}, ts)[1]), 'Patient search leaves out staff')

    # What it must not open.
    exercise = stack.sql("select id from public.exercise_versions where published and algorithm_key='elbow-flexion-v1' order by version desc limit 1;")
    stack.sql(f"insert into public.therapist_patients(therapist_id,patient_id,assigned_by) values('{therapist}','{patient}','{therapist}');")
    stack.sql(f"""insert into public.patient_profiles(user_id,username,full_name,first_name,last_name,gender,birthdate,address,contact,avatar)
 values('{patient}','booking_{patient[:8]}','Booking Fixture','Booking','Fixture','female','1990-01-01','Quezon City','0917 555 0142','person');""")
    assignment, version = str(uuid.uuid4()), str(uuid.uuid4())
    code, _ = stack.rpc('publish_prescription', {'p_assignment': assignment, 'p_version': version, 'p_patient': patient, 'p_exercise': exercise, 'p_side': 'left', 'p_low': 20, 'p_high': 90, 'p_repetitions': 5, 'p_parameters': {}}, tt)
    stack.check(code == 200, 'A clinical record exists to protect')
    session = str(uuid.uuid4())
    stack.sql(f"""insert into public.sessions(id,patient_id,prescription_version_id,started_at,ended_at,status,app_version,model_version,algorithm_version)
 values('{session}','{patient}','{version}',now(),now(),'completed','test','test','test');
insert into public.session_measurements(session_id,metric_key,side,minimum_degrees,maximum_degrees,completed_repetitions,quality) values('{session}','elbow','left',10,90,5,'valid');
insert into public.consents(patient_id,consent_type,version,event) values('{patient}','movement-summary','movement-summary-v1','granted');""")
    for table, query in [('sessions', 'patient_id'), ('prescription_versions', 'patient_id'), ('exercise_assignments', 'patient_id'), ('consents', 'patient_id'), ('patient_profiles', 'user_id'), ('patients', 'id'), ('profiles', 'id')]:
        code, rows = stack.api(f'/rest/v1/{table}?select=*&{query}=eq.{patient}', token=ts)
        stack.check(code == 200 and rows == [], f'A Scheduler reads nothing from {table} for another person')
        code, rows = stack.api(f'/rest/v1/{table}?select=*&{query}=eq.{patient}', token=tt)
        stack.check(code == 200 and len(rows) >= 1, f'The linked therapist can still read {table}, so the empty result above is real')
    code, rows = stack.api(f'/rest/v1/session_measurements?select=*&session_id=eq.{session}', token=ts)
    stack.check(code == 200 and rows == [], 'A Scheduler reads no measurements')
    stack.check(stack.api('/rest/v1/audit_events?select=id&limit=1', token=ts)[1] == [], 'A Scheduler reads no audit records')
    stack.check(stack.rpc('admin_accounts', {}, ts)[0] == 403, 'A Scheduler cannot open the administrator directory')


SECTIONS = {'roles': roles}


def main():
    wanted = sys.argv[1:] or list(SECTIONS)
    stack = Stack()
    try:
        for name in wanted:
            print(f'--- {name}', flush=True)
            SECTIONS[name](stack)
            stack.clean()
        if not sys.argv[1:]:
            REPORT.write_text(json.dumps({'generated_at': datetime.now(timezone.utc).isoformat(), 'checks_passed': len(stack.checks), 'checks': stack.checks,
                                          'environment': 'real local Auth and PostgREST with disposable synthetic accounts'}, indent=2) + '\n', encoding='utf-8')
        print(f'{len(stack.checks)} checks passed.')
    finally:
        stack.clean()


if __name__ == '__main__':
    main()
