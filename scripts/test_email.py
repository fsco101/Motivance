"""Exercise the email queue for real, against local Mailpit and never a real inbox.

Run after `supabase start` and `supabase migration up --local`. This starts the Edge Functions itself, with an environment that
points at Mailpit, and stops if the running function has any other mail server. Accounts it creates are removed again.
"""
from datetime import date, datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_booking import ROOT, Stack, manila, manila_hour, manila_today, refused, together, working_days

REPORT = ROOT / 'docs/validation/email-test-results.json'
FUNCTIONS = 'http://127.0.0.1:54321/functions/v1'
MAILPIT = 'http://127.0.0.1:54324/api/v1'
MAIL_CONTAINER = 'supabase_inbucket_motivance'
RUNTIME = 'supabase_edge_runtime_motivance'
SECRET = uuid.uuid4().hex + uuid.uuid4().hex
ENVIRONMENT = {
    'NOTIFICATION_SMTP_PORT': '1025', 'SMTP_FROM_EMAIL': 'noreply@motivance.test', 'SMTP_SENDER_NAME': 'Motivance',
    'NOTIFICATION_DISPATCH_SECRET': SECRET, 'PUBLIC_SITE_URL': 'http://localhost:3000', 'PUBLIC_FUNCTIONS_URL': FUNCTIONS,
}
LOCATION = '12 Mabini Street, Quezon City'


def http(url, method='GET', body=None, headers=None):
    request = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None, headers={'Content-Type': 'application/json', **(headers or {})})
    try:
        with urllib.request.urlopen(request, timeout=40) as response:
            return response.status, response.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode('utf-8', 'replace')
    except OSError as error:
        return 0, str(error)


def dispatch(secret=SECRET):
    headers = {'x-dispatch-secret': secret} if secret else {}
    code, text = http(f'{FUNCTIONS}/notification-dispatch', 'POST', {}, headers)
    return code, json.loads(text) if text.startswith('{') else text


def inbox(address):
    code, text = http(f'{MAILPIT}/search?query=' + urllib.parse.quote(f'to:"{address}"'))
    assert code == 200, text
    return json.loads(text)['messages']


def message(summary):
    code, text = http(f"{MAILPIT}/message/{summary['ID']}")
    assert code == 200, text
    return json.loads(text)


def only(address):
    found = inbox(address)
    assert len(found) == 1, (address, len(found))
    return message(found[0])


def clear_mail():
    http(f'{MAILPIT}/messages', 'DELETE', {})


