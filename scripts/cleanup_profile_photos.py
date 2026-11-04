"""Delete replaced, removed or abandoned profile photos from Cloudinary. Dry run by default.

The database records every upload ticket in public.profile_photo_uploads. The candidates are photos that were
replaced or removed (retired_at set) and tickets issued more than two hours ago that were never completed. Each
candidate is destroyed with CDN invalidation and then marked deleted. "Not found" also counts as deleted, because
abandoned tickets may never have produced an asset. Run it after configure_cloudinary.py, using the same
supabase/.env credentials, for example on a daily schedule.

  python scripts/cleanup_profile_photos.py --target local            # list candidate count
  python scripts/cleanup_profile_photos.py --target local --apply    # delete and mark
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import configure_cloudinary as config

PUBLIC_ID=re.compile(r'motivance/avatars/[0-9a-f-]{36}/[0-9a-f]{32}')
CANDIDATES="""select public_id from public.profile_photo_uploads where deleted_at is null
 and (retired_at is not null or (used_at is null and issued_at<now()-interval '2 hours')) order by issued_at limit {limit};"""

def candidates(settings,target,limit):
    result=config.execute(settings,target,CANDIDATES.format(limit=int(limit)))
    rows=result.splitlines() if target=='local' else [r['public_id'] for r in result]
    return [r.strip() for r in rows if PUBLIC_ID.fullmatch(r.strip())]

def destroy(settings,values,public_id):
    """Signed Upload API destroy call. Returns True once Cloudinary no longer holds the asset."""
    timestamp=str(int(time.time()))
    signature=hashlib.sha1(f'invalidate=true&public_id={public_id}&timestamp={timestamp}{values["api_secret"]}'.encode()).hexdigest()
    body=urllib.parse.urlencode({'public_id':public_id,'timestamp':timestamp,'invalidate':'true','api_key':values['api_key'],'signature':signature}).encode()
    request=urllib.request.Request(f"{config.api_base(settings)}/v1_1/{values['cloud_name']}/image/destroy",data=body,method='POST')
    try:
        with urllib.request.urlopen(request,timeout=30) as response:
            return json.loads(response.read() or b'{}').get('result') in ('ok','not found')
    except (urllib.error.HTTPError,urllib.error.URLError):
        return False

def mark_deleted(settings,target,public_ids):
    # Public IDs are validated against PUBLIC_ID, so they are safe inside quoted literals.
    quoted=','.join("'"+p+"'" for p in public_ids if PUBLIC_ID.fullmatch(p))
    if quoted: config.execute(settings,target,f'update public.profile_photo_uploads set deleted_at=now() where public_id in ({quoted});')

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--target',choices=['local','hosted'],required=True)
    parser.add_argument('--env-file',type=Path,default=config.ROOT/'supabase/.env')
    parser.add_argument('--limit',type=int,default=100)
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args(argv)
    try:
        settings=config.load_settings(args.env_file)
        values=config.credentials(settings)
        found=candidates(settings,args.target,max(1,min(args.limit,500)))
        print(f'{len(found)} profile photo(s) awaiting Cloudinary deletion.')
        if not args.apply or not found:
            if found: print('Dry run: nothing deleted. Add --apply to delete them.')
            return 0
        done=[p for p in found if destroy(settings,values,p)]
        mark_deleted(settings,args.target,done)
        print(f'Deleted {len(done)} of {len(found)}; failures stay queued for the next run.')
        return 0 if len(done)==len(found) else 1
    except config.ConfigurationError as e:
        print('Configuration error: '+str(e),file=sys.stderr);return 2

if __name__=='__main__': sys.exit(main())
