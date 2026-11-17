"""Remove replaced, removed and abandoned profile photos from Supabase Storage. Dry run by default.

Due means: a photo that was replaced, removed by its owner or removed by an administrator; a place issued more than two
hours ago that never became a photo; and, as a safety net, any file in the `avatars` bucket more than two hours old that is
nobody's current photo. Each removed file is then marked in the database, so it is not tried again. A cleared photo leaves
the profile at once, but its file stays reachable at its address until this runs, so run it on a schedule, for example
daily, and as part of any deletion request. It needs the project's service key, which must never reach an app.

  python scripts/cleanup_profile_photos.py --target local            # count what is due
  python scripts/cleanup_profile_photos.py --target local --apply    # remove it and mark it
  python scripts/cleanup_profile_photos.py --target hosted --apply   # needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY

For hosted, put SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment or in supabase/.env (which is ignored by Git).
`--usage` prints how many photos are stored and how much space they take.
"""
import argparse
from pathlib import Path
import re
import sys
import urllib.error

from cleanup_chat_media import ConfigurationError, ROOT, call, hosted_settings, local_settings

BUCKET = 'avatars'
# account/random.webp or .jpg: anything else is never sent to the delete call.
PATH = re.compile(r'[0-9a-f-]{36}/[0-9a-f]{32}\.(webp|jpg)')


def due(url, key, limit):
    paths = call(url, key, 'POST', '/rest/v1/rpc/profile_photos_due', {'p_limit': limit}) or []
    return [p for p in paths if PATH.fullmatch(p)]


def remove(url, key, paths):
    """Asks Storage to remove the files. A file that is already gone is simply not mentioned in the answer."""
    call(url, key, 'DELETE', f'/storage/v1/object/{BUCKET}', {'prefixes': paths})


def remaining(url, key, paths):
    """Which of these files Storage still holds, read folder by folder, so only what is really gone is marked."""
    held = set()
    for folder in sorted({p.rsplit('/', 1)[0] for p in paths}):
        offset = 0
        while True:
            page = call(url, key, 'POST', f'/storage/v1/object/list/{BUCKET}', {'prefix': folder + '/', 'limit': 100, 'offset': offset}) or []
            held.update(folder + '/' + item['name'] for item in page)
            if len(page) < 100:
                break
            offset += 100
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
            usage = call(url, key, 'POST', '/rest/v1/rpc/profile_photo_usage', {})
            print(f"{usage['files']} profile photo file(s) stored, {usage['bytes'] / 1024:.0f} KB.")
        found = due(url, key, max(1, min(args.limit, 1000)))
        print(f'{len(found)} profile photo file(s) due for removal.')
        if not args.apply or not found:
            if found:
                print('Dry run: nothing removed. Add --apply to remove them.')
            return 0
        remove(url, key, found)
        left = set(remaining(url, key, found))
        gone = [p for p in found if p not in left]
        if gone:
            call(url, key, 'POST', '/rest/v1/rpc/profile_photos_removed', {'p_paths': gone})
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
