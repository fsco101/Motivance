"""Exercise push for real, against a stub FCM server on this machine and never Google.

Run after `supabase start` and `supabase migration up --local`. This starts the Edge Functions itself, first with no service account and then
with a throwaway one whose token and send addresses point at the stub. Accounts it creates are removed again.
"""
import base64
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import subprocess
import sys
import threading
import urllib.parse
import uuid

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_booking import ROOT, Stack, manila, refused, working_days
from test_email import Functions, dispatch

REPORT = ROOT / 'docs/validation/push-test-results.json'
PROJECT = 'motivance-stub'
# The Edge runtime is a container, so it reaches this machine by Docker's name for it.
STUB_FROM_RUNTIME = 'http://host.docker.internal:{port}'
ACCESS_TOKEN = 'stub-access-token-' + uuid.uuid4().hex
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
PEM = KEY.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()


def unpad(value):
    return base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))


class Stub:
    """Stands in for Google. A token's name says how FCM should answer it."""

    def __init__(self):
        self.tokens = []
        self.sends = []
        self.token_status = 200
        self.fail_once = set()
        stub = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def reply(self, status, body):
                raw = json.dumps(body).encode()
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def do_POST(self):
                raw = self.rfile.read(int(self.headers.get('Content-Length', 0)))
                if self.path == '/token':
                    stub.tokens.append(urllib.parse.parse_qs(raw.decode()))
                    return self.reply(stub.token_status, {'access_token': ACCESS_TOKEN, 'expires_in': 3600} if stub.token_status == 200 else {'error': 'invalid_grant'})
                body = json.loads(raw)
                device = body['message']['token']
                stub.sends.append({'path': self.path, 'authorization': self.headers.get('Authorization'), 'body': body})
                if self.headers.get('Authorization') != f'Bearer {ACCESS_TOKEN}':
                    return self.reply(401, {'error': {'status': 'UNAUTHENTICATED'}})
                if device in stub.fail_once:
                    stub.fail_once.discard(device)
                    return self.reply(503, {'error': {'status': 'UNAVAILABLE', 'details': [{'errorCode': 'UNAVAILABLE'}]}})
                if device.startswith('dead'):
                    return self.reply(404, {'error': {'status': 'NOT_FOUND', 'details': [{'@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', 'errorCode': 'UNREGISTERED'}]}})
                if device.startswith('mismatch'):
                    return self.reply(403, {'error': {'status': 'PERMISSION_DENIED', 'details': [{'errorCode': 'SENDER_ID_MISMATCH'}]}})
                if device.startswith('down'):
                    return self.reply(503, {'error': {'status': 'UNAVAILABLE'}})
                return self.reply(200, {'name': f'projects/{PROJECT}/messages/{uuid.uuid4().hex}'})

        self.server = ThreadingHTTPServer(('0.0.0.0', 0), Handler)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def to(self, device):
        return [item for item in self.sends if item['body']['message']['token'] == device]

    def close(self):
        self.server.shutdown()


def name(prefix):
    return f'{prefix}-{uuid.uuid4().hex}{uuid.uuid4().hex}'


