# Profile photo uploads (Cloudinary)

Engineering review: Claude Code, 2026-11-04. Profile photos replace the bundled person/star/heart avatar choice. Operations and setup are described in [CLOUDINARY.md](../operations/CLOUDINARY.md). No live Cloudinary account was used. Cloudinary responses were simulated, so a live upload remains a [checklist](POST-IMPLEMENTATION-CHECKLIST.md) item.

## Delivered behavior

- **Profile** shows a photo card with the photo or initials. It has Upload/Change through the system photo picker (no storage permission), upload progress and a confirmed Remove. Errors are specific: not configured (HTTP 503), more than 10 uploads per hour (HTTP 429), unreadable image, and network/other failures. A just-in-time notice states that photos are cropped, have location data removed on the phone, and are stored with Cloudinary. Changing the photo does not discard a profile edit in progress.
- **Signup** no longer shows avatar tiles or an avatar review row. It notes that a photo can be added from Profile after email confirmation, because signup runs before a session exists.
- **Avatars** everywhere (Profile header, profile summary, therapist patient list, assignment header, administrator directory) use one `PersonAvatar` component. It shows a face-cropped Cloudinary thumbnail or initials, fetches only URLs that match the Motivance avatar pattern, and caches decoded thumbnails in memory.
- **Administrators** can remove another account's photo. The removal is confirmed and audited, and the activity feed labels photo and profile updates.
- **On-device preparation** decodes with downsampling, applies the EXIF orientation, centre-crops, scales to 512 px and re-encodes as JPEG at quality 85, which discards the original metadata.

## Backend

Migration `202611040002_profile_photos.sql` adds:
- `profiles.photo_url`: client-readable under the existing policy, with no client update grant, and constrained to the Motivance avatar URL pattern.
- `profile_photo_uploads`: RLS-locked and used for tickets, rate limiting and cleanup.
- Vault-backed `cloudinary_setting()`, plus `profile_photo_upload()`, `set_my_profile_photo()`, `clear_my_profile_photo()` and `admin_clear_photo()`.
- `photo_url` in `admin_accounts()`.

The legacy `patient_profiles.avatar` column becomes nullable, and existing values are retained. Configuration and cleanup run through `scripts/configure_cloudinary.py` and `scripts/cleanup_profile_photos.py`.

## Executed evidence

| Check | Result |
|---|---|
| `python scripts/test_profile_photos.py` (real local Auth/PostgREST, disposable users, temporary Vault fixtures) | 28 checks passed: unconfigured 503, anonymous denial, ticket contents without the secret, server-chosen folder, request-signature maths, forged and cross-user claims rejected, SHA-1/SHA-256 response verification, single use, owner/linked-therapist reads, unrelated and unlinked denial, no direct write, retirement on replacement, admin directory photo, moderation by admin only with audit, owner removal, 10-per-hour limit |
| `python scripts/test_patient_profiles.py` and `python scripts/test_administration.py` | 36 and 76 checks passed. The profile write and redefined `admin_accounts` remain compatible |
| `python scripts/verify_backend_migrations.py` | Fresh replay of all migrations, seed and 18 SQL tests passed |
| Script tests (`test_configure_cloudinary.py`) | 9 passed: `CLOUDINARY_URL` parsing, injection rejection, redacted preview, Vault create/update SQL, hosted Management API request, ping check, signed destroy with invalidation, partial-failure handling |
| `configure_cloudinary.py --apply` against local Vault | Create and in-place update verified with fixture values, then removed |
| App and domain JVM tests | 97 passed. New: repository upload flow (multipart fields, no session to Cloudinary, no secret, verification payload, 503 short-circuit, mismatched response not saved, size limits), thumbnail URL allow-listing, crop/sample/EXIF maths, ViewModel photo flow and error mapping |
| Pixel 6 AVD instrumented tests | `ProfilePhotoPreparationTest` 3/3 passed, with real decoding of a rotated, GPS-tagged JPEG: upright 512×512 output, marker moved as expected, GPS removed, non-images rejected. `PatientProfileTest` 6/6, `AuthScreenTest` 8/8 and `AdministrationScreenTest` 3/3 passed. `PatientProfileTest` had one intermittent `assertExists` failure on its first run after install, which did not reproduce in three consecutive reruns |
| Emulator visual review | The photo card was reviewed with initials and with the not-configured error, using a temporary harness that was then removed |
| Android lint | Zero errors. One new advisory recommends `androidx.exifinterface` over the framework `ExifInterface`; it was not adopted, to avoid a new dependency |
| Resources | 684 strings per locale; parity passed |

## Limitations

- Delivery uses Cloudinary's public `upload` type with unguessable public IDs. A URL that has been shared stays viewable until cleanup deletes the asset. Fully access-controlled delivery would require Cloudinary authenticated assets and server-signed delivery URLs.
- A live Cloudinary upload, display and cleanup have not been executed.
- The privacy agreement text (`system-purpose-v1`) is unchanged. Whether it needs a new version naming Cloudinary is a deployment-owner decision recorded in the checklist.
- Photos cannot be chosen during signup.
