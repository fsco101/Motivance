"""Exercise scheduling and booking through real local Auth and PostgREST, with disposable synthetic accounts.

Run after `supabase start` and `supabase migration up --local`. Existing records are left alone: every account this
creates is removed again. Pass a section name, such as `python scripts/test_booking.py roles`, to run one section.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
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
delete from public.audit_events where target_type='bookings' and target_id in (select id::text from public.bookings where patient_id in ({ids}) or therapist_id in ({ids}));
delete from public.booking_events where booking_id in (select id from public.bookings where patient_id in ({ids}) or therapist_id in ({ids}));
delete from public.bookings where patient_id in ({ids}) or therapist_id in ({ids});
delete from public.session_measurements where session_id in (select id from public.sessions where patient_id in ({ids}));
delete from public.sessions where patient_id in ({ids}); delete from public.consents where patient_id in ({ids});
delete from public.prescription_versions where patient_id in ({ids}); delete from public.exercise_assignments where patient_id in ({ids});
delete from public.patient_profiles where user_id in ({ids});
delete from public.patient_invitations where therapist_id in ({ids});
delete from public.therapist_patients where therapist_id in ({ids}) or patient_id in ({ids});
delete from public.center_closures where created_by in ({ids}); delete from public.center_holidays where created_by in ({ids});
update public.center_settings set updated_by=null where updated_by in ({ids});
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


def working_days(stack, after=3):
    """Distinct working days in order, so two parts of a test never land on one date."""
    day = working_day(stack, after)
    while True:
        yield day
        day = working_day(stack, (day - manila_today(stack)).days + 1)


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
    stack.check(set(first) == {'starts_at', 'ends_at', 'remaining', 'mine'}, 'A slot says nothing about who else holds it')

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


def manila(day, hour, minute=0):
    return f'{day}T{hour:02d}:{minute:02d}:00+08:00'


def refused(result, key):
    return result[0] == 400 and (result[1] or {}).get('message') == key


def together(calls):
    """Starts every call at the same moment, each on its own connection."""
    barrier = threading.Barrier(len(calls))

    def run(call):
        barrier.wait()
        return call()

    with ThreadPoolExecutor(len(calls)) as pool:
        return list(pool.map(run, calls))


def bookings(stack):
    """MOT-51: the rules hold on the server, including under simultaneous requests."""
    _, ts = stack.user('patient', 'scheduler')
    therapist, tt = stack.user('patient', 'therapist')
    second, _ = stack.user('patient', 'therapist')
    admin, ta = stack.user('patient', 'admin')
    patient, tp = stack.user('patient')
    other, to = stack.user('patient')

    def request(token, start, client=None):
        return stack.rpc('request_booking', {'p_request': client or str(uuid.uuid4()), 'p_starts': start}, token)

    def status(booking):
        return stack.sql(f"select status from public.bookings where id='{booking}';")

    fresh = working_days(stack)
    day = next(fresh)
    today = manila_today(stack)

    # A request.
    client = str(uuid.uuid4())
    code, first = request(tp, manila(day, 9), client)
    stack.check(code == 200 and first['status'] == 'pending' and first['therapist_id'] is None, 'A patient requests a specific slot and it starts as pending')
    stack.check(first['reference_no'].startswith('BK-') and len(first['reference_no']) == 14, 'A booking has a reference number')
    stack.check(datetime.fromisoformat(first['ends_at']) - datetime.fromisoformat(first['starts_at']) == timedelta(hours=1), 'The booking ends one slot later')
    stack.check('calendar_token' not in first, 'The calendar token is not returned')
    code, again = request(tp, manila(day, 9), client)
    stack.check(code == 200 and again['id'] == first['id'], 'Repeating a request returns the original booking')
    stack.check(stack.sql(f"select count(*) from public.bookings where patient_id='{patient}';") == '1', 'A repeated request creates nothing new')
    stack.check(refused(request(to, manila(day, 9), client), 'booking_invalid'), 'Another patient cannot reuse someone else\'s request ID')
    stack.check(stack.rpc('request_booking', {'p_request': str(uuid.uuid4()), 'p_starts': manila(day, 9)})[0] == 401, 'Anonymous callers cannot request')

    # What a patient may not request.
    stack.check(refused(request(tp, manila(day, 9)), 'booking_overlap'), 'A patient cannot hold two bookings at once')
    saturday = next_weekday(today, 6, 3)
    stack.check(refused(request(tp, manila(saturday, 9)), 'booking_closed_day'), 'A closed day is refused')
    holiday = date.fromisoformat(stack.sql("select min(starts_on) from public.center_holidays where starts_on>current_date+2 and extract(isodow from starts_on)<6;"))
    stack.check(refused(request(tp, manila(holiday, 9)), 'booking_holiday'), 'A holiday is refused')
    stack.check(refused(request(tp, manila(today - timedelta(days=1), 9)), 'booking_past'), 'A past time is refused')
    stack.check(refused(request(tp, (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()), 'booking_too_soon'), 'A time inside the minimum notice is refused')
    stack.check(refused(request(tp, manila(today + timedelta(days=70), 9)), 'booking_too_far'), 'A time beyond the horizon is refused')
    stack.check(refused(request(tp, manila(day, 9, 30)), 'booking_off_grid'), 'A time between slots is refused')
    stack.check(refused(request(tp, manila(day, 8)), 'booking_off_grid'), 'A time before opening is refused')
    stack.check(refused(request(tp, manila(day, 17)), 'booking_outside_hours'), 'A time after closing is refused')

    closed = next(fresh)
    stack.sql(f"""insert into public.center_closures(starts_at,ends_at,reason) values(('{closed} 09:00'::timestamp) at time zone 'Asia/Manila',('{closed} 11:00'::timestamp) at time zone 'Asia/Manila','Booking test closure');""")
    try:
        stack.check(refused(request(tp, manila(closed, 10)), 'booking_closure'), 'A closure blocks a request')
        stack.check(request(tp, manila(closed, 11))[0] == 200, 'The slot after a closure can still be requested')
    finally:
        stack.sql("delete from public.center_closures where reason='Booking test closure';")

    stack.sql('update public.center_settings set max_active_bookings=2;')
    try:
        stack.check(refused(request(tp, manila(day, 11)), 'booking_limit'), 'A patient cannot hold more active bookings than the setting allows')
    finally:
        stack.sql('update public.center_settings set max_active_bookings=5;')

    # Capacity.
    full = next(fresh)
    people = [stack.user('patient') for _ in range(12)]
    for _, token in people[:2]:
        stack.check(request(token, manila(full, 13))[0] == 200, 'Early requests fit in the slot')
    results = together([lambda token=token: request(token, manila(full, 13)) for _, token in people[2:]])
    stack.check(sum(code == 200 for code, _ in results) == 1, 'Ten simultaneous requests for the last place: exactly one succeeds')
    stack.check(sum(refused(result, 'booking_full') for result in results) == 9, 'The other nine are told the slot is full')
    stack.check(stack.sql(f"select count(*) from public.bookings where status='pending' and starts_at='{manila(full, 13)}';") == '3', 'The slot holds exactly its capacity')
    code, data = stack.rpc('booking_availability', {'p_from': str(full), 'p_to': str(full)}, tp)
    places = {datetime.fromisoformat(slot['starts_at']).astimezone(timezone.utc).hour: slot['remaining'] for slot in data['days'][0]['slots']}
    stack.check(places[5] == 0 and places[6] == 3, 'Availability shows the full slot and its neighbour correctly')

    clash = stack.user('patient')[1]
    results = together([lambda: request(clash, manila(full, 15)), lambda: request(clash, manila(full, 15))])
    stack.check(sum(code == 200 for code, _ in results) == 1, 'One patient asking twice at once gets one booking')

    # Confirmation.
    code, one = request(to, manila(day, 10))
    stack.check(refused(stack.rpc('scheduler_confirm', {'p_booking': one['id']}, ts), 'booking_therapist_required'), 'Confirming needs a therapist')
    stack.check(refused(stack.rpc('scheduler_confirm', {'p_booking': one['id'], 'p_therapist': patient}, ts), 'booking_therapist_unavailable'), 'Only a therapist can be assigned')
    code, confirmed = stack.rpc('scheduler_confirm', {'p_booking': one['id'], 'p_therapist': therapist}, ts)
    stack.check(code == 200 and confirmed['status'] == 'confirmed' and confirmed['therapist_id'] == therapist, 'A Scheduler confirms with a therapist')
    stack.check(refused(stack.rpc('scheduler_confirm', {'p_booking': one['id'], 'p_therapist': second}, ts), 'booking_state'), 'A confirmed booking cannot be confirmed again')
    code, two = request(tp, manila(day, 10))
    stack.check(refused(stack.rpc('scheduler_confirm', {'p_booking': two['id'], 'p_therapist': therapist}, ts), 'booking_therapist_busy'), 'A busy therapist cannot be double-booked')

    race = next(fresh)
    a = request(to, manila(race, 9))[1]
    b = request(tp, manila(race, 9))[1]
    results = together([lambda: stack.rpc('scheduler_confirm', {'p_booking': a['id'], 'p_therapist': second}, ts), lambda: stack.rpc('scheduler_confirm', {'p_booking': b['id'], 'p_therapist': second}, ts)])
    stack.check(sum(code == 200 for code, _ in results) == 1 and sum(refused(result, 'booking_therapist_busy') for result in results) == 1, 'Two Schedulers confirming one therapist at once: exactly one succeeds')

    # Re-validation at the moment of confirmation.
    check = next(fresh)
    waiting = request(to, manila(check, 9))[1]
    stack.sql(f"""insert into public.center_closures(starts_at,ends_at,reason) values(('{check} 09:00'::timestamp) at time zone 'Asia/Manila',('{check} 10:00'::timestamp) at time zone 'Asia/Manila','Booking test closure');""")
    try:
        stack.check(refused(stack.rpc('scheduler_confirm', {'p_booking': waiting['id'], 'p_therapist': therapist}, ts), 'booking_closure'), 'A closure added after the request stops confirmation')
    finally:
        stack.sql("delete from public.center_closures where reason='Booking test closure';")
    stack.sql(f"insert into public.center_holidays(name,kind,starts_on,ends_on) values('Booking test holiday','special','{check}','{check}');")
    try:
        stack.check(refused(stack.rpc('scheduler_confirm', {'p_booking': waiting['id'], 'p_therapist': therapist}, ts), 'booking_holiday'), 'A holiday added after the request stops confirmation')
    finally:
        stack.sql("delete from public.center_holidays where name='Booking test holiday';")
    stack.sql('update public.center_hours set is_open=false where weekday=' + str(check.isoweekday()) + ';')
    try:
        stack.check(refused(stack.rpc('scheduler_confirm', {'p_booking': waiting['id'], 'p_therapist': therapist}, ts), 'booking_closed_day'), 'Closing that weekday after the request stops confirmation')
    finally:
        stack.sql('update public.center_hours set is_open=true where weekday=' + str(check.isoweekday()) + ';')
    stack.sql(f"update public.bookings set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' where id='{waiting['id']}';")
    stack.check(refused(stack.rpc('scheduler_confirm', {'p_booking': waiting['id'], 'p_therapist': therapist}, ts), 'booking_past'), 'A request whose time has passed cannot be confirmed')

    # Refusing, moving and changing.
    stack.check(refused(stack.rpc('scheduler_reject', {'p_booking': two['id'], 'p_reason': ' '}, ts), 'booking_reason_required'), 'Rejecting needs a reason')
    code, rejected = stack.rpc('scheduler_reject', {'p_booking': two['id'], 'p_reason': 'No therapist available'}, ts)
    stack.check(code == 200 and rejected['status'] == 'rejected' and rejected['status_reason'] == 'No therapist available', 'A Scheduler rejects with a reason')
    stack.check(refused(stack.rpc('scheduler_reject', {'p_booking': one['id'], 'p_reason': 'Too late for this'}, ts), 'booking_state'), 'A confirmed booking cannot be rejected')

    target = manila(day, 14)
    stack.check(refused(stack.rpc('scheduler_reschedule', {'p_booking': one['id'], 'p_starts': manila(day, 14, 30)}, ts), 'booking_off_grid'), 'A Scheduler reschedules only onto a specific slot')
    stack.check(refused(stack.rpc('scheduler_reschedule', {'p_booking': one['id'], 'p_starts': manila(saturday, 9)}, ts), 'booking_closed_day'), 'A Scheduler cannot reschedule onto a closed day')
    code, moved = stack.rpc('scheduler_reschedule', {'p_booking': one['id'], 'p_starts': target}, ts)
    stack.check(code == 200 and moved['status'] == 'rescheduled' and moved['previous_starts_at'] is not None, 'A reschedule moves the booking and keeps the old time')
    stack.check(datetime.fromisoformat(moved['starts_at']) == datetime.fromisoformat(target), 'The new time is the chosen slot')
    stack.sql('update public.center_settings set minimum_notice_hours=336;')
    try:
        stack.check(refused(request(tp, manila(day, 16)), 'booking_too_soon'), 'A slot inside the notice window is closed to patients')
        stack.check(stack.rpc('scheduler_reschedule', {'p_booking': one['id'], 'p_starts': manila(day, 16)}, ts)[0] == 200, 'A Scheduler can still book at short notice')
    finally:
        stack.sql('update public.center_settings set minimum_notice_hours=24;')
    unassigned = request(tp, manila(next(fresh), 9))[1]
    stack.check(refused(stack.rpc('scheduler_reschedule', {'p_booking': unassigned['id'], 'p_starts': manila(day, 15)}, ts), 'booking_therapist_required'), 'Rescheduling needs a therapist')

    stack.check(refused(stack.rpc('scheduler_assign_therapist', {'p_booking': one['id'], 'p_therapist': patient}, ts), 'booking_therapist_unavailable'), 'Assigning needs a therapist')
    code, changed = stack.rpc('scheduler_assign_therapist', {'p_booking': one['id'], 'p_therapist': second}, ts)
    stack.check(code == 200 and changed['therapist_id'] == second and changed['status'] == 'rescheduled', 'A Scheduler changes the therapist and the status stays')

    stack.check(refused(stack.rpc('scheduler_cancel', {'p_booking': one['id'], 'p_reason': ''}, ts), 'booking_reason_required'), 'Cancelling needs a reason')
    spare = next(fresh)
    bulk = [request(token, manila(spare, 11))[1]['id'] for _, token in people[:2]]
    stack.check(stack.rpc('scheduler_confirm', {'p_booking': bulk[0], 'p_therapist': therapist}, ts)[0] == 200, 'One of two requests is confirmed first')
    code, count = stack.rpc('scheduler_bulk_reject', {'p_bookings': bulk, 'p_reason': 'Outdated request'}, ts)
    stack.check(code == 200 and count == 1 and status(bulk[0]) == 'confirmed' and status(bulk[1]) == 'rejected', 'Bulk reject changes only pending requests')
    stack.check(refused(stack.rpc('scheduler_bulk_reject', {'p_bookings': bulk, 'p_reason': ''}, ts), 'booking_reason_required'), 'Bulk reject needs a reason')

    # A patient's own cancellation.
    own = next(fresh)
    mine = request(to, manila(own, 9))[1]
    stack.check(refused(stack.rpc('cancel_my_booking', {'p_booking': mine['id']}, tp), 'booking_unavailable'), 'A patient cannot cancel someone else\'s booking')
    stack.sql('update public.center_settings set cancel_cutoff_hours=336;')
    try:
        stack.check(refused(stack.rpc('cancel_my_booking', {'p_booking': mine['id']}, to), 'booking_too_late'), 'A patient cannot cancel after the cut-off')
    finally:
        stack.sql('update public.center_settings set cancel_cutoff_hours=24;')
    code, cancelled = stack.rpc('cancel_my_booking', {'p_booking': mine['id'], 'p_reason': 'Feeling better'}, to)
    stack.check(code == 200 and cancelled['status'] == 'cancelled', 'A patient cancels before the cut-off')
    stack.check(refused(stack.rpc('cancel_my_booking', {'p_booking': mine['id']}, to), 'booking_state'), 'A cancelled booking cannot be cancelled again')
    stack.check(request(to, manila(own, 9))[0] == 200, 'A cancelled booking frees the patient and the slot')

    # The database itself.
    def direct(person, start, end, therapist_id='null'):
        stack.sql(f"""insert into public.bookings(reference_no,patient_id,therapist_id,starts_at,ends_at,status) values('BK-TEST-{uuid.uuid4().hex[:6]}','{person}',{therapist_id},'{start}','{end}','confirmed');""")

    far = next(fresh)
    direct(patient, manila(far, 9), manila(far, 10))
    try:
        direct(patient, manila(far, 9), manila(far, 10))
        stack.check(False, 'The database rejects an overlapping booking for one patient')
    except RuntimeError as error:
        stack.check('bookings_no_patient_overlap' in str(error), 'The database itself rejects an overlapping booking for one patient')
    direct(other, manila(far, 11), manila(far, 12), f"'{therapist}'")
    try:
        direct(patient, manila(far, 11), manila(far, 12), f"'{therapist}'")
        stack.check(False, 'The database rejects an overlapping booking for one therapist')
    except RuntimeError as error:
        stack.check('bookings_no_therapist_overlap' in str(error), 'The database itself rejects an overlapping booking for one therapist')

    # Clients have no direct path.
    for token, label in [(tp, 'patient'), (ts, 'Scheduler'), (ta, 'administrator')]:
        stack.check(stack.api('/rest/v1/bookings?select=id&limit=1', token=token)[0] == 403, f'A {label} cannot read the bookings table directly')
        stack.check(stack.api('/rest/v1/booking_events?select=id&limit=1', token=token)[0] == 403, f'A {label} cannot read the audit table directly')
    stack.check(stack.api('/rest/v1/bookings', {'patient_id': patient}, tp)[0] == 403, 'Nobody can write the bookings table directly')

    # The audit trail.
    events = stack.sql(f"select string_agg(action||'/'||actor_role,',' order by id) from public.booking_events where booking_id='{one['id']}';")
    stack.check(events == 'requested/patient,confirmed/scheduler,rescheduled/scheduler,rescheduled/scheduler,therapist_changed/scheduler', 'Every change to a booking is recorded with who did it')
    stack.check(stack.sql(f"select count(*) from public.booking_events where booking_id='{one['id']}' and actor_id is null;") == '0', 'Each event names its actor')
    stack.check(stack.sql(f"select to_status from public.booking_events where booking_id='{two['id']}' order by id desc limit 1;") == 'rejected', 'The new status is recorded')
    stack.check(stack.sql(f"select reason from public.booking_events where booking_id='{two['id']}' order by id desc limit 1;") == 'No therapist available', 'The reason is recorded')
    try:
        stack.sql(f"update public.booking_events set action='x' where booking_id='{one['id']}';")
        stack.check(False, 'The audit trail is immutable')
    except RuntimeError as error:
        stack.check('immutable' in str(error), 'The audit trail cannot be changed, even by the database owner')
    stack.check(stack.sql(f"select count(*) from public.audit_events where target_type='bookings' and target_id='{one['id']}';") == '5', 'Events are mirrored to the administrator feed')
    code, feed = stack.rpc('admin_activity', {}, ta)
    named = [row for row in feed if row['target_type'] == 'bookings']
    stack.check(code == 200 and named and named[0]['target_name'].startswith('BK-'), 'The feed names a booking by its reference number')

    # A therapist who leaves.
    leaving, _ = stack.user('patient', 'therapist')
    ahead = next(fresh)
    held = request(stack.user('patient')[1], manila(ahead, 9))[1]
    stack.check(stack.rpc('scheduler_confirm', {'p_booking': held['id'], 'p_therapist': leaving}, ts)[0] == 200, 'A session is confirmed with the therapist who will leave')
    stack.check(stack.rpc('admin_set_role', {'p_user': leaving, 'p_role': 'therapist', 'p_granted': False}, ta)[0] in (200, 204), 'An administrator removes the therapist role')
    stack.check(status(held['id']) == 'pending' and stack.sql(f"select therapist_id is null from public.bookings where id='{held['id']}';") == 't', 'Their future session returns to Pending without a therapist')
    stack.check(stack.sql(f"select action||'/'||actor_role from public.booking_events where booking_id='{held['id']}' order by id desc limit 1;") == 'returned_to_pending/admin', 'The change is audited against the administrator')
    disabled, _ = stack.user('patient', 'therapist')
    stack.check(stack.rpc('scheduler_confirm', {'p_booking': held['id'], 'p_therapist': disabled}, ts)[0] == 200, 'The session is reassigned')
    stack.check(stack.rpc('admin_set_account', {'p_user': disabled, 'p_active': False}, ta)[0] in (200, 204), 'An administrator disables that therapist')
    stack.check(status(held['id']) == 'pending', 'Disabling a therapist also returns their sessions to Pending')
    stack.check(refused(stack.rpc('scheduler_confirm', {'p_booking': held['id'], 'p_therapist': disabled}, ts), 'booking_therapist_unavailable'), 'A disabled therapist cannot be assigned')


def my_bookings(stack):
    """MOT-53: what a patient sees of their own bookings."""
    _, ts = stack.user('patient', 'scheduler')
    therapist, _ = stack.user('patient', 'therapist')
    patient, tp = stack.user('patient')
    _, to = stack.user('patient')
    stack.sql("update public.center_settings set location='12 Mabini Street, Quezon City';")
    fresh = working_days(stack)
    day, later = next(fresh), next(fresh)

    def request(token, start):
        return stack.rpc('request_booking', {'p_request': str(uuid.uuid4()), 'p_starts': start}, token)[1]

    try:
        stack.check(stack.rpc('my_bookings', {}, tp) == (200, []), 'A patient with no bookings gets an empty list')
        stack.check(stack.rpc('my_bookings', {})[0] == 401, 'Anonymous callers cannot list bookings')
        first = request(tp, manila(day, 9))
        second = request(tp, manila(later, 10))
        request(to, manila(day, 9))
        code, mine = stack.rpc('my_bookings', {}, tp)
        stack.check(code == 200 and [row['id'] for row in mine] == [second['id'], first['id']], 'A patient sees only their own bookings, newest first')
        row = mine[1]
        stack.check(row['location'] == '12 Mabini Street, Quezon City' and row['can_cancel'] is True, 'Each booking carries the location and whether it can be cancelled')
        stack.check(datetime.fromisoformat(row['cancel_until']) == datetime.fromisoformat(row['starts_at']) - timedelta(hours=24), 'The cut-off is 24 hours before the session')
        stack.check('calendar_token' not in row and 'patient_id' not in row, 'Internal fields stay behind')
        stack.check(stack.rpc('scheduler_confirm', {'p_booking': first['id'], 'p_therapist': therapist}, ts)[0] == 200, 'A Scheduler confirms the first booking')
        row = {item['id']: item for item in stack.rpc('my_bookings', {}, tp)[1]}[first['id']]
        stack.check(row['status'] == 'confirmed' and row['therapist_name'].startswith('Booking Fixture'), 'The patient sees the new status and the therapist\'s name')
        stack.sql('update public.center_settings set cancel_cutoff_hours=336;')
        try:
            row = {item['id']: item for item in stack.rpc('my_bookings', {}, tp)[1]}[first['id']]
            stack.check(row['can_cancel'] is False, 'After the cut-off the booking says it cannot be cancelled')
        finally:
            stack.sql('update public.center_settings set cancel_cutoff_hours=24;')
        stack.check(stack.rpc('scheduler_reject', {'p_booking': second['id'], 'p_reason': 'Fully booked that week'}, ts)[0] == 200, 'A Scheduler rejects the second booking')
        row = {item['id']: item for item in stack.rpc('my_bookings', {}, tp)[1]}[second['id']]
        stack.check(row['status'] == 'rejected' and row['status_reason'] == 'Fully booked that week' and row['can_cancel'] is False, 'A rejected booking shows its reason and cannot be cancelled')
        slots = stack.rpc('booking_availability', {'p_from': str(day), 'p_to': str(day)}, tp)[1]['days'][0]['slots']
        stack.check(slots[0]['mine'] is True and slots[1]['mine'] is False, 'Availability marks the slot the patient already holds')
        stack.check(stack.rpc('booking_availability', {'p_from': str(day), 'p_to': str(day)}, to)[1]['days'][0]['slots'][0]['remaining'] == 1, 'Two bookings leave one place of three')
    finally:
        stack.sql("update public.center_settings set location='';")


def requests(stack):
    """MOT-55: what a Scheduler needs to find and decide requests."""
    _, ts = stack.user('patient', 'scheduler')
    linked, tl = stack.user('patient', 'therapist', name='Booking Zed Linked')
    other, _ = stack.user('patient', 'therapist', name='Booking Amy Other')
    ana, ta = stack.user('patient', name='Booking Ana Findable')
    ben, tb = stack.user('patient', name='Booking Ben Searchable')
    cara, tc = stack.user('patient', name='Booking Cara 50%')
    stack.sql(f"insert into public.therapist_patients(therapist_id,patient_id,assigned_by) values('{linked}','{ana}','{linked}');")
    fresh = working_days(stack)
    first, second, third = next(fresh), next(fresh), next(fresh)

    def request(token, start):
        return stack.rpc('request_booking', {'p_request': str(uuid.uuid4()), 'p_starts': start}, token)[1]

    def table(**filters):
        code, data = stack.rpc('scheduler_bookings', filters, ts)
        assert code == 200, data
        return data

    a = request(ta, manila(first, 9))
    b = request(tb, manila(second, 10))
    c = request(tc, manila(third, 11))
    stack.check(stack.rpc('scheduler_confirm', {'p_booking': b['id'], 'p_therapist': other}, ts)[0] == 200, 'A request is confirmed so the table has a mix')

    mine = {a['id'], b['id'], c['id']}
    rows = table(p_search='Booking', p_limit=50)['rows']
    stack.check(mine <= {row['id'] for row in rows}, 'The table lists requests from every patient')
    stack.check({'patient_id', 'patient_name', 'therapist_name', 'reference_no', 'status', 'starts_at', 'ends_at'} <= set(rows[0]), 'Each row has what the table shows')
    stack.check('calendar_token' not in rows[0] and 'position' not in rows[0], 'Internal fields stay behind')

    stack.check([row['id'] for row in table(p_search='ana findable')['rows']] == [a['id']], 'Search finds a patient by name, ignoring case')
    stack.check([row['id'] for row in table(p_search='amy other')['rows']] == [b['id']], 'Search finds a booking by therapist')
    stack.check([row['id'] for row in table(p_search=a['reference_no'])['rows']] == [a['id']], 'Search finds a booking by reference number')
    stack.check([row['id'] for row in table(p_search='50%')['rows']] == [c['id']], 'Search takes wildcards literally')
    stack.check(table(p_search='no such person')['total'] == 0, 'A search with no match reports zero')
    stack.check(stack.rpc('scheduler_bookings', {'p_search': 'x' * 101}, ts)[0] == 400, 'An overlong search is refused')

    stack.check({row['id'] for row in table(p_search='Booking', p_statuses=['confirmed'])['rows']} == {b['id']}, 'The status filter works')
    stack.check({row['id'] for row in table(p_search='Booking', p_statuses=['pending', 'confirmed'])['rows']} == mine, 'Several statuses can be chosen')
    stack.check([row['id'] for row in table(p_therapist=other)['rows']] == [b['id']], 'The therapist filter works')
    stack.check([row['id'] for row in table(p_patient=ben)['rows']] == [b['id']], 'The patient filter works')
    stack.check([row['id'] for row in table(p_search='Booking', p_from=str(second), p_to=str(second))['rows']] == [b['id']], 'The date range covers a whole day in Manila')
    stack.check(table(p_search='Booking', p_from=str(third + timedelta(days=1)))['total'] == 0, 'The date range leaves out earlier dates')

    order = [row['id'] for row in table(p_search='Booking', p_sort='starts_at')['rows']]
    stack.check(order == [a['id'], b['id'], c['id']], 'The table sorts by time')
    stack.check([row['id'] for row in table(p_search='Booking', p_sort='starts_at', p_descending=True)['rows']] == order[::-1], 'The sort can be reversed')
    stack.check([row['patient_name'] for row in table(p_search='Booking', p_sort='patient')['rows']] == ['Booking Ana Findable', 'Booking Ben Searchable', 'Booking Cara 50%'], 'The table sorts by patient')
    stack.check(table(p_search='Booking', p_sort='therapist')['rows'][0]['id'] == b['id'], 'Sorting by therapist puts unassigned requests last')
    stack.check(stack.rpc('scheduler_bookings', {'p_sort': 'id; drop table public.bookings'}, ts)[0] == 400, 'Only known columns can be sorted')

    page = table(p_search='Booking', p_sort='starts_at', p_limit=2)
    stack.check(page['total'] == 3 and len(page['rows']) == 2, 'A page holds its limit, and the total counts every match')
    last = table(p_search='Booking', p_sort='starts_at', p_limit=2, p_offset=2)
    stack.check(last['total'] == 3 and [row['id'] for row in last['rows']] == [c['id']], 'The last page holds the remainder')
    stack.check(table(p_search='Booking', p_limit=2, p_offset=10) == {'total': 3, 'rows': []}, 'A page past the end is empty and keeps the total')

    code, detail = stack.rpc('scheduler_booking_detail', {'p_booking': b['id']}, ts)
    stack.check(code == 200 and detail['patient_name'] == 'Booking Ben Searchable', 'The detail names the patient')
    stack.check([event['action'] for event in detail['events']] == ['confirmed', 'requested'], 'The detail shows the history, newest first')
    stack.check(detail['events'][0]['actor_role'] == 'scheduler' and detail['events'][1]['actor_name'] == 'Booking Ben Searchable', 'The history says who did each thing')
    stack.check(stack.rpc('scheduler_booking_detail', {'p_booking': str(uuid.uuid4())}, ts)[1]['message'] == 'booking_unavailable', 'An unknown booking is refused')

    code, choices = stack.rpc('scheduler_therapists', {'p_booking': a['id']}, ts)
    names = [row['id'] for row in choices]
    stack.check(code == 200 and names.index(linked) < names.index(other), 'A therapist linked to the patient comes first, though their name sorts later')
    flags = {row['id']: row for row in choices}
    stack.check(flags[linked]['linked'] is True and flags[other]['linked'] is False, 'Linked therapists are marked')
    stack.check(flags[other]['busy'] is False, 'A free therapist is not marked busy')
    stack.check({row['id']: row for row in stack.rpc('scheduler_therapists', {'p_booking': a['id'], 'p_starts': manila(second, 10)}, ts)[1]}[other]['busy'] is True, 'A therapist with a session at that time is marked busy')
    all_therapists = {row['id'] for row in stack.rpc('scheduler_therapists', {}, ts)[1]}
    stack.check({linked, other} <= all_therapists, 'With no booking, every therapist is listed for the filter')

    direct = {'p_from': str(first), 'p_to': str(first), 'p_staff': True}
    stack.check(stack.rpc('center_availability', direct, ta)[0] in (403, 404), 'A patient cannot ask for the staff view directly')
    stack.check(stack.rpc('scheduler_availability', {'p_from': str(first), 'p_to': str(first)}, ta)[0] == 403, 'Nor through the Scheduler function')

    stack.sql('update public.center_settings set minimum_notice_hours=336;')
    try:
        staff = stack.rpc('scheduler_availability', {'p_from': str(first), 'p_to': str(first)}, ts)[1]['days'][0]
        patient = stack.rpc('booking_availability', {'p_from': str(first), 'p_to': str(first)}, ta)[1]['days'][0]
        stack.check(staff['status'] == 'open' and len(staff['slots']) == 8, 'A Scheduler sees slots inside the notice window')
        stack.check(patient['status'] == 'too_soon' and patient['slots'] == [], 'A patient does not')
    finally:
        stack.sql('update public.center_settings set minimum_notice_hours=24;')
    stack.check('mine' in staff['slots'][0] and staff['slots'][0]['mine'] is False, 'A Scheduler holds no slots themselves')


CENTER_LOCATION = '12 Mabini Street, Quezon City'


def manila_hour(value):
    return datetime.fromisoformat(value).astimezone(timezone(timedelta(hours=8))).hour


def schedule(stack):
    """MOT-56: each person's confirmed sessions, laid out by time, and nothing clinical."""
    # A blank location would compare equal to a blank location, so this needs a real one.
    stack.sql(f"update public.center_settings set location='{CENTER_LOCATION}';")
    try:
        schedule_checks(stack)
    finally:
        stack.sql("update public.center_settings set location='';")