class Functions:
    """The Edge Functions, started with Mailpit's address, and refused if they would reach anything else."""

    def __init__(self, extra=None):
        self.extra = extra or {}

    def __enter__(self):
        # An address, because the mail library's name lookup cannot resolve a Docker container's name inside the Edge runtime.
        mail_host = subprocess.run(['docker', 'inspect', '-f', '{{(index .NetworkSettings.Networks "supabase_network_motivance").IPAddress}}', MAIL_CONTAINER], capture_output=True, text=True).stdout.strip()
        if not mail_host:
            raise SystemExit('Mailpit is not running')
        handle, self.path = tempfile.mkstemp(suffix='.env', text=True)
        with os.fdopen(handle, 'w', encoding='utf-8') as file:
            file.writelines(f'{key}={value}\n' for key, value in {**ENVIRONMENT, 'SMTP_HOST': mail_host, **self.extra}.items())
        command = ['npx.cmd' if os.name == 'nt' else 'npx', '--yes', 'supabase@2.20.12', 'functions', 'serve', '--env-file', self.path]
        self.process = subprocess.Popen(command, cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(90):
            if http(f'{FUNCTIONS}/notification-dispatch', 'POST', {})[0] == 401:
                break
            time.sleep(1)
        else:
            raise SystemExit('The functions did not start')
        host = subprocess.run(['docker', 'exec', RUNTIME, 'printenv', 'SMTP_HOST'], capture_output=True, text=True).stdout.strip()
        if host != mail_host:
            raise SystemExit(f'Refusing to run: the function would send through {host!r}, not Mailpit')
        return self

    def __exit__(self, *_):
        self.process.terminate()
        subprocess.run(['docker', 'rm', '-f', RUNTIME], capture_output=True)
        os.unlink(self.path)


def status(stack, booking_or_id):
    return stack.sql(f"select d.status from public.notification_deliveries d join public.notifications n on n.id=d.notification_id where n.booking_id='{booking_or_id}' and d.channel='email' order by d.created_at desc limit 1;")


def checks(stack):
    _, ts = stack.user('patient', 'scheduler', name='Email Sol Scheduler')
    tess, tt = stack.user('patient', 'therapist', name='Email Tess Therapist')
    ana, ta = stack.user('patient', name='Email Ana Patient')
    ben, tb = stack.user('patient', name='Email Ben Paciente')
    addresses = {person: stack.sql(f"select email from auth.users where id='{person}';") for person in (ana, ben, tess)}
    scheduler_address = stack.sql("select u.email from auth.users u join public.profiles p on p.display_name='Email Sol Scheduler' and p.id=u.id;")
    fresh = working_days(stack)
    day, other, later = next(fresh), next(fresh), next(fresh)
    stack.sql(f"update public.center_settings set location='{LOCATION}';")

    def request(token, start):
        code, data = stack.rpc('request_booking', {'p_request': str(uuid.uuid4()), 'p_starts': start}, token)
        assert code == 200, data
        return data

    def act(name, body, token=ts):
        code, data = stack.rpc(name, body, token)
        assert code == 200, (name, data)
        return data

    def drain():
        for _ in range(12):
            code, result = dispatch()
            assert code == 200, result
            if result['claimed'] == 0:
                return
        raise AssertionError('The queue did not empty')

    # A booking only writes a row.
    clear_mail()
    started = time.perf_counter()
    a = request(ta, manila(day, 9))
    stack.check(time.perf_counter() - started < 5, 'A booking does not wait for email')
    stack.check(status(stack, a['id']) == 'pending', 'It leaves a row in the queue')
    stack.check(inbox(scheduler_address) == [], 'Nothing is sent until the queue is drained')

    # The shared secret.
    stack.check(dispatch(None)[0] == 401, 'The dispatcher refuses a call with no secret')
    stack.check(dispatch('x' * len(SECRET))[0] == 401, 'And one with the wrong secret')
    stack.check(status(stack, a['id']) == 'pending', 'A refused call claims nothing')
    for label, code in [('a patient', stack.rpc('claim_notification_deliveries', {}, ta)[0]), ('someone signed out', stack.rpc('claim_notification_deliveries', {})[0])]:
        stack.check(code in (401, 403, 404), f'{label.capitalize()} cannot claim the queue')
    code, found = stack.api('/rest/v1/notification_deliveries?select=*', token=ta)
    stack.check(code in (401, 403) or found == [], 'Nor read it')

    # A real send.
    drain()
    stack.check(status(stack, a['id']) == 'sent', 'Draining marks it sent')
    alert = only(scheduler_address)
    stack.check(alert['Subject'] == 'New request: Email Ana Patient', 'A Scheduler gets the alert by email')
    stack.check(alert['From']['Address'] == 'noreply@motivance.test' and alert['From']['Name'] == 'Motivance', 'It comes from the configured sender')

    act('scheduler_confirm', {'p_booking': a['id'], 'p_therapist': tess})
    drain()
    mail = only(addresses[ana])
    body = mail['Text'].replace(' ', ' ')
    stack.check(mail['Subject'] == 'Your session is confirmed', 'A patient hears by email')
    stack.check('9:00 AM – 10:00 AM' in body, 'With the specific time in Manila')
    stack.check(date.fromisoformat(str(day)).strftime('%B') in body and str(day.day) in body, 'The session date')
    stack.check('Email Tess Therapist' in body and LOCATION in body and a['reference_no'] in body, 'The therapist, location and reference')
    stack.check('<table' in mail['HTML'] and 'Email Tess Therapist' in mail['HTML'], 'And an HTML part')
    link = re.search(r'https?://\S*booking-calendar\?token=[0-9a-f]+', body)
    stack.check(link is not None, 'A confirmation has a calendar link')
    code, ics = http(link.group(0))
    stack.check(code == 200 and 'BEGIN:VEVENT' in ics, 'The link returns a calendar file')
    uid = re.search(r'UID:(\S+)', ics).group(1)
    first_start = re.search(r'DTSTART:(\S+)', ics).group(1)
    stack.check('SEQUENCE:0' in ics and first_start.endswith('010000Z'), 'It holds the session in UTC')
    stack.check(LOCATION.split(',')[0] in ics and a['reference_no'] in ics, 'With the location and reference')
    stack.check('Ana' not in ics and 'Tess' not in ics, 'And names nobody')
    therapist_mail = only(addresses[tess])
    stack.check(therapist_mail['Subject'] == 'New session: Email Ana Patient', 'The therapist hears too')

    # A reschedule updates the same entry.
    clear_mail()
    act('scheduler_reschedule', {'p_booking': a['id'], 'p_starts': manila(other, 10), 'p_therapist': tess})
    drain()
    moved = only(addresses[ana])
    stack.check(moved['Subject'] == 'Your session has moved' and 'booking-calendar' in moved['Text'], 'A reschedule email has a calendar link')
    code, ics = http(link.group(0))
    stack.check(re.search(r'UID:(\S+)', ics).group(1) == uid, 'The file keeps the same entry')
    stack.check('SEQUENCE:1' in ics and re.search(r'DTSTART:(\S+)', ics).group(1) != first_start, 'And a higher sequence and the new time, so calendars replace it')

    clear_mail()
    act('scheduler_cancel', {'p_booking': a['id'], 'p_reason': 'Water <b>outage</b>'})
    drain()
    cancelled = only(addresses[ana])
    stack.check('booking-calendar' not in cancelled['Text'], 'A cancellation has no link to add it')
    stack.check('Water <b>outage</b>' in cancelled['Text'] and '<b>outage</b>' not in cancelled['HTML'], "The reason arrives, and can't inject HTML")
    stack.check('STATUS:CANCELLED' in http(link.group(0))[1], 'The calendar file now says it is cancelled')
    stack.check(http(f'{FUNCTIONS}/booking-calendar?token=' + '0' * 48)[0] == 404, 'An unknown token finds nothing')
    stack.check(http(f'{FUNCTIONS}/booking-calendar?token=x')[0] == 404, 'A malformed token is refused')
    stack.check(stack.rpc('booking_calendar', {'p_token': 'x'}, ta)[0] in (403, 404), 'Nobody can search calendars through the API')

    # The recipient's language.
    stack.check(refused(stack.rpc('set_my_language', {'p_language': 'de'}, tb), 'booking_invalid'), 'Only known languages are accepted')
    stack.check(stack.rpc('set_my_language', {'p_language': 'fil'}, tb)[0] == 204, 'A person can set their language')
    clear_mail()
    b = request(tb, manila(later, 9))
    act('scheduler_confirm', {'p_booking': b['id'], 'p_therapist': tess})
    drain()
    filipino = only(addresses[ben])
    stack.check(filipino['Subject'] == 'Kumpirmado ang iyong session', 'A Filipino reader gets a Filipino email')
    stack.check('Lokasyon' in filipino['Text'] and 'Idagdag sa kalendaryo' in filipino['Text'], 'All of it')
    stack.check(only(addresses[tess])['Subject'] == 'New session: Email Ben Paciente', 'The therapist still gets their own language')

    # Two runs at once.
    clear_mail()
    made = [request(token, manila(later, hour)) for token, hour in [(ta, 10), (tb, 12), (ta, 13), (tb, 14)]]
    for booking in made:
        act('scheduler_confirm', {'p_booking': booking['id'], 'p_therapist': tess})
    waiting = int(stack.sql("select count(*) from public.notification_deliveries where status='pending' and channel='email';"))
    stack.check(waiting >= 8, 'A real backlog is waiting')
    results = together([dispatch, dispatch, dispatch, dispatch])
    stack.check(all(code == 200 for code, _ in results), 'Runs can overlap')
    stack.check(sum(result['claimed'] for _, result in results) <= waiting, 'No row is claimed twice')
    drain()
    stack.check(len(inbox(addresses[ana])) == 2 and len(inbox(addresses[ben])) == 2 and len(inbox(addresses[tess])) == 4, 'Overlapping runs send each email once, not twice')

    # Retries.
    clear_mail()
    c = request(ta, manila(later, 15))
    act('scheduler_confirm', {'p_booking': c['id'], 'p_therapist': tess})
    drain()
    stack.sql(f"update auth.users set email=null where id='{ana}';")
    act('scheduler_cancel', {'p_booking': c['id'], 'p_reason': 'Test'})
    row = f"(select d.id from public.notification_deliveries d join public.notifications n on n.id=d.notification_id where d.channel='email' and n.booking_id='{c['id']}' and n.user_id='{ana}' and n.kind='cancelled')"
    waits = []
    for attempt in range(1, 6):
        stack.sql(f"update public.notification_deliveries set next_attempt_at=now() where id={row};")
        dispatch()
        state = stack.sql(f"select status,attempts,round(extract(epoch from next_attempt_at-now())/60) from public.notification_deliveries where id={row};").split('|')
        waits.append(state)
    stack.check([item[0] for item in waits] == ['pending', 'pending', 'pending', 'pending', 'failed'], 'A failure retries four times, then stops')
    stack.check([int(item[1]) for item in waits] == [1, 2, 3, 4, 5], 'Each try is counted')
    stack.check([int(float(item[2])) for item in waits[:4]] == [2, 4, 8, 16], 'And waits longer each time')
    stack.check(stack.sql(f"select last_error from public.notification_deliveries where id={row};") == 'No email address', 'The reason is kept')
    stack.sql(f"update public.notification_deliveries set next_attempt_at=now() where id={row};")
    dispatch()
    stack.check(stack.sql(f"select attempts from public.notification_deliveries where id={row};") == '5', 'A failed row is left alone')
    stack.sql(f"update auth.users set email='{addresses[ana]}' where id='{ana}';")

    # A run that died partway.
    clear_mail()
    d = request(ta, manila(other, 14))
    act('scheduler_confirm', {'p_booking': d['id'], 'p_therapist': tess})
    stack.sql(f"update public.notification_deliveries x set status='sending',claimed_at=now()-interval '10 minutes' from public.notifications n where x.channel='email' and n.id=x.notification_id and n.booking_id='{d['id']}' and n.user_id='{ana}';")
    drain()
    stack.check(len(inbox(addresses[ana])) == 1, 'A row left claimed by a dead run is picked up again')
    stack.sql(f"update public.notification_deliveries x set status='sending',claimed_at=now() from public.notifications n where x.channel='email' and n.id=x.notification_id and n.booking_id='{d['id']}' and n.user_id='{ana}';")
    clear_mail()
    drain()
    stack.check(inbox(addresses[ana]) == [], 'One being sent right now is left alone')

    # pg_cron drains the queue.
    stack.check(stack.sql("select count(*) from cron.job where jobname='notification-dispatch' and active;") == '1', 'The job is scheduled')
    clear_mail()
    stack.sql("select public.dispatch_notifications();")
    e = request(tb, manila(other, 15))
    act('scheduler_confirm', {'p_booking': e['id'], 'p_therapist': tess})
    stack.sql(f"select vault.create_secret('http://supabase_kong_motivance:8000/functions/v1/notification-dispatch','notification_dispatch_url'); select vault.create_secret('{SECRET}','notification_dispatch_secret');")
    try:
        for _ in range(80):
            if inbox(addresses[ben]):
                break
            time.sleep(1)
        stack.check(len(inbox(addresses[ben])) == 1, 'The scheduled job drains the queue by itself')
    finally:
        stack.sql("delete from vault.secrets where name in ('notification_dispatch_url','notification_dispatch_secret');")


def sprint_demo(stack):
    """The S10 demo in one sitting: a confirmed session, a closure over it, and the news reaching the patient."""
    _, ts = stack.user('patient', 'scheduler', name='Demo Sol Scheduler')
    tess, tt = stack.user('patient', 'therapist', name='Demo Tess Therapist')
    ana, ta = stack.user('patient', name='Demo Ana Patient')
    address = stack.sql(f"select email from auth.users where id='{ana}';")
    fresh = working_days(stack, 8)
    day, other = next(fresh), next(fresh)
    clear_mail()

    code, booked = stack.rpc('request_booking', {'p_request': str(uuid.uuid4()), 'p_starts': manila(day, 11)}, ta)
    assert code == 200, booked
    assert stack.rpc('scheduler_confirm', {'p_booking': booked['id'], 'p_therapist': tess}, ts)[0] == 200

    def on_schedule(name, token, date_value):
        found = stack.rpc(name, {'p_from': str(date_value), 'p_to': str(date_value)}, token)[1]['days'][0]
        return [row for row in found['rows'] if row['session'] and row['session']['id'] == booked['id']]

    stack.check(manila_hour(on_schedule('my_schedule', ta, day)[0]['starts_at']) == 11, "Demo: it is on the patient's My Schedule at 11")
    stack.check(manila_hour(on_schedule('therapist_schedule', tt, day)[0]['starts_at']) == 11, "Demo: and on the therapist's")

    start, end = manila(day, 0), manila(day + timedelta(days=1), 0)
    impact = stack.rpc('scheduler_calendar_impact', {'p_starts': start, 'p_ends': end}, ts)[1]
    stack.check(booked['id'] in [row['id'] for row in impact], 'Demo: a closure over it lists it')
    decisions = [{'booking': row['id'], 'action': 'reschedule', 'starts_at': manila(other, 10), 'therapist': tess} for row in impact if row['id'] == booked['id']]
    others = [{'booking': row['id'], 'action': 'cancel', 'reason': 'Demo closure'} for row in impact if row['id'] != booked['id']]
    code, _ = stack.rpc('scheduler_save_closure', {'p_id': None, 'p_starts': start, 'p_ends': end, 'p_all_day': True, 'p_reason': 'Demo closure', 'p_resolutions': decisions + others}, ts)
    try:
        stack.check(code == 200, 'Demo: resolving the booking saves the closure')
        stack.check(on_schedule('my_schedule', ta, day) == [] and manila_hour(on_schedule('my_schedule', ta, other)[0]['starts_at']) == 10, 'Demo: the session moved on My Schedule')
        rows = stack.rpc('my_notifications', {}, ta)[1]['rows']
        stack.check(rows[0]['kind'] == 'rescheduled' and rows[0]['data']['reference_no'] == booked['reference_no'], 'Demo: the patient has the in-app notification')
        for _ in range(12):
            if dispatch()[1]['claimed'] == 0:
                break
        mail = [message(item) for item in inbox(address)]
        moved = next(item for item in mail if item['Subject'] == 'Your session has moved')
        link = re.search(r'https?://\S*booking-calendar\?token=[0-9a-f]+', moved['Text'])
        stack.check(link is not None, 'Demo: and the email with its calendar link')
        ics = http(link.group(0))[1]
        stack.check(re.search(r'DTSTART:(\S+)', ics).group(1).endswith('020000Z'), 'Demo: the calendar file has the new time')
    finally:
        stack.sql("delete from public.center_closures where reason='Demo closure';")


def waitlist_mail(stack):
    """MOT-63: a place opening reaches the inbox, through the same queue as everything else."""
    capacity = stack.sql('select slot_capacity from public.center_settings;')
    stack.sql('update public.center_settings set slot_capacity=1 where id;')
    try:
        ana, ta = stack.user('patient', name='Email Ana Waiting')
        _, tb = stack.user('patient', name='Email Ben Holding')
        address = stack.sql(f"select email from auth.users where id='{ana}';")
        start = manila(next(working_days(stack, 9)), 9)
        code, held = stack.rpc('request_booking', {'p_request': str(uuid.uuid4()), 'p_starts': start}, tb)
        assert code == 200, held
        assert stack.rpc('join_waitlist', {'p_starts': start}, ta)[0] == 200
        clear_mail()
        assert stack.rpc('cancel_my_booking', {'p_booking': held['id']}, tb)[0] == 200
        for _ in range(12):
            if dispatch()[1]['claimed'] == 0:
                break
        mail = [message(item) for item in inbox(address)]
        opened = next((item for item in mail if item['Subject'] == 'A place has opened'), None)
        stack.check(opened is not None, 'Waitlist: a place opening reaches the inbox')
        stack.check('/patient/bookings' in opened['Text'] and 'Reference' not in opened['Text'] and 'booking-calendar' not in opened['Text'], 'Waitlist: it points straight to the place, with no session details')
    finally:
        stack.sql(f'update public.center_settings set slot_capacity={capacity} where id;')


def series_mail(stack):
    """MOT-66: a weekly course is one email each, however many sessions it has, in each reader's language."""
    _, ts = stack.user('patient', 'scheduler', name='Email Sol Series')
    tess, tt = stack.user('patient', 'therapist', name='Email Tess Series')
    ana, ta = stack.user('patient', name='Email Ana Series')
    assert stack.rpc('set_my_language', {'p_language': 'fil'}, ta)[0] == 204
    first = stack.sql("""select d::date from generate_series(current_date+200,current_date+260,interval '1 day') d where extract(isodow from d)<6
 and not exists(select 1 from public.center_holidays h,generate_series(0,3) n where (d+make_interval(weeks=>n))::date between h.starts_on and h.ends_on) order by d limit 1;""")
    addresses = {person: stack.sql(f"select email from auth.users where id='{person}';") for person in (ana, tess)}
    clear_mail()
    code, made = stack.rpc('scheduler_series_create', {'p_request': str(uuid.uuid4()), 'p_patient': ana, 'p_therapist': tess, 'p_starts': manila(date.fromisoformat(first), 13), 'p_weeks': 4}, ts)
    assert code == 200, made

    def drain():
        for _ in range(12):
            if dispatch()[1]['claimed'] == 0:
                return

    drain()
    patient, therapist = only(addresses[ana]), only(addresses[tess])
    stack.check(patient['Subject'] == 'Naka-book ang iyong lingguhang session' and 'Mga session: 4.' in patient['Text'], 'Series: the patient gets one email for the course, in Filipino')
    stack.check(therapist['Subject'] == 'Weekly sessions: Email Ana Series' and 'Sessions: 4.' in therapist['Text'], 'Series: the therapist gets one too')
    stack.check('booking-calendar' not in patient['Text'], 'Series: it offers no calendar link, because one link cannot hold a course')
    clear_mail()
    assert stack.rpc('scheduler_series_cancel', {'p_series': made['id'], 'p_reason': 'Course finished early'}, ts)[0] == 200
    drain()
    stack.check(only(addresses[ana])['Subject'] == 'Kinansela ang iyong lingguhang session', 'Series: cancelling it is one email')


def main():
    stack = Stack()
    try:
        with Functions():
            checks(stack)
            sprint_demo(stack)
            waitlist_mail(stack)
            series_mail(stack)
        REPORT.write_text(json.dumps({'generated_at': datetime.now(timezone.utc).isoformat(), 'checks_passed': len(stack.checks), 'checks': stack.checks,
                                      'environment': 'real local Auth, PostgREST, Edge Functions and Mailpit with disposable synthetic accounts'}, indent=2) + '\n', encoding='utf-8')
        print(f'{len(stack.checks)} checks passed.')
    finally:
        stack.sql("update public.center_settings set location='';")
        clear_mail()
        stack.clean()


if __name__ == '__main__':
    main()
