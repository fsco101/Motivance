# Plan: avatars everywhere, and exercise and care-team notifications

Spec: [2026-11-13-avatars-and-notifications-design.md](../specs/2026-11-13-avatars-and-notifications-design.md). Each step ends with its checks passing locally. GitHub Actions cannot run, so every check runs on this machine.

## 1. Backend: avatars
- `supabase/migrations/202611130001_avatars_everywhere.sql` makes these changes:
  - It redefines `booking_view`, `schedule_view`, `scheduler_booking_detail`, `scheduler_bookings`, `scheduler_calendar_impact`, `scheduler_patients`, `scheduler_schedule_patients`, `scheduler_therapists`, `scheduler_time_off`, `admin_links` and `admin_activity` with photo fields. Bodies are copied from their latest definitions, with only the photo fields added.
  - It adds `notifications.subject_id`, a before-insert trigger that sets it for booking kinds, and a backfill.
  - It redefines `my_notifications` with `subject_name` and `subject_photo`.
- Apply the migration with `migration up --local`. No reset: the local database holds owner accounts.

## 2. Backend: notifications
- `supabase/migrations/202611130002_care_and_exercise_notifications.sql` adds:
  - the kind check with the eight new kinds;
  - `notification_group(kind)`;
  - `notification_settings` with `my_notification_settings()` and `save_notification_settings(...)`;
  - `notify_person(...)`;
  - triggers on `prescription_versions`, `session_measurements` and `therapist_patients`;
  - `enqueue_practice_reminders()` and `enqueue_inactivity_alerts()`, with pg_cron schedules;
  - the new `queue_notification_email()`;
  - `claim_notification_deliveries()` with `user_id`.
- `supabase/functions/_shared/push_text.ts` holds the push sentences for the new kinds, and `push.ts` uses it.
- `scripts/test_care_notifications.py`, which writes `docs/validation/care-notification-test-results.json`.
- Rerun `test_booking.py notifications`, `test_push.py`, `test_profile_photos.py` and `verify_backend_migrations.py`.

## 3. Web
- Regenerate or hand-update `web/src/data/database.types.ts` for the new and changed functions.
- **Data layer:**
  - `booking.ts`, `schedule.ts`, `scheduler.ts`, `calendar.ts` and `admin.ts` decode the photos.
  - `notifications.ts` gets the new kinds, optional times, the subject fields, skipping of unknown kinds and a `notificationTarget(note, workspace)` helper.
- **Views:**
  - avatars on the screens named in the spec;
  - `NotificationsView` gets a subject avatar and the new text;
  - `pages.tsx` routes rows by kind.
- **Locales:** en and fil text for the new kinds.
- **Checks:** unit tests (`npm test`), the push text contract test, `npm run build`, `python scripts/check_web_bundle.py` and lint.

## 4. Android
- **Domain:** new kinds, optional times and subject fields on `AppNotification`, `notificationGroup(kind)`, `NotificationSettings`, and photo fields on `Booking`, `ScheduleSession`, admin links and activity.
- **Data:**
  - `BookingJson` decodes the new fields.
  - The repository gets `loadNotificationSettings` and `saveNotificationSettings`.
  - `SessionDao` gets a query for sessions started since a time.
- **Push:** a channel per group, practice-reminder suppression in `MotivanceMessagingService`, and channel names in the strings.
- **UI:**
  - avatars in My bookings, the schedules, the notification rows and admin links and activity;
  - per-kind routing from the bell;
  - a `NotificationSettingsCard` and its view model on Profile.
- **Strings:** en and fil. `check_resources.py`.
- **Checks:** JVM tests (`gradlew testDebugUnitTest`) and lint, then the instrumented `PushNotifierTest` on an emulator if memory allows.

## 5. Docs and tracking
- Update `docs/operations/NOTIFICATIONS.md` (new kinds, settings, jobs, troubleshooting), `docs/architecture/DATABASE.md`, `docs/architecture/BOOKING.md` where it lists notifications, `docs/architecture/ADMIN-PARITY.md` and `docs/PLAN.md`.
- Write `docs/validation/AVATARS-AND-NOTIFICATIONS.md` with the executed evidence, and add the deferred real-phone and real-photo checks to `docs/validation/POST-IMPLEMENTATION-CHECKLIST.md`.
- Create one GitHub issue for the feature, record its evidence in it, and close it.
- Hosted rollout (`db push`, function deploy) waits for the owner's go-ahead.