def schedule_checks(stack):
    _, ts = stack.user('patient', 'scheduler')
    tess, tt = stack.user('patient', 'therapist', name='Booking Tess Linked')
    omar, to = stack.user('patient', 'therapist', name='Booking Omar Unlinked')
    ana, ta = stack.user('patient', name='Booking Ana Scheduled')
    ben, tb = stack.user('patient', name='Booking Ben Assigned')
    fresh = working_days(stack)
    day, later, last, closing = next(fresh), next(fresh), next(fresh), next(fresh)

    def request(token, start):
        return stack.rpc('request_booking', {'p_request': str(uuid.uuid4()), 'p_starts': start}, token)[1]

    def days(name, token, start, end=None):
        code, data = stack.rpc(name, {'p_from': str(start), 'p_to': str(end or start)}, token)
        assert code == 200, data
        return data['days']

    def mine(token, start=day, end=None):
        return days('my_schedule', token, start, end)

    def working(token, start=day, end=None):
        return days('therapist_schedule', token, start, end)

    def sessions(found):
        return [row['session'] for item in found for row in item['rows'] if row['session']]

    def ids(found):
        return [session['id'] for session in sessions(found)]

    # Only what a Scheduler has confirmed.
    booked = request(ta, manila(day, 10))
    stack.check(ids(mine(ta)) == [], 'A request still waiting is not on My Schedule')
    stack.check(ids(working(tt)) == [], 'Nor on a therapist schedule')
    stack.check(stack.rpc('scheduler_confirm', {'p_booking': booked['id'], 'p_therapist': tess}, ts)[0] == 200, 'A Scheduler confirms a session')

    found = mine(ta)
    rows = found[0]['rows']
    stack.check(found[0]['date'] == str(day) and found[0]['status'] == 'open', 'The day asked for comes back, open')
    stack.check([manila_hour(row['starts_at']) for row in rows] == list(range(9, 17)), 'The day runs across the opening hours, in order')
    stack.check(rows[1]['session'] and rows[1]['session']['id'] == booked['id'], 'The session sits at its own time')
    stack.check(all(row['session'] is None for index, row in enumerate(rows) if index != 1), 'Every other hour is empty')
    session = rows[1]['session']
    stack.check(manila_hour(session['starts_at']) == 10 and manila_hour(session['ends_at']) == 11, 'A session has a specific start and end time')
    stack.check(session['therapist_name'] == 'Booking Tess Linked' and session['location'] == CENTER_LOCATION and session['reference_no'] == booked['reference_no'], 'A patient sees the therapist, location and reference')

    stack.check(ids(mine(tb)) == [], 'Another patient sees none of it')
    stack.check(ids(mine(ta, day, day + timedelta(days=30))) == [booked['id']], 'A whole month can be read at once')
    stack.check(len(mine(ta, day, day + timedelta(days=30))) == 31, 'Every date in the range comes back')
    seen = sessions(working(tt))
    stack.check([item['id'] for item in seen] == [booked['id']], 'The assigned therapist sees it')
    stack.check(seen[0]['patient_name'] == 'Booking Ana Scheduled' and seen[0]['reference_no'] == booked['reference_no'], 'A therapist sees the patient and reference')
    stack.check(manila_hour(seen[0]['starts_at']) == 10, 'At the same time')
    stack.check('status_reason' not in seen[0] and 'previous_starts_at' not in seen[0], 'A therapist gets no more than a schedule needs')
    stack.check(ids(working(to)) == [], 'Another therapist sees none of it')

    # Whoever is asking has to be that kind of person.
    range_of = {'p_from': str(day), 'p_to': str(day)}
    stack.check(stack.rpc('therapist_schedule', range_of, tb)[0] == 403, 'A patient cannot open a therapist schedule')
    staff, tstaff = stack.user('therapist')
    stack.sql(f"delete from public.user_roles where user_id='{staff}' and role='patient';")
    stack.check(stack.rpc('my_schedule', range_of, tstaff)[0] == 403, 'Someone who is not a patient has no My Schedule')
    stack.check(stack.rpc('my_schedule', range_of)[0] == 401, 'Nor does someone signed out')
    forged = dict(range_of, p_owner=ana, p_therapist=False)
    stack.check(stack.rpc('schedule_layout', forged, tb)[0] in (403, 404), "A patient cannot ask for someone else's schedule directly")
    stack.check(stack.rpc('schedule_layout', forged, tt)[0] in (403, 404), 'Nor can a therapist')
    stack.check(refused(stack.rpc('my_schedule', {'p_from': str(day), 'p_to': str(day + timedelta(days=63))}, ta), 'booking_invalid_range'), 'A range that long is refused')

    # A moved session moves. A cancelled one goes.
    moved = manila(later, 14)
    stack.check(stack.rpc('scheduler_reschedule', {'p_booking': booked['id'], 'p_starts': moved, 'p_therapist': tess}, ts)[0] == 200, 'A Scheduler moves the session')
    stack.check(ids(mine(ta)) == [], 'It leaves its old date')
    moved_rows = mine(ta, later)[0]['rows']
    stack.check([manila_hour(row['starts_at']) for row in moved_rows if row['session']] == [14], 'It shows at its new time')
    stack.check(sessions(mine(ta, later))[0]['status'] == 'rescheduled', 'A rescheduled session is on the schedule')
    stack.check(ids(working(tt, later)) == [booked['id']], 'The therapist follows it')
    stack.check(stack.rpc('scheduler_cancel', {'p_booking': booked['id'], 'p_reason': 'Test'}, ts)[0] == 200, 'A Scheduler cancels the session')
    stack.check(ids(mine(ta, later)) == [] and ids(working(tt, later)) == [], 'A cancelled session leaves both schedules')
    waiting = request(tb, manila(later, 9))
    stack.check(stack.rpc('scheduler_reject', {'p_booking': waiting['id'], 'p_reason': 'Test'}, ts)[0] == 200, 'A Scheduler rejects a request')
    stack.check(ids(mine(tb, later)) == [], 'A rejected request never appears')

    # 7 AM in Manila is still the day before in UTC, so a day must be cut in the center's zone.
    early = str(uuid.uuid4())
    stack.sql(f"insert into public.bookings(id,reference_no,patient_id,therapist_id,starts_at,ends_at,status) values('{early}','BK-EARLY-{early[:8]}','{ana}','{tess}','{manila(last, 7)}','{manila(last, 8)}','confirmed');")
    stack.check(ids(mine(ta, last)) == [early], 'A session early on a Manila date stays on that date')
    stack.check(ids(mine(ta, last - timedelta(days=1))) == [], 'It is not on the date UTC would give it')
    stack.check(ids(working(tt, last)) == [early], 'The same for the therapist')
    early_rows = mine(ta, last)[0]['rows']
    stack.check(manila_hour(early_rows[0]['starts_at']) == 7 and len(early_rows) == 9, 'A session outside the hours still shows, with the hours around it')

    # What the center's own calendar does to a day.
    weekend = next_weekday(day, 6)
    stack.check(mine(ta, weekend)[0]['status'] == 'closed' and mine(ta, weekend)[0]['rows'] == [], 'A day the center never opens has no hours')
    holiday = date.fromisoformat(stack.sql("select min(starts_on) from public.center_holidays where starts_on>current_date+2 and extract(isodow from starts_on)<6;"))
    found = mine(ta, holiday)[0]
    stack.check(found['status'] == 'holiday' and found['holiday'] and found['rows'] == [], 'A holiday says which one, and has no hours')
    stack.sql(f"""insert into public.center_closures(starts_at,ends_at,reason) values(('{closing} 13:00'::timestamp) at time zone 'Asia/Manila',('{closing} 15:00'::timestamp) at time zone 'Asia/Manila','Booking test closure');""")
    try:
        found = mine(ta, closing)[0]
        stack.check(found['status'] == 'open' and [manila_hour(row['starts_at']) for row in found['rows']] == [9, 10, 11, 12, 15, 16], 'A closed part of a day drops out of its hours')
        stack.sql(f"""update public.center_closures set starts_at=('{closing} 00:00'::timestamp) at time zone 'Asia/Manila',ends_at=('{closing} 23:59'::timestamp) at time zone 'Asia/Manila' where reason='Booking test closure';""")
        found = mine(ta, closing)[0]
        stack.check(found['status'] == 'closure' and found['rows'] == [], 'A day closed from start to end says so')
    finally:
        stack.sql("delete from public.center_closures where reason='Booking test closure';")

    # A booking alone opens nothing. The link is what grants a record.
    stack.sql(f"insert into public.therapist_patients(therapist_id,patient_id,assigned_by) values('{tess}','{ben}','{tess}');")
    stack.sql(f"""insert into public.patient_profiles(user_id,username,full_name,first_name,last_name,gender,birthdate,address,contact,avatar)
 values('{ben}','booking_{ben[:8]}','Booking Fixture','Booking','Fixture','male','1990-01-01','Quezon City','0917 555 0142','person');""")
    exercise = stack.sql("select id from public.exercise_versions where published and algorithm_key='elbow-flexion-v1' order by version desc limit 1;")
    assignment, version = str(uuid.uuid4()), str(uuid.uuid4())
    code, _ = stack.rpc('publish_prescription', {'p_assignment': assignment, 'p_version': version, 'p_patient': ben, 'p_exercise': exercise, 'p_side': 'left', 'p_low': 20, 'p_high': 90, 'p_repetitions': 5, 'p_parameters': {}}, tt)
    stack.check(code == 200, 'A clinical record exists to protect')
    record = str(uuid.uuid4())
    stack.sql(f"""insert into public.sessions(id,patient_id,prescription_version_id,started_at,ended_at,status,app_version,model_version,algorithm_version)
 values('{record}','{ben}','{version}',now(),now(),'completed','test','test','test');""")
    assigned = request(tb, manila(day, 11))
    stack.check(stack.rpc('scheduler_confirm', {'p_booking': assigned['id'], 'p_therapist': omar}, ts)[0] == 200, 'A Scheduler assigns an unlinked therapist')
    seen = sessions(working(to))
    stack.check([item['id'] for item in seen] == [assigned['id']] and seen[0]['patient_name'] == 'Booking Ben Assigned', 'The unlinked therapist sees who is booked')
    stack.check(seen[0]['patient_id'] == ben and seen[0]['linked'] is False, 'The schedule says no link exists')
    for table, query in [('sessions', 'patient_id'), ('prescription_versions', 'patient_id'), ('exercise_assignments', 'patient_id'), ('patient_profiles', 'user_id')]:
        code, found = stack.api(f'/rest/v1/{table}?select=*&{query}=eq.{ben}', token=to)
        stack.check(code == 200 and found == [], f'A booking alone opens nothing in {table}')
        code, found = stack.api(f'/rest/v1/{table}?select=*&{query}=eq.{ben}', token=tt)
        stack.check(code == 200 and len(found) >= 1, f'The linked therapist can read {table}, so the empty result above is real')
    stack.sql(f"insert into public.therapist_patients(therapist_id,patient_id,assigned_by) values('{omar}','{ben}','{tess}');")
    stack.check(sessions(working(to))[0]['linked'] is True, 'Once linked, the schedule says so')
    stack.sql(f"update public.therapist_patients set active=false where therapist_id='{omar}' and patient_id='{ben}';")
    stack.check(sessions(working(to))[0]['linked'] is False, 'A link that has ended no longer counts')


