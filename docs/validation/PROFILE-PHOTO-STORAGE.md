# Profile photos in Supabase Storage, with cropping

Engineering review: Claude Code, 2026-11-17. Operations: [PROFILE-PHOTOS.md](../operations/PROFILE-PHOTOS.md). This replaces the Cloudinary version recorded in [PROFILE-PHOTOS.md](PROFILE-PHOTOS.md).

## Delivered behavior

- **Storage instead of Cloudinary.** Migration `202611170001_profile_photo_storage.sql` adds the public `avatars` bucket (100 KB, WebP or JPEG only), an insert-only Storage policy for the person a path was issued to, `start_profile_photo(p_mime)` and `set_my_profile_photo(p_path)`, and service-key cleanup functions. It drops the Cloudinary ticket table, the signing functions and the Vault secrets, and clears Cloudinary photo addresses. `profiles.photo_url` now holds a path, checked by a constraint.
- **Cropping on both apps.** After picking a picture, a dialog shows it under the avatar circle. Web: drag, touch pinch, scroll wheel, zoom slider, arrow keys and `+`/`-`. Android: drag, pinch, zoom slider and TalkBack "Move photo" actions. Cancel stores nothing. Both apps share the same crop rules and test cases.
- **Small uploads.** The crop is drawn at 384 × 384 px and encoded as WebP (JPEG where a browser cannot write WebP), lowering quality until it is under 60 KB. The previous version sent a 512 px JPEG of up to 2 MB.
- **Addresses.** Each app builds the address from its own backend URL and refuses anything that is not a photo path (`photoAddress` on the web, `avatarAddress` on Android). Android no longer asks Cloudinary for resized thumbnails; one file serves every avatar size.
- **Cleanup.** `scripts/cleanup_profile_photos.py` removes replaced, removed, moderated and abandoned files through the Storage API, plus any stray file in the bucket. `scripts/configure_cloudinary.py` and its test are removed.
- **Administrator parity.** No administrator feature changed. Administrators still remove a photo from the account card in both apps.

## Executed tests

| Check | Result |
| --- | --- |
| `python scripts/test_profile_photos.py` against real local Auth, PostgREST and Storage | 44 checks passed; see `profile-photo-backend-results.json` |
| `python scripts/verify_backend_migrations.py` (all migrations replayed on a fresh database) | Passed, after teaching the verifier to copy the `storage` schema, which the earlier chat-media bucket also needed |
| `supabase test db` | 99 pgTAP tests passed |
| Web `npm run typecheck`, `npm run lint`, `npm test` | Clean; 303 unit tests passed, including the crop rules and photo addresses |
| Web `tests/contract/admin.test.ts` | 16 passed, including a real Storage upload and the size and type refusals |
| Web `tests/e2e/profile.spec.ts`, one worker | 14 passed. The browser crops a red-and-blue picture by mouse drag and by keyboard, and the test reads the stored 384 px photo back to confirm which half was kept, its type and that it is under 60 KB |
| Android `:app:assembleDebug :app:lintDebug :app:testDebugUnitTest :core:domain:test :core:assessment:test` | Passed; 437 unit tests, including `ProfilePhotoTest`, `ProfilePhotoRepositoryTest` and `PersonAvatarTest` |
| `scripts/check_admin_parity.py`, `test_admin_parity.py`, `check_module_boundaries.py`, `check_resources.py` | Passed |
| `scripts/test_care_notifications.py` | Its photo checks passed. It then stops at an unrelated, older expectation: notification settings now include the `messages` switch from `202611150004_chat_notifications.sql` |

## Not executed

- The Android crop dialog has not been seen on a screen: no emulator was started, because the machine had too little free memory with the local stack running. Its gestures, slider and TalkBack actions are listed in the [follow-up checklist](POST-IMPLEMENTATION-CHECKLIST.md), with the physical-phone upload.
- The migration has not been applied to the hosted project, and no hosted cleanup has run.
- Browsers other than Chromium were not tested. Safari's JPEG fallback is listed in the checklist.
- `scripts/check_web_bundle.py` reports the initial JavaScript at 323 KB compressed, over its 300 KB budget. It was 322 KB before this change.
