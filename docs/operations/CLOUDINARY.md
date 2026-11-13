# Cloudinary profile photos

Profile photos replace the earlier person, star and heart icon choice. The app uploads them directly to Cloudinary using **signed uploads**. The signature is issued by the database, so the Cloudinary API secret is kept in Supabase Vault and never appears in `android/.env`, the APK or Git.

## How an upload works

1. On the phone, the system photo picker returns an image. No storage permission is requested. The app rotates it upright, centre-crops it to a 512 px square and re-encodes it as JPEG. Re-encoding also removes metadata such as GPS location.
2. The app calls `profile_photo_upload()` with the signed-in JWT. The database reads the Cloudinary settings from Vault and chooses an unguessable public ID, `motivance/avatars/<account id>/<random>`. It returns the cloud name, public API key, timestamp and a SHA-1 signature, but never the secret. Each account can request at most 10 tickets per hour. Without configuration the call returns HTTP 503, and the app shows "Photo uploads are not available yet".
3. The app posts the JPEG to `https://api.cloudinary.com/v1_1/<cloud>/image/upload` with those values. The Supabase session is not sent to Cloudinary.
4. The app sends Cloudinary's response (`public_id`, `version`, `signature`) to `set_my_profile_photo()`. The database checks that the ticket belongs to the caller, is unused and was issued within the last hour. It then verifies the response signature with the secret (SHA-1, or SHA-256 for accounts configured that way) before saving `profiles.photo_url`. A client therefore cannot attach an arbitrary URL or another person's upload.

Photos are displayed as Cloudinary-transformed thumbnails (`c_fill,g_face,…,f_jpg`) and loaded through the app's existing HTTP client. The app only fetches URLs that match the Motivance avatar pattern. Readers are the owner, linked therapists and administrators, under the existing `profiles` row policy. Beyond that, a photo travels with a name: every function that returns a person's name to a screen also returns their photo beside it (bookings, schedules, the Scheduler's requests and calendar, administrator links and activity, and the subject of a notification, from `202611130001_avatars_everywhere.sql`). Nobody can look up a photo except through a screen that already shows that name. Administrators can remove a photo from the account card. The removal is audited with the administrator as the actor.

## Setup

1. Create or open a Cloudinary account. In **Settings → API Keys**, copy the **API environment variable**, `cloudinary://<api_key>:<api_secret>@<cloud_name>`.
2. Add it to the ignored backend file `supabase/.env` (template: `supabase/.env.example`):

   ```dotenv
   CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>
   ```

   You can use `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET` instead. Do not put any of these in `android/.env`, chat or issues.
3. Apply migrations (`npx --yes supabase@2.20.12 migration up --local`), then preview, verify and store:

   ```powershell
   python scripts/configure_cloudinary.py --target local                    # preview only
   python scripts/configure_cloudinary.py --target local --check --apply    # ping Cloudinary, then write Vault
   ```

   For hosted Supabase, also set `SUPABASE_PROJECT_REF` and `SUPABASE_ACCESS_TOKEN` in `supabase/.env`, apply the migrations to that project, and run with `--target hosted`. The script writes `cloudinary_cloud_name`, `cloudinary_api_key` and `cloudinary_api_secret` Vault secrets, updating existing ones in place. Its output names the cloud but never the key or secret.
4. No app rebuild is needed. Uploads start working as soon as Vault holds the values.

Recommended Cloudinary settings:
- Leave unsigned upload presets unused. The app only uses signed uploads.
- If **Strict transformations** is enabled, allow the avatar thumbnails (`c_fill,g_face,w_96|192|384,h_96|192|384,q_auto,f_jpg`) as named or allowed transformations. Otherwise thumbnails will fail to load and initials will be shown instead.

To rotate the secret, regenerate it in Cloudinary, update `supabase/.env` and run the script again with `--apply`.

## Removing old photos

Replacing or removing a photo clears it from the profile immediately. The file stays in Cloudinary until cleanup deletes it, and anyone who already has its URL can still open it until then. Run the cleanup regularly, for example daily:

```powershell
python scripts/cleanup_profile_photos.py --target local            # count candidates
python scripts/cleanup_profile_photos.py --target local --apply    # destroy with CDN invalidation, then mark deleted
```

Candidates are replaced or removed photos, plus upload tickets more than two hours old that were never completed. Failed deletions stay queued for the next run. Use `--target hosted` with the same `supabase/.env` values for the hosted project.

## Verification

- `python scripts/test_profile_photos.py` checks ticket issuance, signature maths, verification, ownership, rate limiting, RLS visibility and moderation against the real local Auth/PostgREST. It uses temporary Vault fixture secrets when none are configured, and does not contact Cloudinary.
- `python -m unittest discover -s scripts -p "test_configure_*.py"` covers configuration parsing, redaction, hosted/local application and signed cleanup without network access.
- A live upload against a real Cloudinary account is listed in `docs/validation/POST-IMPLEMENTATION-CHECKLIST.md`.
