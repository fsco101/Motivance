"""Exercise profile photos in Supabase Storage through real local Auth, PostgREST and Storage with disposable users.

Covers where an upload may go, the bucket's size and type limits, saving only a stored file that was issued to the caller,
the public address, that nobody can list, replace or delete files, who can read the stored path, moderation, the hourly
limit, and the cleanup script removing replaced files. Results are written to
docs/validation/profile-photo-backend-results.json.
"""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import cleanup_profile_photos  # noqa: E402

# Stand-in file bytes. Storage checks only the declared type and the size, never the content.
WEBP = b'RIFF\x1a\x00\x00\x00WEBPVP8L' + bytes(18)


def main():
    raw = subprocess.run(['npx.cmd' if os.name == 'nt' else 'npx', '--yes', 'supabase@2.20.12', 'status', '-o', 'json'], cwd=ROOT, capture_output=True, text=True, check=True)
    config = json.loads(raw.stdout)
    base = config['API_URL'].rstrip('/')
    assert base in ('http://127.0.0.1:54321', 'http://localhost:54321'), 'Disposable local fixtures only'
    service = config['SERVICE_ROLE_KEY']
    users = []; checks = []

    def sql(statement):
        p = subprocess.run(['docker', 'exec', '-i', 'supabase_db_motivance', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], input=statement, capture_output=True, text=True)
        if p.returncode: raise RuntimeError('SQL failed: ' + p.stderr[:300])
        return p.stdout.strip()

    def request(path, body=None, token=None, privileged=False, method=None, headers=None, raw_body=None):
        key = service if privileged else config['ANON_KEY']
        sent = {'apikey': key}
        if raw_body is None: sent['Content-Type'] = 'application/json'
        if token or privileged: sent['Authorization'] = 'Bearer ' + (token or key)
        sent.update(headers or {})
        data = raw_body if raw_body is not None else (json.dumps(body).encode() if body is not None else None)
        r = urllib.request.Request(base + path, data=data, headers=sent, method=method or ('POST' if data is not None else 'GET'))
        try:
            with urllib.request.urlopen(r, timeout=20) as response:
                content = response.read()
                kind = response.headers.get('Content-Type', '')
                return response.status, (json.loads(content) if content and 'json' in kind else content)
        except urllib.error.HTTPError as e:
            return e.code, e.read()

    def rpc(name, body, token=None): return request('/rest/v1/rpc/' + name, body, token)

    def store(path, token, data=WEBP, mime='image/webp', upsert=False):
        return request('/storage/v1/object/avatars/' + path, token=token, raw_body=data, method='POST',
                       headers={'Content-Type': mime, 'x-upsert': 'true' if upsert else 'false'})[0]

    def public(path): return request('/storage/v1/object/public/avatars/' + path, method='GET')

    def check(condition, name):
        if not condition: raise AssertionError(name)
        checks.append(name); print('PASS ' + name, flush=True)

    def user(role='patient'):
        email = 'photo-' + uuid.uuid4().hex + '@example.test'; password = uuid.uuid4().hex + 'Aa!9'
        status, created = request('/auth/v1/admin/users', {'email': email, 'password': password, 'email_confirm': True}, privileged=True); assert status == 200
        uid = str(uuid.UUID(created['id'])); users.append(uid)
        if role != 'patient': sql(f"insert into public.user_roles(user_id,role) values('{uid}','{role}');")
        status, session = request('/auth/v1/token?grant_type=password', {'email': email, 'password': password}); assert status == 200
        return uid, session['access_token']

    try:
        patient, tp = user(); other, to = user(); therapist, tt = user('therapist'); admin, ta = user('admin')
        check(sql("select public::text||' '||file_size_limit||' '||array_to_string(allowed_mime_types,',') from storage.buckets where id='avatars';") == 'true 102400 image/webp,image/jpeg',
              'The avatars bucket is public, limited to 100 KB, and takes only WebP and JPEG')
        check(rpc('start_profile_photo', {})[0] >= 400, 'Anonymous cannot ask for an upload place')
        check(rpc('set_my_profile_photo', {'p_path': 'x'})[0] >= 400, 'Anonymous cannot save a photo')
        check(rpc('start_profile_photo', {'p_mime': 'image/png'}, tp)[0] >= 400, 'Only WebP and JPEG places are issued')
        code, ticket = rpc('start_profile_photo', {'p_mime': 'image/webp'}, tp)
        check(code == 200 and ticket['bucket'] == 'avatars' and ticket['limit'] == 102400, 'An active user gets an upload place and the limit')
        path = ticket['path']
        check(re.fullmatch(rf'{patient}/[0-9a-f]{{32}}\.webp', path) is not None, 'The place is chosen by the server inside the caller\'s folder')
        check(rpc('start_profile_photo', {'p_mime': 'image/jpeg'}, tp)[1]['path'].endswith('.jpg'), 'A JPEG place ends in .jpg')

        check(rpc('set_my_profile_photo', {'p_path': path}, tp)[0] >= 400, 'A place with no stored file cannot be saved')
        check(store(path, to) >= 400, 'Another account cannot store a file in someone\'s place')
        check(store(f'{patient}/{uuid.uuid4().hex}.webp', tp) >= 400, 'A place the server did not issue cannot be used')
        check(store(path, tp, b'\0' * 102401) >= 400, 'The bucket refuses a file over 100 KB')
        check(store(path, tp, mime='image/png') >= 400, 'The bucket refuses other image types')
        check(store(path, tp) == 200, 'The owner stores the photo in the issued place')
        check(store(path, tp, upsert=True) >= 400, 'A stored photo cannot be replaced')
        code, body = public(path)
        check(code == 200 and body == WEBP, 'The photo is readable at its public address without signing in')
        code, listed = request('/storage/v1/object/list/avatars', {'prefix': patient + '/', 'limit': 100}, tp)
        check(code >= 400 or listed == [], 'Nobody can list the bucket, the owner included')
        request('/storage/v1/object/avatars', {'prefixes': [path]}, tp, method='DELETE')
        check(public(path)[0] == 200, 'Nobody can delete a photo file through the app session')

        check(rpc('set_my_profile_photo', {'p_path': path}, to)[0] >= 400, 'Another account cannot claim the upload')
        check(sql(f"select photo_url is null from public.profiles where id='{patient}';") == 't', 'Rejected attempts leave no photo')
        code, saved = rpc('set_my_profile_photo', {'p_path': path}, tp)
        check(code == 200 and saved == path, 'A stored, issued file is saved as the photo path')
        check(rpc('set_my_profile_photo', {'p_path': path}, tp)[0] >= 400, 'An upload cannot be applied twice')
        check(sql(f"select bytes from public.profile_photo_uploads where path='{path}';") == str(len(WEBP)), 'The stored size is recorded')

        code, rows = request(f'/rest/v1/profiles?select=photo_url&id=eq.{patient}', token=tp)
        check(code == 200 and rows == [{'photo_url': path}], 'The owner reads their photo path')
        check(request(f'/rest/v1/profiles?select=photo_url&id=eq.{patient}', token=to)[1] == [], 'An unrelated patient cannot read the path')
        check(request(f'/rest/v1/profiles?select=photo_url&id=eq.{patient}', token=tt)[1] == [], 'An unlinked therapist cannot read the path')
        sql(f"insert into public.therapist_patients(therapist_id,patient_id,active) values('{therapist}','{patient}',true);")
        code, rows = request('/rest/v1/patients?select=id,profiles:profiles!patients_id_fkey(display_name,photo_url)&id=eq.' + patient, token=tt)
        check(code == 200 and rows and rows[0]['profiles']['photo_url'] == path, 'A linked therapist reads the path through the patient list')
        request(f'/rest/v1/profiles?id=eq.{patient}', {'photo_url': None}, tp, method='PATCH')
        check(sql(f"select photo_url from public.profiles where id='{patient}';") == path, 'The owner cannot write the photo column directly')
        try:
            sql(f"update public.profiles set photo_url='https://res.cloudinary.com/x/image/upload/v1/a' where id='{patient}';"); constrained = False
        except RuntimeError as error:
            constrained = 'violates check constraint' in str(error)
        check(constrained, 'Only Motivance photo paths can be stored, even by the database owner')

        _, second = rpc('start_profile_photo', {}, tp)
        check(second['path'].endswith('.webp'), 'WebP is the default type')
        store(second['path'], tp)
        check(rpc('set_my_profile_photo', {'p_path': second['path']}, tp)[1] == second['path'], 'A new photo replaces the old one')
        check(sql(f"select retired_at is not null from public.profile_photo_uploads where path='{path}';") == 't', 'The replaced photo is marked for removal')

        code, accounts = rpc('admin_accounts', {'p_search': str(patient)}, ta)
        check(code == 200 and accounts[0]['photo_url'] == second['path'], 'The administrator directory includes the photo')
        check(rpc('admin_clear_photo', {'p_user': patient}, tt)[0] >= 400, 'A therapist cannot use photo moderation')
        check(rpc('admin_clear_photo', {'p_user': patient}, ta)[0] in (200, 204), 'An administrator removes a photo')
        check(sql(f"select photo_url is null from public.profiles where id='{patient}';") == 't', 'The moderated photo is cleared')
        check(sql(f"select count(*) from public.audit_events where actor_id='{admin}' and action='remove_photo' and target_id='{patient}';") == '1', 'Moderation is audited with the administrator as actor')

        _, third = rpc('start_profile_photo', {}, to)
        store(third['path'], to); rpc('set_my_profile_photo', {'p_path': third['path']}, to)
        check(rpc('clear_my_profile_photo', {}, to)[0] in (200, 204) and sql(f"select photo_url is null from public.profiles where id='{other}';") == 't', 'The owner removes their own photo')
        statuses = [rpc('start_profile_photo', {}, to)[0] for _ in range(10)]
        check(statuses[:9] == [200] * 9 and statuses[9] == 429, 'Upload places are limited to ten an hour')
        check(sql(f"select count(*) from public.audit_events where actor_id='{patient}' and action='update_photo';") == '2', 'Photo changes are audited')

        check(rpc('profile_photos_due', {'p_limit': 10}, tp)[0] >= 400, 'Only the service key can list photos due for removal')
        due = cleanup_profile_photos.due(base, service, 1000)
        check({path, second['path'], third['path']} <= set(due), 'Replaced, moderated and removed photos are due for removal')
        cleanup_profile_photos.remove(base, service, [p for p in due if p.split('/')[0] in users])
        left = cleanup_profile_photos.remaining(base, service, [path, second['path'], third['path']])
        check(left == [], 'The cleanup removes the files from Storage')
        cleanup_profile_photos.call(base, service, 'POST', '/rest/v1/rpc/profile_photos_removed', {'p_paths': [path, second['path'], third['path']]})
        check(public(path)[0] >= 400, 'A removed photo is no longer reachable at its address')
        check(not {path, second['path'], third['path']} & set(cleanup_profile_photos.due(base, service, 1000)), 'Removed photos are not tried again')

        report = {'generated_at': datetime.now(timezone.utc).isoformat(), 'checks_passed': len(checks), 'checks': checks,
                  'environment': 'real local Auth, PostgREST and Storage; disposable users',
                  'limitations': ['Image content is not inspected by the server; type and size are enforced from the upload headers and the bucket.']}
        (ROOT / 'docs/validation/profile-photo-backend-results.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    finally:
        if users:
            ids = ','.join("'" + str(uuid.UUID(u)) + "'" for u in users)
            left = sql(f"select name from storage.objects where bucket_id='avatars' and split_part(name,'/',1) in ({ids});").splitlines()
            if left: request('/storage/v1/object/avatars', {'prefixes': left}, privileged=True, method='DELETE')
            sql(f"""begin; set local session_replication_role=replica;
delete from public.profile_photo_uploads where user_id in ({ids});
delete from public.therapist_patients where therapist_id in ({ids}) or patient_id in ({ids});
delete from public.audit_events where actor_id in ({ids}) or target_id in ({ids});
delete from public.patients where id in ({ids}); delete from public.user_roles where user_id in ({ids});
delete from public.notification_deliveries where notification_id in (select id from public.notifications where user_id in ({ids}) or subject_id in ({ids})); delete from public.notifications where user_id in ({ids}) or subject_id in ({ids}); delete from public.notification_settings where user_id in ({ids}); delete from public.profiles where id in ({ids}); delete from auth.users where id in ({ids}); commit;""")


if __name__ == '__main__': main()
