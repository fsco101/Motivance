# Avatars everywhere, and exercise and care-team notifications

Engineering review: Claude Code, 2026-11-13. Design: [2026-11-13-avatars-and-notifications-design.md](../superpowers/specs/2026-11-13-avatars-and-notifications-design.md). Operations: [NOTIFICATIONS.md](../operations/NOTIFICATIONS.md) and [CLOUDINARY.md](../operations/CLOUDINARY.md).

No Firebase project and no Cloudinary account were used. Push was proven against the local FCM stub and on an emulator, and photos with fixture URLs. A real push to a real phone, and a real photo in the new places, are [follow-up checks](POST-IMPLEMENTATION-CHECKLIST.md#avatars-and-notifications-2026-11-13).

## Delivered behavior

**Faces beside names, in both apps.** Every function that returns a person's name to a screen now returns their photo beside it (`202611130001_avatars_everywhere.sql`): bookings and the patient's schedule (therapist), the therapist's schedule (patient), the Scheduler's requests, request detail and history, calendar impact, time off, patient and therapist pickers, and the administrator links (both people) and activity (actor). The `profiles` read policy is unchanged, so nobody can look up a photo except through a screen that already shows that name. Notifications record their subject, the other person they are about, and the bell reads that person's current name and photo, so a removed photo leaves old notifications too. Existing booking notifications were backfilled.

**New notifications** (`202611130002_care_and_exercise_notifications.sql`), in the bell on both apps and pushed to Android:

| Kind | Reader | Trigger |
| --- | --- | --- |
| `plan_updated` | Patient | A therapist publishes or changes an exercise. A quarter of an hour of publishing is one notification |
| `session_finished` | The plan's therapist, while linked | A session upload, with the repetitions and target |
| `practice_reminder` | Patient with a chosen time and an active plan | Every 5 minutes, in the two hours after the time, if no session started today at the center. Once a day |
| `patient_inactive` | Linked therapist | Every 30 minutes, 08:00 to 20:00 at the center, after 3 quiet days. Once per stretch |
| `care_linked`, `care_unlinked` / `patient_linked`, `patient_unlinked` | Patient / therapist | A link is made, made again or ended. Removing the therapist role sends the former therapist nothing |

Nobody is told what they did themselves. Only booking kinds send email. A trigger failure is logged and never stops the publish, upload or link that caused it.

**Push settings on Android.** Profile has a Notifications card showing the groups for the account's roles (patient: Bookings, Exercise plan, Daily practice reminder, Care team; therapist: Bookings, Finished sessions, Inactive patients, Care team; Scheduler: Bookings; administrator alone: none). Switches start on; the reminder starts off and defaults to 18:00, with a time picker. A switch only decides push: an off switch queues the push as `skipped` with `Turned off`, and the bell still shows it. The card says when the build has no Firebase values, and offers the phone's notification settings when Android has notifications off. Each group has its own Android channel; booking pushes keep the `booking_updates` channel. A practice reminder is not shown if a prescribed session started today is already on the phone, uploaded or not.

**Web.** The bell reads the new kinds in English and Filipino, shows the subject's face, skips kinds it does not know, and opens the matching page. The web has no push and no settings.

**Fixed on the way.** The fresh migration replay (`verify_backend_migrations.py`) had failed since 2026-11-08: it copied an `auth.users` trigger from the local database before its function existed, and it could not create `pg_cron` in a scratch database. It now drops every auth trigger that calls an application function, stands in for `cron.schedule`, and proves each scheduled job's command resolves. Test cleanups in eight scripts and the web test support now also remove notifications about, and settings of, the accounts they delete.

## Executed evidence

| Check | Result |
| --- | --- |
| `python scripts/test_care_notifications.py` (real local Auth/PostgREST, disposable users, no email or FCM) | 62 checks passed: every trigger reaches exactly the right readers, the self-action rule, 15-minute coalescing, repetitions on finished sessions, the role-removal case, reminder window, active plan and exercised-today checks, inactivity once per stretch and again for a new stretch, the daytime window, switches skipping push with the reason while keeping the bell, no email for any new kind, a push for every one, group mapping, settings defaults, validation and access, jobs not callable by people, and photos in admin links, activity, Scheduler searches, requests, detail and history, bookings and booking notifications. [Results](care-notification-test-results.json) |
| Cleanup after that run | 0 orphaned notifications or settings, 0 fixture accounts left |
| `python scripts/test_booking.py notifications` | 50 checks passed |
| `python scripts/test_push.py` (Edge runtime against the local FCM stub) | 30 checks passed |
| `python scripts/test_profile_photos.py` | 28 checks passed |
| `python scripts/verify_backend_migrations.py` | All 35 migrations, the seed and 18 SQL tests passed in a fresh database; all 6 scheduled job commands resolve. [Results](backend-clean-build.json) |
| Web unit tests (`npm test`) | 276 passed in 20 files, including decoding, unknown-kind skipping and routing of the new kinds |
| Web contract tests (`npm run test:contract`, local stack) | 173 passed in 16 files, including 12 new push text cases for the new kinds in both languages |
| Web browser tests (Playwright, one worker, local stack) | 123 passed in the notifications, scheduler, schedule, admin, booking, calendar, confirmed-schedule, series, patient, therapist-caseload, waitlist, reschedule and dashboard specs |
| Web type check, lint, production build, `check_web_bundle.py` | Clean. Initial JavaScript 297 KB of the 300 KB budget (296 KB before) |
| Android JVM tests (`:core:domain:test`, `:app:testDebugUnitTest`) | 93 and 221 passed. New: `NotificationsTest` (10), `PushRulesTest` (7), `NotificationSettingsViewModelTest` (7), and new cases in `BookingRepositoryTest` and `AdministrationRepositoryTest` |
| Android instrumented tests, Pixel 6 AVD, API 35, run with `am instrument` | `PushNotifierTest` 7/7 (2 new: a channel per group, and the general lock-screen title), `NotificationSettingsCardTest` 7/7 (new), `AdministrationScreenTest` and `PatientProfileTest` 11/11 |
| Android lint | No errors. New warnings are plural suggestions on count strings, as elsewhere in the app |
| `check_resources.py`, `check_admin_parity.py`, `check_module_boundaries.py` | 994 strings per language with format parity; all administrator functions in both apps; boundaries clean |

## Limitations

- No real FCM delivery: the Firebase values are empty. The stub proves the request format, and the emulator proves what a delivered message shows.
- No real Cloudinary photo: uploads are not configured, so every avatar shows initials until they are.
- The hosted project has neither migration yet, and the web app is not redeployed. Applying them is the owner's decision, after which the web and a rebuilt Android app should follow.
- The Android app was not driven against the local backend end to end. Its screens were checked through Compose tests with the server stood in for.
- A practice reminder for someone who exercised on another phone today, before it uploaded, can still appear. The server cannot know, and the phone it arrives on has no record of it.
- The Filipino wording is unreviewed.