def calendar(stack):
    """MOT-57: running the center's calendar, and a closure that cannot strand a booking."""
    settings = stack.sql('select row_to_json(s) from public.center_settings s;')
    hours = stack.sql("select json_agg(h) from public.center_hours h;")
    try:
        calendar_checks(stack)
    finally:
        stack.sql("delete from public.center_closures where reason like 'Booking test%';")
        stack.sql("delete from public.center_holidays where name like 'Booking test%';")
        stack.sql(f"""update public.center_settings s set (center_name,location,slot_minutes,slot_capacity,cancel_cutoff_hours,reschedule_cutoff_hours,minimum_notice_hours,booking_horizon_days,max_active_bookings,max_self_reschedules)=
 (select center_name,location,slot_minutes,slot_capacity,cancel_cutoff_hours,reschedule_cutoff_hours,minimum_notice_hours,booking_horizon_days,max_active_bookings,max_self_reschedules
  from json_populate_record(null::public.center_settings,$j${settings}$j$::json));""")
        stack.sql(f"""update public.center_hours h set is_open=x.is_open,opens_at=x.opens_at,closes_at=x.closes_at from json_populate_recordset(null::public.center_hours,$j${hours}$j$::json) x where x.weekday=h.weekday;""")


def calendar_checks(stack):
    _, ts = stack.user('patient', 'scheduler')
    tess, _ = stack.user('patient', 'therapist', name='Booking Tess Calendar')
    omar, _ = stack.user('patient', 'therapist', name='Booking Omar Calendar')
    ana, ta = stack.user('patient', name='Booking Ana Calendar')
    ben, tb = stack.user('patient', name='Booking Ben Calendar')
    cara, tc = stack.user('patient', name='Booking Cara Calendar')
    fresh = working_days(stack)
    day, spare, later, last, wide = next(fresh), next(fresh), next(fresh), next(fresh), next(fresh)

    def request(token, start):
        code, data = stack.rpc('request_booking', {'p_request': str(uuid.uuid4()), 'p_starts': start}, token)
        assert code == 200, data
        return data

    def confirm(booking, therapist):
        code, data = stack.rpc('scheduler_confirm', {'p_booking': booking['id'], 'p_therapist': therapist}, ts)
        assert code == 200, data

    def status(booking):
        return stack.sql(f"select status from public.bookings where id='{booking['id']}';")

    def starts_hour(booking):
        return int(stack.sql(f"select extract(hour from starts_at at time zone 'Asia/Manila')::integer from public.bookings where id='{booking['id']}';"))

    def day_status(token, date_value):
        return stack.rpc('booking_availability', {'p_from': str(date_value), 'p_to': str(date_value)}, token)[1]['days'][0]['status']

    def closures():
        return int(stack.sql("select count(*) from public.center_closures where reason like 'Booking test%';"))

    def whole_day(date_value):
        return manila(date_value, 0), manila(date_value + timedelta(days=1), 0)

    def closure(date_value, resolutions=(), closure_id=None, reason='Booking test outage'):
        starts, ends = whole_day(date_value)
        return stack.rpc('scheduler_save_closure', {'p_id': closure_id, 'p_starts': starts, 'p_ends': ends, 'p_all_day': True, 'p_reason': reason, 'p_resolutions': list(resolutions)}, ts)

    def cancel(booking):
        return {'booking': booking['id'], 'action': 'cancel', 'reason': 'Booking test outage'}

    def move(booking, start, therapist=None):
        return {'booking': booking['id'], 'action': 'reschedule', 'starts_at': start, 'therapist': therapist}

    # Settings. Every rule a Scheduler can change, and what the table refuses.
    rules = dict(p_center_name='Booking test center', p_location='12 Mabini Street', p_slot_minutes=60, p_slot_capacity=3, p_cancel_cutoff_hours=24, p_reschedule_cutoff_hours=24,
                 p_minimum_notice_hours=24, p_booking_horizon_days=60, p_max_active_bookings=5, p_max_self_reschedules=2)
    code, saved = stack.rpc('scheduler_save_settings', dict(rules, p_max_active_bookings=6), ts)
    stack.check(code == 200 and saved['center_name'] == 'Booking test center' and saved['location'] == '12 Mabini Street' and saved['max_active_bookings'] == 6, 'A Scheduler saves the center and its rules')
    stack.check(stack.sql('select updated_by is not null from public.center_settings;') == 't', 'The save records who made it')
    for name, value in [('p_slot_capacity', 0), ('p_slot_minutes', 5), ('p_booking_horizon_days', 0), ('p_center_name', '   '), ('p_center_name', None)]:
        stack.check(refused(stack.rpc('scheduler_save_settings', dict(rules, **{name: value}), ts), 'booking_invalid'), f'A bad value for {name} is refused')
    stack.check(stack.sql('select max_active_bookings from public.center_settings;') == '6', 'A refused save changes nothing')
    stack.check(stack.rpc('scheduler_save_settings', rules, ta)[0] == 403, 'A patient cannot change the rules')
    stack.check(stack.rpc('scheduler_save_settings', dict(rules, p_max_active_bookings=5), ts)[0] == 200, 'The rules go back')

    # Hours. A session already booked keeps its time, so the page is told what now falls outside them.
    week = [{'weekday': number, 'is_open': number < 6, 'opens_at': '09:00', 'closes_at': '17:00'} for number in range(1, 8)]
    late = request(ta, manila(last, 16))
    shorter = [dict(item, closes_at='15:00') if item['weekday'] == last.isoweekday() else item for item in week]
    code, saved = stack.rpc('scheduler_save_hours', {'p_hours': shorter}, ts)
    stack.check(code == 200 and saved['outside_hours'] == 1, 'Shorter hours say how many sessions now fall outside them')
    stack.check(status(late) == 'pending', 'A session outside the new hours keeps its place until someone decides')
    stack.check(len(stack.rpc('booking_availability', {'p_from': str(last), 'p_to': str(last)}, tb)[1]['days'][0]['slots']) == 6, 'Availability follows the new hours')
    stack.check(stack.rpc('scheduler_save_hours', {'p_hours': week}, ts)[1]['outside_hours'] == 0, 'Hours go back, and nothing is left outside them')
    stack.check(refused(stack.rpc('scheduler_cancel', {'p_booking': late['id'], 'p_reason': 'x'}, ts), 'booking_reason_required'), 'Cancelling still needs a real reason')
    stack.check(stack.rpc('scheduler_cancel', {'p_booking': late['id'], 'p_reason': 'Test'}, ts)[0] == 200, 'The test session is cleared away')
    backwards = [dict(item, opens_at='18:00') if item['weekday'] == 1 else item for item in week]
    for label, bad in [('six days', week[:6]), ('a day twice', week[:6] + [week[0]]), ('opening after closing', backwards), ('a time that is not one', [dict(week[0], opens_at='late')] + week[1:]), ('a weekday that is not one', [dict(week[0], weekday='x')] + week[1:])]:
        stack.check(refused(stack.rpc('scheduler_save_hours', {'p_hours': bad}, ts), 'booking_invalid'), f'Hours with {label} are refused')
    stack.check(stack.sql("select opens_at from public.center_hours where weekday=1;").startswith('09:00'), 'A refused save changes no day')

    # Holidays, one day or a break.
    code, break_days = stack.rpc('scheduler_save_holiday', {'p_id': None, 'p_name': 'Booking test break', 'p_kind': 'seasonal', 'p_starts_on': str(spare), 'p_ends_on': str(later)}, ts)
    stack.check(code == 200 and day_status(tb, spare) == 'holiday' and day_status(tb, later) == 'holiday', 'A break closes every day in it')
    code, edited = stack.rpc('scheduler_save_holiday', {'p_id': break_days['id'], 'p_name': 'Booking test break renamed', 'p_kind': 'special', 'p_starts_on': str(later), 'p_ends_on': str(later)}, ts)
    stack.check(code == 200 and edited['name'] == 'Booking test break renamed' and edited['kind'] == 'special', 'A holiday can be edited')
    stack.check(day_status(tb, spare) == 'open' and day_status(tb, later) == 'holiday', 'Editing the dates moves what is closed')
    stack.check(stack.rpc('scheduler_delete_holiday', {'p_id': break_days['id']}, ts)[0] == 204 and day_status(tb, later) == 'open', 'Deleting a holiday opens the day again')
    stack.check(refused(stack.rpc('scheduler_delete_holiday', {'p_id': break_days['id']}, ts), 'booking_unavailable'), 'A holiday already gone is refused')
    for label, body in [('no name', {'p_name': '  ', 'p_kind': 'special', 'p_starts_on': str(day), 'p_ends_on': str(day)}), ('an unknown kind', {'p_name': 'Booking test', 'p_kind': 'party', 'p_starts_on': str(day), 'p_ends_on': str(day)})]:
        stack.check(refused(stack.rpc('scheduler_save_holiday', dict(body, p_id=None), ts), 'booking_invalid'), f'A holiday with {label} is refused')
    stack.check(refused(stack.rpc('scheduler_save_holiday', {'p_id': None, 'p_name': 'Booking test', 'p_kind': 'special', 'p_starts_on': str(later), 'p_ends_on': str(day)}, ts), 'booking_invalid_range'), 'A holiday ending before it starts is refused')
    seeded = stack.sql("select id from public.center_holidays where source='seed' order by starts_on limit 1;")
    stack.check(refused(stack.rpc('scheduler_save_holiday', {'p_id': str(uuid.uuid4()), 'p_name': 'Booking test', 'p_kind': 'special', 'p_starts_on': str(day), 'p_ends_on': str(day)}, ts), 'booking_unavailable'), 'A holiday that does not exist cannot be edited')
    stack.check(bool(seeded), 'The seeded holidays are there to edit')

    # What a closure would strand.
    a, b, c = request(ta, manila(day, 9)), request(tb, manila(day, 10)), request(tc, manila(day, 11))
    confirm(b, tess)
    confirm(c, omar)
    gone = request(ta, manila(day, 13))
    stack.check(stack.rpc('scheduler_reject', {'p_booking': gone['id'], 'p_reason': 'Test'}, ts)[0] == 200, 'One request is already decided')
    other_day = request(ta, manila(spare, 9))
    past = str(uuid.uuid4())
    stack.sql(f"insert into public.bookings(id,reference_no,patient_id,therapist_id,starts_at,ends_at,status) values('{past}','BK-PAST-{past[:8]}','{ben}','{tess}',now()-interval '3 days',now()-interval '3 days'+interval '1 hour','confirmed');")
    starts, ends = whole_day(day)
    code, impact = stack.rpc('scheduler_calendar_impact', {'p_starts': starts, 'p_ends': ends}, ts)
    stack.check(code == 200 and [row['id'] for row in impact] == [a['id'], b['id'], c['id']], 'The impact lists active bookings in the time, in order')
    stack.check(impact[0]['patient_name'] == 'Booking Ana Calendar' and impact[1]['therapist_name'] == 'Booking Tess Calendar', 'The impact says who each one is')
    stack.check(stack.rpc('scheduler_calendar_impact', {'p_starts': manila(day, 10), 'p_ends': manila(day, 11)}, ts)[1][0]['id'] == b['id'], 'A part of a day lists only what overlaps it')
    yesterday = stack.rpc('scheduler_calendar_impact', {'p_starts': (datetime.now(timezone.utc) - timedelta(days=5)).isoformat(), 'p_ends': (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()}, ts)[1]
    stack.check(past not in [row['id'] for row in yesterday], 'A session already over needs no decision')
    stack.check(stack.rpc('scheduler_calendar_impact', {'p_starts': starts, 'p_ends': ends}, ta)[0] == 403, 'A patient cannot read the impact')
    stack.check(refused(stack.rpc('scheduler_calendar_impact', {'p_starts': ends, 'p_ends': starts}, ts), 'booking_invalid_range'), 'A backward range is refused')

    # The server, not the page, insists on a decision for each one.
    stack.check(refused(closure(day), 'booking_unresolved'), 'A closure over active bookings is refused without decisions')
    stack.check(refused(closure(day, [cancel(a)]), 'booking_unresolved'), 'A decision for only some of them is refused')
    stack.check(refused(closure(day, [cancel(a), cancel(b), cancel(c), cancel(other_day)]), 'booking_invalid'), 'A decision for a booking outside the closure is refused')
    stack.check(refused(closure(day, [cancel(a), cancel(a), cancel(b), cancel(c)]), 'booking_invalid'), 'Two decisions for one booking are refused')
    stack.check(refused(closure(day, [cancel(a), cancel(b), {'booking': c['id'], 'action': 'ignore'}]), 'booking_invalid'), 'An unknown decision is refused')
    stack.check(closures() == 0 and [status(item) for item in (a, b, c)] == ['pending', 'confirmed', 'confirmed'], 'Nothing changes while any booking is unresolved')

    # One transaction: if any part fails, nothing happens.
    stack.check(refused(closure(day, [cancel(a), move(b, manila(day, 15)), cancel(c)]), 'booking_closure'), 'A booking cannot be moved into the closure itself')
    stack.check(closures() == 0 and status(a) == 'pending' and status(c) == 'confirmed', 'The failed move undoes the cancellations before it, and the closure')
    stack.check(refused(closure(day, [move(a, manila(spare, 10)), cancel(b), cancel(c)]), 'booking_therapist_required'), 'A request with no therapist needs one to be moved')
    stack.check(refused(closure(day, [cancel(a), cancel(b), cancel(c)], reason='x'), 'booking_reason_required'), 'A closure needs a real reason')

    code, saved = closure(day, [cancel(a), move(b, manila(spare, 10)), move(c, manila(spare, 11))])
    stack.check(code == 200 and closures() == 1 and saved['all_day'] is True, 'With a decision for each, the closure saves')
    stack.check(status(a) == 'cancelled' and status(b) == 'rescheduled' and status(c) == 'rescheduled', 'Each decision is applied')
    stack.check(starts_hour(b) == 10 and stack.sql(f"select starts_at::date='{spare}' from public.bookings where id='{b['id']}';") == 't', 'A moved booking is at its new time')
    stack.check(day_status(ta, day) == 'closure', 'The day is closed to patients')
    stack.check(next(item for item in stack.rpc('my_bookings', {}, ta)[1] if item['id'] == a['id'])['status_reason'] == 'Booking test outage', 'The patient can see why their booking was cancelled')
    stack.check(stack.sql(f"select count(*) from public.booking_events where booking_id='{a['id']}' and action='cancelled' and actor_role='scheduler';") == '1', 'The audit log records the decision and who made it')

    # A booking made after the list was read still cannot slip through.
    stack.check(stack.rpc('scheduler_calendar_impact', {'p_starts': whole_day(later)[0], 'p_ends': whole_day(later)[1]}, ts)[1] == [], 'The next day has nothing in it yet')
    arrived = request(tb, manila(later, 9))
    stack.check(refused(closure(later), 'booking_unresolved'), 'A booking made after the list was read is caught at the save')
    stack.check(closure(later, [cancel(arrived)])[0] == 200 and status(arrived) == 'cancelled', 'Once decided, that closure saves')

    # Editing and deleting.
    existing = stack.sql("select id from public.center_closures where reason like 'Booking test%' order by starts_at limit 1;")
    stack.check(refused(closure(spare, closure_id=existing), 'booking_unresolved'), 'Moving a closure onto bookings needs decisions too')
    stack.check(day_status(ta, day) == 'closure', 'The refused edit leaves the closure where it was')
    stack.check(closure(wide, closure_id=existing, reason='Booking test moved')[0] == 200 and day_status(ta, wide) == 'closure' and day_status(ta, day) == 'open', 'A closure can be moved')
    stack.check(closures() == 2, 'Moving one does not add another')
    stack.check(refused(closure(wide, closure_id=str(uuid.uuid4())), 'booking_unavailable'), 'A closure that does not exist cannot be edited')
    stack.check(stack.rpc('scheduler_delete_closure', {'p_id': existing}, ts)[0] == 204 and day_status(ta, wide) == 'open', 'Deleting a closure opens the time again')
    stack.check(refused(stack.rpc('scheduler_delete_closure', {'p_id': existing}, ts), 'booking_unavailable'), 'A closure already gone is refused')
    part = stack.rpc('scheduler_save_closure', {'p_id': None, 'p_starts': manila(wide, 13), 'p_ends': manila(wide, 15), 'p_all_day': False, 'p_reason': 'Booking test part', 'p_resolutions': []}, ts)
    stack.check(part[0] == 200 and part[1]['all_day'] is False, 'A closure can cover part of a day')
    found = stack.rpc('booking_availability', {'p_from': str(wide), 'p_to': str(wide)}, ta)[1]['days'][0]
    stack.check(found['status'] == 'open' and len(found['slots']) == 6, 'The rest of that day stays open')

    # A holiday resolves bookings the same way.
    held = request(ta, manila(last, 9))
    body = {'p_id': None, 'p_name': 'Booking test holiday', 'p_kind': 'special', 'p_starts_on': str(last), 'p_ends_on': str(last)}
    stack.check(refused(stack.rpc('scheduler_save_holiday', dict(body, p_resolutions=[]), ts), 'booking_unresolved'), 'A holiday over an active booking is refused without a decision')
    stack.check(stack.sql("select count(*) from public.center_holidays where name='Booking test holiday';") == '0', 'And is not saved')
    stack.check(stack.rpc('scheduler_save_holiday', dict(body, p_resolutions=[cancel(held)]), ts)[0] == 200 and status(held) == 'cancelled', 'With a decision, the holiday saves')


SECTIONS = {'roles': roles, 'availability': availability, 'bookings': bookings, 'my_bookings': my_bookings, 'requests': requests, 'schedule': schedule, 'calendar': calendar}


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
