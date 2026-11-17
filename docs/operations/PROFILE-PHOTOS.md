# Profile photos

Profile photos are stored in Supabase Storage, in the public `avatars` bucket (migration `202611170001_profile_photo_storage.sql`). They replaced the earlier Cloudinary uploads, so photos need no third-party account, no secret and no setup step: they work as soon as the migration is applied.

## How an upload works

1. **Pick.** On Android the system photo picker returns an image, with no storage permission. On the web a file input takes JPEG, PNG or WebP.
2. **Crop.** A dialog shows the picture under a circle, the shape avatars use. The person drags it into place and zooms up to 4×, with pinch or the slider on Android, and with the mouse, a touch pinch, the scroll wheel, the slider or the keyboard (arrows move it, `+` and `-` zoom) on the web. TalkBack offers "Move photo left/right/up/down" actions. Both apps use the same crop rules (`cropSquare` in `ProfilePhoto.kt` and `photo.ts`, covered by matching unit tests).
3. **Shrink.** The kept square is drawn at 384 × 384 px and encoded as WebP at quality 80, then lower (68, 55) until it is under 60 KB. A browser that cannot write WebP (older Safari) uses JPEG instead. A typical photo is 15–35 KB. Re-encoding also removes metadata such as GPS location. The picture is held at no more than about 2048 px on the web, and decoded with downsampling on Android, so a camera photo does not fill memory.
4. **Ask for a place.** The app calls `start_profile_photo(p_mime)`. The server picks the path `<account id>/<32 random hex>.webp` (or `.jpg`) and records it in `profile_photo_uploads`. Each account can ask at most 10 times an hour; the 11th gets HTTP 429 and the app says "Too many uploads in the last hour".
5. **Store.** The app uploads the file to `/storage/v1/object/avatars/<path>` with its own session, without replacing (`x-upsert: false`), and marked cacheable for a year, since a photo's name never changes. A Storage policy allows the insert only for the person the path was issued to, only once, and only within the hour. The bucket refuses anything over 100 KB or that is not WebP or JPEG.
6. **Save.** `set_my_profile_photo(p_path)` checks that the path was issued to the caller, is unused and recent, and that the stored file exists with the type that was agreed and within the size limit. Only then does it save the path in `profiles.photo_url`, retire the previous photo and write an audit event.

`profiles.photo_url` holds the path, not an address. Each app builds the address from its own backend URL (`photoAddress` in `web/src/data/photos.ts`, `avatarAddress` in `PersonAvatar.kt`), because the same file is reached through different hosts: `10.0.2.2` from the emulator, `127.0.0.1` from a browser, or the hosted project. Both refuse anything that is not a Motivance photo path, so a stored value can never make an app fetch somewhere else. A check constraint keeps any other value out of the column.

## Who can see a photo

The bucket is public, as Cloudinary delivery was: anyone holding a photo's address can open it. Addresses carry a 128-bit random name and nobody can list the bucket, the owner included, so a photo is only found through a screen that already shows that person's name. Those screens return the path beside the name (bookings, schedules, the Scheduler's requests and calendar, administrator links and activity, notification subjects and chat conversations, from `202611130001_avatars_everywhere.sql` onward). The `profiles` row itself is readable by the owner, linked therapists and administrators.

Nobody can replace or delete a file through an app session. Administrators can remove another account's photo from the account card in either app; the removal is audited with the administrator as the actor.

## Removing old files

Replacing or removing a photo clears it from the profile at once, but the file stays in the bucket, reachable at its old address, until the cleanup removes it. Run the cleanup regularly, for example daily, and as part of any deletion request:

```powershell
python scripts/cleanup_profile_photos.py --target local --usage   # how much is stored, and what is due
python scripts/cleanup_profile_photos.py --target local --apply   # remove what is due, then mark it
```

Due files are replaced, removed and moderated photos, places issued more than two hours ago that were never used, and, as a safety net, any file in the bucket more than two hours old that is nobody's current photo. Files are removed through the Storage API, then marked `deleted_at`; anything Storage still holds stays due for the next run. For the hosted project use `--target hosted` with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the environment or in ignored `supabase/.env`. The service key must never reach an app.

## Moving from Cloudinary

The migration clears every Cloudinary `photo_url`, drops the Cloudinary ticket table and functions, and deletes the `cloudinary_*` Vault secrets. People see their initials until they choose a new photo. If a Cloudinary account was ever configured for a project, delete its `motivance/avatars` folder in the Cloudinary Media Library, and remove any `CLOUDINARY_*` values from `supabase/.env`; nothing reads them any more. Phones running an older build call the removed Cloudinary functions and see "The photo could not be uploaded" until they update.

## Verification

- `python scripts/test_profile_photos.py` checks the whole flow against the real local Auth, PostgREST and Storage with disposable users: the bucket's limits, issued places, who may store and save, the public address, that nobody can list, replace or delete, who can read the path, moderation, the hourly limit and the cleanup. Results go to `docs/validation/profile-photo-backend-results.json`.
- Web: `npm test` (crop rules and addresses), `npm run test:contract` (`tests/contract/admin.test.ts`) and `npx playwright test tests/e2e/profile.spec.ts`, which crops with the mouse and the keyboard and reads the stored 384 px photo back.
- Android: `ProfilePhotoTest`, `ProfilePhotoRepositoryTest` and `PersonAvatarTest`.