def checks(stack, stub):
    _, ts = stack.user('patient', 'scheduler', name='Push Sol Scheduler')
    tess, tt = stack.user('patient', 'therapist', name='Push Tess Therapist')
    ana, ta = stack.user('patient', name='Push Ana Patient')
    ben, tb = stack.user('patient', name='Push Ben Pasyente')
    cai, tc = stack.user('patient', name='Push Cai Patient')
    dee, td = stack.user('patient', name='Push Dee Patient')
    assert stack.rpc('set_my_language', {'p_language': 'fil'}, tb)[0] == 204
    fresh = working_days(stack, 9)

    def register(token, device):
        code, data = stack.rpc('register_device', {'p_token': device, 'p_platform': 'android'}, token)
        assert code == 204, (code, data)

    def book(token, hour, day):
        code, data = stack.rpc('request_booking', {'p_request': str(uuid.uuid4()), 'p_starts': manila(day, hour)}, token)
        assert code == 200, data
        return data

    def confirm(booking):
        code, data = stack.rpc('scheduler_confirm', {'p_booking': booking['id'], 'p_therapist': tess}, ts)
        assert code == 200, data

    def row(booking, person, kind='confirmed'):
        return f"(select d.id from public.notification_deliveries d join public.notifications n on n.id=d.notification_id where n.booking_id='{booking['id']}' and n.user_id='{person}' and n.kind='{kind}' and d.channel='push')"

    def state(booking, person):
        return stack.sql(f"select status,attempts,coalesce(last_error,'') from public.notification_deliveries where id={row(booking, person)};").split('|')

    def drain():
        for _ in range(12):
            code, result = dispatch()
            assert code == 200, result
            if result['push']['claimed'] == 0:
                return result
        raise AssertionError('The push queue did not empty')

    def tokens_of(person):
        return stack.sql(f"select count(*) from public.device_tokens where user_id='{person}';")

    # The request itself.
    day = next(fresh)
    phone = name('good')
    register(ta, phone)
    first = book(ta, 9, day)
    stub.sends.clear()
    stub.tokens.clear()
    confirm(first)
    drain()
    stack.check(state(first, ana)[0] == 'sent', 'A push is sent and marked sent')
    sent = stub.to(phone)
    stack.check(len(sent) == 1, 'It reaches the patient\'s phone once')
    stack.check(sent[0]['path'] == f'/v1/projects/{PROJECT}/messages:send', 'It goes to the project\'s FCM HTTP v1 address')
    stack.check(sent[0]['authorization'] == f'Bearer {ACCESS_TOKEN}', 'It carries the access token')
    message = sent[0]['body']['message']
    stack.check(set(message) == {'token', 'data', 'android'} and message['android'] == {'priority': 'HIGH'}, 'It carries data and no notification block, so the app controls what a lock screen shows')
    stack.check(message['data']['title'] == 'Your session is confirmed' and 'Push Tess Therapist' in message['data']['body'], 'It says what happened, in the words of the email')
    stack.check(message['data']['kind'] == 'confirmed' and message['data']['booking_id'] == first['id'] and all(isinstance(value, str) for value in message['data'].values()), 'Every value is a string, as FCM requires')

    # The token request.
    stack.check(len(stub.tokens) == 1, 'One run asks for one access token')
    form = stub.tokens[0]
    stack.check(form['grant_type'] == ['urn:ietf:params:oauth:grant-type:jwt-bearer'], 'The token request is a signed service account assertion')
    header, claims, signature = form['assertion'][0].split('.')
    KEY.public_key().verify(unpad(signature), f'{header}.{claims}'.encode(), padding.PKCS1v15(), hashes.SHA256())
    stack.check(json.loads(unpad(header))['alg'] == 'RS256', 'Its RS256 signature verifies against the account\'s key')
    claim = json.loads(unpad(claims))
    stack.check(claim['iss'] == f'push@{PROJECT}.iam.gserviceaccount.com' and claim['scope'] == 'https://www.googleapis.com/auth/firebase.messaging' and claim['exp'] - claim['iat'] == 3600, 'It asks for the messaging scope only, for an hour')

    # Language, and more than one phone.
    tablet = name('good')
    register(tb, tablet)
    second = book(tb, 10, day)
    confirm(second)
    drain()
    stack.check(stub.to(tablet)[0]['body']['message']['data']['title'] == 'Kumpirmado ang iyong session', 'It arrives in the reader\'s language')
    other = name('good')
    register(ta, other)
    stub.sends.clear()
    third = book(ta, 11, day)
    confirm(third)
    drain()
    stack.check(len(stub.to(phone)) == 1 and len(stub.to(other)) == 1, 'Every phone a person has gets it')
    stack.check(stack.sql(f"select count(*) from public.notification_deliveries where id={row(third, ana)} and status='sent';") == '1', 'And it is still one delivery')

    # Dead tokens.
    dead = name('dead')
    register(ta, dead)
    stub.sends.clear()
    day = next(fresh)
    fourth = book(ta, 9, day)
    confirm(fourth)
    drain()
    stack.check(state(fourth, ana)[0] == 'sent' and stack.sql(f"select count(*) from public.device_tokens where token='{dead}';") == '0', 'A dead token is removed, and the phones that got it still count')
    mismatch = name('mismatch')
    only = name('dead')
    register(tc, only)
    register(tc, mismatch)
    fifth = book(tc, 10, day)
    confirm(fifth)
    drain()
    stack.check(tokens_of(cai) == '0', 'A token from another Firebase project is removed too')
    stack.check(state(fifth, cai)[0] == 'skipped' and state(fifth, cai)[2] == 'No device', 'With no phone left there is nobody to reach, which is not a failure')

    # Retries.
    flaky = name('good')
    register(tc, flaky)
    stub.fail_once.add(flaky)
    sixth = book(tc, 11, day)
    confirm(sixth)
    dispatch()
    now = state(sixth, cai)
    stack.check(now[0] == 'pending' and now[1] == '1' and now[2] == 'FCM 503', 'A temporary failure waits to try again, and keeps the reason')
    stack.check(stack.sql(f"select round(extract(epoch from next_attempt_at-now())/60) from public.notification_deliveries where id={row(sixth, cai)};") == '2', 'It waits 2 minutes, as email does')
    stack.check(tokens_of(cai) == '1', 'The token stays')
    stack.sql(f"update public.notification_deliveries set next_attempt_at=now() where id={row(sixth, cai)};")
    drain()
    stack.check(state(sixth, cai)[0] == 'sent' and state(sixth, cai)[1] == '2', 'The next try gets through')
    down = name('down')
    stack.sql(f"delete from public.device_tokens where user_id='{cai}';")
    register(tc, down)
    day = next(fresh)
    seventh = book(tc, 9, day)
    confirm(seventh)
    for _ in range(5):
        stack.sql(f"update public.notification_deliveries set next_attempt_at=now() where id={row(seventh, cai)};")
        dispatch()
    stack.check(state(seventh, cai)[:2] == ['failed', '5'], 'After 5 attempts it stops as failed')
    stack.sql(f"delete from public.device_tokens where user_id='{cai}';")

    # Google refusing the service account, nobody to reach, and an account switched off.
    stub.token_status = 401
    register(tc, name('good'))
    eighth = book(tc, 10, day)
    confirm(eighth)
    dispatch()
    stub.token_status = 200
    stack.check(state(eighth, cai)[0] == 'pending' and 'access token' in state(eighth, cai)[2], 'A refused service account waits to try again, and says why')
    stack.sql(f"update public.notification_deliveries set next_attempt_at=now() where id={row(eighth, cai)};")
    drain()
    stack.sql(f"delete from public.device_tokens where user_id='{cai}';")
    ninth = book(tc, 11, day)
    stub.sends.clear()
    confirm(ninth)
    drain()
    stack.check(state(ninth, cai)[0] == 'skipped' and state(ninth, cai)[2] == 'No device' and all(item['body']['message']['data']['booking_id'] != ninth['id'] for item in stub.sends), 'A person with no phone is skipped')
    disabled = name('good')
    register(td, disabled)
    day = next(fresh)
    tenth = book(td, 9, day)
    stack.sql(f"update public.profiles set active=false where id='{dee}';")
    confirm(tenth)
    stub.sends.clear()
    drain()
    stack.sql(f"update public.profiles set active=true where id='{dee}';")
    stack.check(stub.to(disabled) == [] and state(tenth, dee)[0] == 'skipped', 'A disabled account hears nothing')

    # Email does not depend on any of this.
    stack.check(stack.sql(f"select status from public.notification_deliveries d join public.notifications n on n.id=d.notification_id where n.booking_id='{first['id']}' and n.user_id='{ana}' and n.kind='confirmed' and d.channel='email';") == 'sent', 'Email went out through the same run')


