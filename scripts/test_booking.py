"""Exercise scheduling and booking through real local Auth and PostgREST, with disposable synthetic accounts.

Run after `supabase start` and `supabase migration up --local`. Existing records are left alone: every account this
creates is removed again. Pass a section name, such as `python scripts/test_booking.py roles`, to run one section.
"""
from datetime import date, datetime, timedelta, timezone
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


def next_weekday(day, weekday, after=0):
    """The first date on or after `after` days from `day` that falls on an ISO weekday."""
    candidate = day + timedelta(days=after)
    while candidate.isoweekday() != weekday:
        candidate += timedelta(days=1)
    return candidate


def manila_today(stack):
    return date.fromisoformat(stack.sql("select (now() at time zone 'Asia/Manila')::date;"))


def working_day(stack, after=3):
    """A plain working day inside the booking horizon, clear of holidays."""
    day = manila_today(stack) + timedelta(days=after)
    while True:
        if day.isoweekday() <= 5 and stack.sql(f"select count(*) from public.center_holidays where '{day}' between starts_on and ends_on;") == '0':
            return day
        day += timedelta(days=1)


def availability(stack):
    """MOT-50: what a patient can see."""
    _, patient = stack.user('patient')
    today = manila_today(stack)

    def days(start, end):
        code, data = stack.rpc('booking_availability', {'p_from': str(start), 'p_to': str(end)}, patient)
        assert code == 200, (code, data)
        return {row['date']: row for row in data['days']}

    stack.check(stack.rpc('booking_availability', {'p_from': str(today), 'p_to': str(today)})[0] == 401, 'Anonymous callers cannot read availability')
    stack.check(stack.rpc('booking_availability', {'p_from': str(today), 'p_to': str(today + timedelta(days=90))}, patient)[0] == 400, 'A range over two months is refused')
    stack.check(stack.rpc('booking_availability', {'p_from': str(today), 'p_to': str(today - timedelta(days=1))}, patient)[0] == 400, 'A backwards range is refused')

    day = working_day(stack)
    row = days(day, day)[str(day)]
    stack.check(row['status'] == 'open' and len(row['slots']) == 8, 'A working day offers eight hourly slots from nine to five')
    first, last = row['slots'][0], row['slots'][-1]
    stack.check(datetime.fromisoformat(first['starts_at']).astimezone(timezone.utc).hour == 1, 'Nine in Manila is stored as 01:00 UTC')
    stack.check(datetime.fromisoformat(last['ends_at']).astimezone(timezone.utc).hour == 9, 'The last slot ends at five in Manila, 09:00 UTC')
    stack.check(all(slot['remaining'] == 3 for slot in row['slots']), 'Each slot reports the places left')
    stack.check(set(first) == {'starts_at', 'ends_at', 'remaining'}, 'A slot says nothing about who holds it')

    saturday = next_weekday(today, 6, 3)
    row = days(saturday, saturday)[str(saturday)]
    stack.check(row['status'] == 'closed' and row['slots'] == [], 'A closed weekend offers no slots')

    holiday = date.fromisoformat(stack.sql("select min(starts_on) from public.center_holidays where starts_on>current_date+2 and extract(isodow from starts_on)<6;"))
    row = days(holiday, holiday)[str(holiday)]
    stack.check(row['status'] == 'holiday' and row['slots'] == [] and row['holiday'], 'A national holiday offers no slots and is named')

    season = working_day(stack, 12)
    stack.sql(f"insert into public.center_holidays(name,kind,starts_on,ends_on) values('Booking test break','seasonal','{season}','{season}');")
    try:
        row = days(season, season)[str(season)]
        stack.check(row['status'] == 'holiday' and row['holiday'] == 'Booking test break', 'A seasonal break offers no slots')
    finally:
        stack.sql("delete from public.center_holidays where name='Booking test break';")

    closed = working_day(stack, 13)
    stack.sql(f"""insert into public.center_closures(starts_at,ends_at,reason) values(('{closed} 13:00'::timestamp) at time zone 'Asia/Manila',('{closed} 15:00'::timestamp) at time zone 'Asia/Manila','Booking test closure');""")
    try:
        row = days(closed, closed)[str(closed)]
        hours = [datetime.fromisoformat(slot['starts_at']).astimezone(timezone.utc).hour for slot in row['slots']]
        stack.check(row['status'] == 'open' and len(hours) == 6 and 5 not in hours and 6 not in hours, 'A time-range closure removes only the slots it overlaps')
        stack.check('Booking test closure' not in json.dumps(row), 'A patient never sees why the center is closed')
        stack.sql(f"""update public.center_closures set starts_at=('{closed} 00:00'::timestamp) at time zone 'Asia/Manila',ends_at=('{closed} 23:59'::timestamp) at time zone 'Asia/Manila',all_day=true where reason='Booking test closure';""")
        row = days(closed, closed)[str(closed)]
        stack.check(row['status'] == 'closure' and row['slots'] == [], 'A full-day closure closes the whole day')
    finally:
        stack.sql("delete from public.center_closures where reason='Booking test closure';")

    yesterday = today - timedelta(days=1)
    stack.check(days(yesterday, yesterday)[str(yesterday)]['status'] == 'past', 'A past day offers nothing')
    earliest = datetime.fromisoformat(stack.sql("select to_char((now()+interval '24 hours') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS+00:00');"))
    offered = [slot for row in days(today, today + timedelta(days=5)).values() for slot in row['slots']]
    stack.check(offered and all(datetime.fromisoformat(slot['starts_at']) >= earliest for slot in offered), 'Nothing inside the 24-hour minimum notice is offered')
    beyond = today + timedelta(days=62)
    horizon = date.fromisoformat(stack.sql("select (now() at time zone 'Asia/Manila')::date + booking_horizon_days from public.center_settings;"))
    late = {key: value for key, value in days(today + timedelta(days=58), beyond).items() if date.fromisoformat(key) > horizon}
    stack.check(late and all(row['slots'] == [] for row in late.values()), 'Nothing beyond the booking horizon is offered')

    stack.check(stack.api('/rest/v1/center_settings?id=eq.true', {'slot_capacity': 99}, patient, method='PATCH')[0] == 403, 'A patient cannot change the settings')
    stack.check(stack.api('/rest/v1/center_holidays', {'name': 'x', 'kind': 'regular', 'starts_on': str(today), 'ends_on': str(today)}, patient)[0] == 403, 'A patient cannot add a holiday')
    stack.check(stack.api('/rest/v1/center_hours?select=*', token=patient)[0] == 200, 'A patient can read the hours')


SECTIONS = {'roles': roles, 'availability': availability}


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
