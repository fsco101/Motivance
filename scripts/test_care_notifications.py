"""Exercise, practice and care-team notifications, and photos beside names, on the local stack with disposable synthetic accounts.

Run after `supabase start` and `supabase migration up --local`. Nothing here sends email or reaches Google: these checks read the
rows the dispatcher would send. The scheduled jobs may run while this does, so every check reads the end state rather than a
job's return value, and any time a job is asked about is chosen so that the real job would agree. Accounts it creates are removed again.

    python scripts/test_care_notifications.py
"""
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import time
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_booking import ROOT, Stack, manila, working_day

REPORT = ROOT / 'docs/validation/care-notification-test-results.json'
ELBOW = '21000000-0000-0000-0000-000000000001'
NEW_KINDS = ('plan_updated', 'session_finished', 'practice_reminder', 'patient_inactive', 'care_linked', 'care_unlinked', 'patient_linked', 'patient_unlinked')


def photo(uid):
    return f'https://res.cloudinary.com/motivance-test/image/upload/v1/motivance/avatars/{uid}/{uuid.uuid4().hex}'


def run(stack):
    sql, rpc, check = stack.sql, stack.rpc, stack.check
    admin, ta = stack.user('admin', name='Care Fixture Admin')
    therapist, tt = stack.user('therapist', name='Care Fixture Therapist')
    second, ts = stack.user('therapist', name='Care Fixture Second Therapist')
    patient, tp = stack.user('patient', name='Care Fixture Patient')
    quiet, tq = stack.user('patient', name='Care Fixture Quiet Patient')
    planless, tn = stack.user('patient', name='Care Fixture Planless Patient')
    late, tl = stack.user('patient', name='Care Fixture Late Patient')
    scheduler, tsc = stack.user('scheduler', name='Care Fixture Scheduler')
    zone = sql('select time_zone from public.center_settings;')

    def count(uid, kind, subject=None):
        about = f" and subject_id='{subject}'" if subject else ''
        return int(sql(f"select count(*) from public.notifications where user_id='{uid}' and kind='{kind}'{about};"))

    def push_states(uid, kind):
        return sql(f"""select d.status||':'||coalesce(d.last_error,'') from public.notification_deliveries d join public.notifications n on n.id=d.notification_id
 where n.user_id='{uid}' and n.kind='{kind}' and d.channel='push' order by n.created_at;""").splitlines()

    def inbox(token):
        code, data = rpc('my_notifications', {}, token)
        assert code == 200, code
        return data['rows']

    def link(person, token):
        email = sql(f"select email from auth.users where id='{person}';")
        code, data = rpc('invite_patient', {'p_email': email}, tt)
        assert code == 200, code
        code, _ = rpc('accept_patient_invitation', {'p_code': data['code']}, token)
        assert code == 200, code

    def admin_link(who, person, active):
        code, _ = rpc('admin_set_link', {'p_therapist': who, 'p_patient': person, 'p_active': active}, ta)
        assert code in (200, 204), code

    def publish(person, assignment=None):
        body = {'p_assignment': assignment or str(uuid.uuid4()), 'p_version': str(uuid.uuid4()), 'p_patient': person, 'p_exercise': ELBOW,
                'p_side': 'left', 'p_low': 20, 'p_high': 90, 'p_repetitions': 5, 'p_parameters': {}}
        code, _ = rpc('publish_prescription', body, tt)
        assert code == 200, code
        return body

    def bucket():
        return int(sql('select floor(extract(epoch from now())/900)::bigint;'))

    # Care team: an accepted invitation tells only the therapist, because the patient accepted it themselves.
    link(patient, tp)
    check(count(therapist, 'patient_linked', patient) == 1, 'An accepted invitation tells the therapist, about the patient')
    check(count(patient, 'care_linked') == 0, 'The patient who accepted it is not told what they did')

    admin_link(second, patient, True)
    check(count(patient, 'care_linked', second) == 1, 'An administrator linking a patient tells the patient, about the therapist')
    check(count(second, 'patient_linked', patient) == 1, 'And tells the therapist, about the patient')
    check(int(sql(f"select count(*) from public.notifications where user_id='{admin}';")) == 0, 'The administrator who did it is told nothing')

    code, _ = rpc('revoke_patient_link', {'p_patient': patient}, tt)
    assert code in (200, 204), code
    check(count(patient, 'care_unlinked', therapist) == 1, 'A therapist ending a link tells the patient')
    check(count(therapist, 'patient_unlinked') == 0, 'The therapist who ended it is not told')

    admin_link(therapist, patient, True)
    check(count(patient, 'care_linked', therapist) == 1 and count(therapist, 'patient_linked', patient) == 2, 'A link made again is a new notification for both')

    code, _ = rpc('admin_set_role', {'p_user': second, 'p_role': 'therapist', 'p_granted': False}, ta)
    assert code in (200, 204), code
    check(count(patient, 'care_unlinked', second) == 1, 'Taking away the therapist role tells each of their patients')
    check(count(second, 'patient_unlinked') == 0, 'And sends the former therapist nothing, rather than one per patient')

    rows = [row for row in inbox(tp) if row['kind'] == 'care_linked' and row['subject_id'] == therapist]
    check(len(rows) == 1 and rows[0]['subject_name'] == 'Care Fixture Therapist' and rows[0]['subject_photo'] is None,
          'The bell names the subject, with no photo while they have none')
    picture = photo(therapist)
    sql(f"update public.profiles set photo_url='{picture}' where id='{therapist}';")
    check(all(row['subject_photo'] == picture for row in inbox(tp) if row['subject_id'] == therapist), 'And shows their photo once they have one')
    check(all('dedupe_key' not in row and 'user_id' not in row for row in inbox(tp)), 'The bell still hides the reader and the dedupe key')

    # Plans: a burst of publishing is one notification.
    before = bucket()
    first = publish(patient)
    publish(patient)
    publish(patient, first['p_assignment'])
    after = bucket()
    check(count(patient, 'plan_updated', therapist) == after - before + 1, 'Publishing several exercises in a quarter of an hour is one notification')
    data = json.loads(sql(f"select data from public.notifications where user_id='{patient}' and kind='plan_updated' limit 1;"))
    check(data == {'therapist_name': 'Care Fixture Therapist'}, 'It names the therapist')
    check(count(therapist, 'plan_updated') == 0, 'The therapist who published is not told')

    # Sessions: the plan's therapist hears, with the repetitions.
    now = int(time.time() * 1000)
    grant = str(uuid.uuid4())
    code, _ = rpc('record_consent', {'p_id': grant, 'p_event': 'granted', 'p_version': 'movement-summary-v1',
                                     'p_occurred_at': datetime.fromtimestamp((now - 60000) / 1000, timezone.utc).isoformat()}, tp)
    assert code == 200, code

    def upload(plan, token=tp, owner=patient, consent=grant):
        session = str(uuid.uuid4())
        rules = {'kind': 'ELBOW_FLEXION', 'side': 'LEFT', 'low': 20, 'high': 90, 'target': 5, 'confidence': .7, 'stableFrames': 5, 'minimumCycleMs': 600,
                 'maximumCycleMs': 30000, 'peakHoldMs': 100, 'maxTrunkLean': 20, 'maxSpeed': 600, 'version': ELBOW, 'prescription': plan['p_version'], 'demo': False}
        code, _ = rpc('ingest_session', {'p_payload': {'schemaVersion': 2, 'sessionId': session, 'ownerId': owner, 'consentId': consent, 'startedAt': now - 20000,
            'endedAt': now - 10000, 'rules': rules, 'metrics': {'time': 1000, 'angle': 10, 'min': 10, 'max': 85, 'completed': 6, 'incomplete': 0, 'duration': 1000,
            'valid': 40, 'invalid': 2, 'reasons': {}}}}, token)
        assert code == 200, code
        return session

    session = upload(first)
    check(count(therapist, 'session_finished', patient) == 1, 'A finished session tells the plan\'s therapist, about the patient')
    data = json.loads(sql(f"select data from public.notifications where user_id='{therapist}' and kind='session_finished';"))
    check(data['completed'] == 6 and data['target'] == 5 and data['side'] == 'left' and data['patient_name'] == 'Care Fixture Patient', 'It carries the repetitions, the target and the side')
    check(count(patient, 'session_finished') == 0, 'The patient is not told about their own session')
    check(int(sql(f"select count(*) from public.notifications where kind='session_finished' and dedupe_key='session_finished:{session}';")) == 1, 'One notification per session')

    # Switches: off stops the push and keeps the bell.
    code, saved = rpc('save_notification_settings', {'p_bookings': True, 'p_exercise_plan': True, 'p_session_results': False, 'p_inactivity': True, 'p_care_team': True}, tt)
    check(code == 200 and saved['session_results'] is False and saved['reminder_time'] is None, 'A therapist can turn off session pushes')
    upload(first)
    check(count(therapist, 'session_finished') == 2, 'A session still reaches the bell with its switch off')
    check(push_states(therapist, 'session_finished') == ['pending:', 'skipped:Turned off'], 'But its push is recorded as skipped, with the reason')
    code, _ = rpc('save_notification_settings', {'p_bookings': True, 'p_exercise_plan': True, 'p_session_results': True, 'p_inactivity': True, 'p_care_team': True}, tt)
    assert code == 200, code

    check(all(state == 'pending:' for state in push_states(patient, 'care_linked') + push_states(patient, 'plan_updated')), 'Pushes for the new kinds wait in the queue like booking pushes')

    # The daily practice reminder: only for someone with a plan who has not exercised today, in the two hours after their time.
    admin_link(therapist, quiet, True)
    quiet_plan = publish(quiet)
    admin_link(therapist, late, True)
    publish(late)
    minutes = int(sql(f"select extract(hour from now() at time zone '{zone}')*60+extract(minute from now() at time zone '{zone}');"))
    at = lambda total: f'{total // 60:02d}:{total % 60:02d}'

    def remind(token, value):
        code, data = rpc('save_notification_settings', {'p_bookings': True, 'p_exercise_plan': True, 'p_session_results': True, 'p_inactivity': True,
                                                         'p_care_team': True, 'p_reminder_time': value}, token)
        assert code == 200, code
        return data

    due = at(max(minutes - 30, 0))
    check(remind(tq, due)['reminder_time'] == due, 'A patient can choose a reminder time')
    remind(tp, due)
    remind(tn, due)
    sql('select public.enqueue_practice_reminders();')
    sql('select public.enqueue_practice_reminders();')
    today = sql(f"select (now() at time zone '{zone}')::date;")
    check(count(quiet, 'practice_reminder') == 1, 'A patient with a plan who has not exercised today is reminded once, however often the job runs')
    check(json.loads(sql(f"select data from public.notifications where user_id='{quiet}' and kind='practice_reminder';")) == {'date': today}, 'The reminder is for today')
    check(count(patient, 'practice_reminder') == 0, 'A patient who has exercised today is not reminded')
    check(count(planless, 'practice_reminder') == 0, 'A patient with nothing to do is not reminded')
    check(push_states(quiet, 'practice_reminder') == ['pending:'], 'The reminder is pushed')
    if minutes >= 3 * 60 + 5:
        remind(tl, at(minutes - 3 * 60))
        sql('select public.enqueue_practice_reminders();')
        check(count(late, 'practice_reminder') == 0, 'A reminder more than two hours late is not sent')
    else:
        print('SKIP the late reminder check: too close to midnight at the center', flush=True)
    remind(tq, None)

    # Inactivity: three quiet days, once per stretch, and only in the day.
    sql(f"update public.exercise_assignments set created_at=now()-interval '4 days' where patient_id='{quiet}';")
    night = sql(f"select ((now() at time zone '{zone}')::date+time '22:00') at time zone '{zone}';")
    check(sql(f"select public.enqueue_inactivity_alerts('{night}');") == '0', 'Inactivity alerts wait for the day')
    day = sql(f"select case when extract(hour from now() at time zone '{zone}') between 8 and 19 then now() else ((now() at time zone '{zone}')::date+time '12:00') at time zone '{zone}' end;")
    sql(f"select public.enqueue_inactivity_alerts('{day}');")
    sql(f"select public.enqueue_inactivity_alerts('{day}');")
    check(count(therapist, 'patient_inactive', quiet) == 1, 'A patient quiet for three days is reported to their therapist once')
    data = json.loads(sql(f"select data from public.notifications where user_id='{therapist}' and kind='patient_inactive' and subject_id='{quiet}';"))
    check(data['days'] >= 3 and data['last_session_at'] is None and data['patient_name'] == 'Care Fixture Quiet Patient', 'It says how many days, and that there is no session yet')
    check(count(therapist, 'patient_inactive', patient) == 0, 'A patient who exercised today is not reported')
    check(count(therapist, 'patient_inactive', late) == 0, 'A plan younger than three days is not reported')

    quiet_grant = str(uuid.uuid4())
    code, _ = rpc('record_consent', {'p_id': quiet_grant, 'p_event': 'granted', 'p_version': 'movement-summary-v1',
                                     'p_occurred_at': datetime.fromtimestamp((now - 60000) / 1000, timezone.utc).isoformat()}, tq)
    assert code == 200, code
    quiet_session = upload(quiet_plan, tq, quiet, quiet_grant)
    sql(f"select public.enqueue_inactivity_alerts('{day}');")
    check(count(therapist, 'patient_inactive', quiet) == 1, 'Exercising again ends the stretch without a new alert')
    # Later than the plan's start, so this stretch is anchored at the session rather than the plan, and is a different stretch.
    sql(f"""begin; set local session_replication_role=replica;
update public.sessions set started_at=now()-interval '90 hours',ended_at=now()-interval '90 hours' where id='{quiet_session}'; commit;""")
    sql(f"select public.enqueue_inactivity_alerts('{day}');")
    check(count(therapist, 'patient_inactive', quiet) == 2, 'A new quiet stretch is reported again')

    # Only booking kinds send email.
    ids = ','.join(f"'{uid}'" for uid in stack.users)
    kinds = ','.join(f"'{kind}'" for kind in NEW_KINDS)
    check(sql(f"""select count(*) from public.notification_deliveries d join public.notifications n on n.id=d.notification_id
 where n.user_id in ({ids}) and n.kind in ({kinds}) and d.channel='email';""") == '0', 'None of the new kinds sends email')
    check(sql(f"""select count(*) from public.notifications n where n.user_id in ({ids}) and n.kind in ({kinds})
 and not exists(select 1 from public.notification_deliveries d where d.notification_id=n.id and d.channel='push');""") == '0', 'Every one of them has a push')
    check(sql("select string_agg(public.notification_group(k),',' order by k) from unnest(array['confirmed','plan_updated','session_finished','patient_inactive','practice_reminder','care_unlinked','patient_linked']) k;")
          == 'care_team,bookings,inactivity,care_team,exercise_plan,practice,session_results', 'Each kind answers to its switch')

    # Settings: defaults, validation and ownership.
    code, data = rpc('my_notification_settings', {}, ts)
    check(code == 200 and data == {'bookings': True, 'exercise_plan': True, 'session_results': True, 'inactivity': True, 'care_team': True, 'reminder_time': None},
          'Someone who never chose has every switch on and no reminder')
    for value in ('25:00', '7:30', '07:30:00', 'soon'):
        code, _ = rpc('save_notification_settings', {'p_bookings': True, 'p_exercise_plan': True, 'p_session_results': True, 'p_inactivity': True, 'p_care_team': True, 'p_reminder_time': value}, ts)
        check(code >= 400, f'A reminder time of {value!r} is refused')
    code, _ = rpc('save_notification_settings', {'p_bookings': None, 'p_exercise_plan': True, 'p_session_results': True, 'p_inactivity': True, 'p_care_team': True}, ts)
    check(code >= 400, 'A missing switch is refused')
    code, _ = stack.api('/rest/v1/rpc/save_notification_settings', {'p_bookings': True, 'p_exercise_plan': True, 'p_session_results': True, 'p_inactivity': True, 'p_care_team': True})
    check(code >= 400, 'Signed out, settings cannot be saved')
    code, _ = stack.api('/rest/v1/notification_settings?select=user_id', token=tt)
    check(code >= 400, 'The settings table cannot be read directly')
    for job in ('enqueue_practice_reminders', 'enqueue_inactivity_alerts', 'notify_person'):
        code, _ = rpc(job, {}, ta)
        check(code >= 400, f'{job} cannot be called by a person')

    # Photos beside names.
    patient_picture = photo(patient)
    sql(f"update public.profiles set photo_url='{patient_picture}' where id='{patient}';")
    code, links = rpc('admin_links', {}, ta)
    mine = [row for row in links if row['therapist_id'] == therapist and row['patient_id'] == patient]
    check(code == 200 and mine and mine[0]['therapist_photo'] == picture and mine[0]['patient_photo'] == patient_picture, 'Administrator links carry both photos')
    code, feed = rpc('admin_activity', {}, ta)
    check(code == 200 and feed and all('actor_photo' in row for row in feed), 'The administrator activity feed carries the actor\'s photo')
    code, found = rpc('scheduler_patients', {'p_search': 'Care Fixture Patient'}, tsc)
    check(code == 200 and [row['photo'] for row in found if row['id'] == patient] == [patient_picture], 'The Scheduler\'s patient search carries photos')
    code, found = rpc('scheduler_therapists', {}, tsc)
    check(code == 200 and [row['photo'] for row in found if row['id'] == therapist] == [picture], 'The Scheduler\'s therapist list carries photos')
    check(sql("select public.booking_view(null::public.bookings) ? 'therapist_photo' and public.schedule_view(null::public.bookings,true) ? 'patient_photo';") == 't',
          'Bookings carry the therapist\'s photo, and a therapist\'s schedule the patient\'s')

    start = manila(working_day(stack), 10)
    code, booking = rpc('request_booking', {'p_request': str(uuid.uuid4()), 'p_starts': start}, tp)
    assert code == 200, code
    code, page = rpc('scheduler_bookings', {'p_patient': patient}, tsc)
    check(code == 200 and page['rows'] and page['rows'][0]['patient_photo'] == patient_picture and 'therapist_photo' in page['rows'][0], 'The Scheduler\'s requests carry photos')
    code, detail = rpc('scheduler_booking_detail', {'p_booking': booking['id']}, tsc)
    check(code == 200 and detail['patient_photo'] == patient_picture and all('actor_photo' in event for event in detail['events']), 'A request\'s detail and history carry photos')
    request = [row for row in inbox(tsc) if row['kind'] == 'request_received' and row['booking_id'] == booking['id']]
    check(len(request) == 1 and request[0]['subject_id'] == patient and request[0]['subject_photo'] == patient_picture, 'A booking notification is about the other person, with their photo')
    code, _ = rpc('scheduler_confirm', {'p_booking': booking['id'], 'p_therapist': therapist}, tsc)
    assert code in (200, 204), code
    confirmed = [row for row in inbox(tp) if row['kind'] == 'confirmed' and row['booking_id'] == booking['id']]
    check(len(confirmed) == 1 and confirmed[0]['subject_id'] == therapist and confirmed[0]['subject_photo'] == picture, 'For the patient, a booking notification is about the therapist')
    code, mine = rpc('my_bookings', {}, tp)
    check(code == 200 and [row['therapist_photo'] for row in mine if row['id'] == booking['id']] == [picture], 'The patient\'s bookings carry the therapist\'s photo')


def main():
    stack = Stack()
    try:
        run(stack)
        REPORT.write_text(json.dumps({'generated_at': datetime.now(timezone.utc).isoformat(), 'checks_passed': len(stack.checks), 'checks': stack.checks,
                                      'environment': 'real local Auth and PostgREST with disposable synthetic accounts; no email or FCM is contacted'}, indent=2) + '\n', encoding='utf-8')
        print(f'{len(stack.checks)} checks passed.')
    finally:
        stack.clean()


if __name__ == '__main__':
    main()