def unconfigured(stack, stub):
    """With no service account, push rows are marked skipped, and nothing reaches FCM."""
    _, ts = stack.user('patient', 'scheduler', name='Push Sol Quiet')
    _, tt = stack.user('patient', 'therapist', name='Push Tess Quiet')
    tess = stack.sql("select id from public.profiles where display_name='Push Tess Quiet';")
    ana, ta = stack.user('patient', name='Push Ana Quiet')
    assert stack.rpc('register_device', {'p_token': name('good'), 'p_platform': 'android'}, ta)[0] == 204
    code, booking = stack.rpc('request_booking', {'p_request': str(uuid.uuid4()), 'p_starts': manila(next(working_days(stack, 7)), 14)}, ta)
    assert code == 200, booking
    assert stack.rpc('scheduler_confirm', {'p_booking': booking['id'], 'p_therapist': tess}, ts)[0] == 200
    code, result = dispatch()
    assert code == 200, result
    found = stack.sql(f"select d.status||'|'||d.attempts||'|'||coalesce(d.last_error,'') from public.notification_deliveries d join public.notifications n on n.id=d.notification_id where n.booking_id='{booking['id']}' and n.user_id='{ana}' and n.kind='confirmed' and d.channel='push';")
    stack.check(found == 'skipped|0|FCM_SERVICE_ACCOUNT is not set', 'With no service account a push is marked skipped, with the reason')
    stack.check(result['push']['skipped'] >= 1 and result['push']['claimed'] == 0, 'The run reports it')
    stack.check(stub.sends == [] and stub.tokens == [], 'And nothing reaches FCM')
    stack.check(stack.sql(f"select d.status from public.notification_deliveries d join public.notifications n on n.id=d.notification_id where n.booking_id='{booking['id']}' and n.user_id='{ana}' and n.kind='confirmed' and d.channel='email';") == 'sent', 'Email carries on as before')


def main():
    stack = Stack()
    stub = Stub()
    address = STUB_FROM_RUNTIME.format(port=stub.port)
    account = {'type': 'service_account', 'project_id': PROJECT, 'client_email': f'push@{PROJECT}.iam.gserviceaccount.com', 'private_key': PEM, 'token_uri': f'{address}/token'}
    try:
        with Functions():
            unconfigured(stack, stub)
        with Functions({'FCM_SERVICE_ACCOUNT': "'" + json.dumps(account) + "'", 'FCM_API_URL': address}):
            found = subprocess.run(['docker', 'exec', 'supabase_edge_runtime_motivance', 'printenv', 'FCM_API_URL'], capture_output=True, text=True).stdout.strip()
            if found != address:
                raise SystemExit(f'Refusing to run: the function would send to {found!r}, not the stub')
            checks(stack, stub)
        REPORT.write_text(json.dumps({'generated_at': datetime.now(timezone.utc).isoformat(), 'checks_passed': len(stack.checks), 'checks': stack.checks,
                                      'environment': 'real local Auth, PostgREST and Edge Functions with a stub FCM server and disposable synthetic accounts'}, indent=2) + '\n', encoding='utf-8')
        print(f'{len(stack.checks)} checks passed.')
    finally:
        stub.close()
        stack.clean()


if __name__ == '__main__':
    main()
