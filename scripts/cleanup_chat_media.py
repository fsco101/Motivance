"""Remove chat photos and videos from Supabase Storage once they are due. Dry run by default.

Due means: sent more than 15 days ago (or taken back by the sender), started more than an hour ago and never sent, or left
behind when their messages were erased. The server stops issuing links to an expired file at once; this removes the file
itself, which only the Storage API can do. Each removed file is then marked in the database, so it is not tried again.
Run it on a schedule, for example daily. It needs the project's service key, which must never reach an app.

  python scripts/cleanup_chat_media.py --target local            # count what is due
  python scripts/cleanup_chat_media.py --target local --apply    # remove it and mark it
  python scripts/cleanup_chat_media.py --target hosted --apply   # needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY

For hosted, put SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment or in supabase/.env (which is ignored by Git).
`--usage` prints how many chat files are stored and how much space they take.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BUCKET = 'chat-media'
# conversation/attachment/media.ext or preview.jpg: anything else is never sent to the delete call.
PATH = re.compile(r'[0-9a-f-]{36}/[0-9a-f-]{36}/(media\.(jpg|webp|mp4|webm)|preview\.jpg)')


class ConfigurationError(Exception):
    pass


def local_settings():
    try:
        raw = subprocess.run('npx --yes supabase@2.20.12 status -o json', cwd=ROOT, shell=True, capture_output=True, text=True, timeout=120).stdout
        status = json.loads(raw)
    except (subprocess.SubprocessError, json.JSONDecodeError) as error:
        raise ConfigurationError('The local stack is not running. Start it with npx supabase start.') from error
    url = status.get('API_URL', '')
    if not re.match(r'^http://(127\.0\.0\.1|localhost):54321', url):
        raise ConfigurationError('The local stack must be on port 54321.')
    return url, status['SERVICE_ROLE_KEY']


def hosted_settings(env_file):
    values = dict(os.environ)
    if env_file.exists():
        for line in env_file.read_text(encoding='utf-8').splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                key, value = line.split('=', 1)
                values.setdefault(key.strip(), value.strip().strip('"'))
    url, key = values.get('SUPABASE_URL', ''), values.get('SUPABASE_SERVICE_ROLE_KEY', '')
    if not url.startswith('https://') or not key:
        raise ConfigurationError('Set SUPABASE_URL (https) and SUPABASE_SERVICE_ROLE_KEY in the environment or in ' + str(env_file))
    return url.rstrip('/'), key


def call(url, key, method, path, body=None):
    request = urllib.request.Request(url + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                     headers={'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=60) as response:
        raw = response.read()
        return json.loads(raw) if raw else None


def due(url, key, limit):
    paths = call(url, key, 'POST', '/rest/v1/rpc/chat_media_due', {'p_limit': limit}) or []
    return [p for p in paths if PATH.fullmatch(p)]


def remove(url, key, paths):
    """Asks Storage to remove the files. A file that is already gone is simply not mentioned in the answer."""
    call(url, key, 'DELETE', f'/storage/v1/object/{BUCKET}', {'prefixes': paths})


def remaining(url, key, paths):
    """Which of these files Storage still holds, read folder by folder, so only what is really gone is marked."""
    held = set()
    for folder in sorted({p.rsplit('/', 1)[0] for p in paths}):
        for item in call(url, key, 'POST', f'/storage/v1/object/list/{BUCKET}', {'prefix': folder + '/', 'limit': 100}) or []:
            held.add(folder + '/' + item['name'])
    return [p for p in paths if p in held]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--target', choices=['local', 'hosted'], required=True)
    parser.add_argument('--env-file', type=Path, default=ROOT / 'supabase/.env')
    parser.add_argument('--limit', type=int, default=200)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--usage', action='store_true')
    args = parser.parse_args(argv)
    try:
        url, key = local_settings() if args.target == 'local' else hosted_settings(args.env_file)
        if args.usage:
            usage = call(url, key, 'POST', '/rest/v1/rpc/chat_media_usage', {})
            print(f"{usage['files']} chat file(s) stored, {usage['bytes'] / 1_048_576:.1f} MB.")
        found = due(url, key, max(1, min(args.limit, 1000)))
        print(f'{len(found)} chat file(s) due for removal.')
        if not args.apply or not found:
            if found:
                print('Dry run: nothing removed. Add --apply to remove them.')
            return 0
        remove(url, key, found)
        left = set(remaining(url, key, found))
        gone = [p for p in found if p not in left]
        if gone:
            call(url, key, 'POST', '/rest/v1/rpc/chat_media_removed', {'p_paths': gone})
        print(f'Removed and marked {len(gone)} of {len(found)}; anything left stays due for the next run.')
        return 0 if not left else 1
    except ConfigurationError as error:
        print('Configuration error: ' + str(error), file=sys.stderr)
        return 2
    except urllib.error.HTTPError as error:
        print(f'Request failed: {error.code} {error.read().decode(errors="replace")[:300]}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
