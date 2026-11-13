# Avatars everywhere, and exercise and care-team notifications

Date: 2026-11-13. Status: approved by the owner in conversation, implementation requested the same day.

## Intent

1. Wherever a person's name appears, their profile photo appears next to it, in both apps.
2. Push notifications on Android for bookings (already built), exercise plans, finished sessions, a daily practice reminder, inactivity and care-team changes. The web gets the same notifications in its in-app bell only. It has no browser push.

Firebase credentials are not available yet. Everything is built and tested against the local FCM stub, and push starts when the owner creates a Motivance Firebase project and fills in the values described in `docs/operations/NOTIFICATIONS.md`. A real push to a real phone stays in the follow-up checklist.

## Decisions

| Question | Decision |
| --- | --- |
| Who can see a photo | Whoever already sees the person's name on that screen. The `profiles` read policy does not change. Functions that already return a name also return the photo |
| Exercise events | Plan assigned or changed, session finished, daily practice reminder, inactivity alert |
| Other events | Care-team changes (links made, re-activated or ended). Role changes are out |
| Web push | None. The web bell shows every new kind |
| Settings | Per-group push switches and the reminder time, in the Android Profile only |
| Email | Booking kinds only, as today. New kinds are bell and push only |
| Firebase project | A new Motivance project, created later by the owner |
| Approach | Everything goes through the existing `notifications` table and delivery queue |

## Part 1: avatars

### Server

Migration `202611130001_avatars_everywhere.sql` redefines these functions so that each name they return comes with a photo. The photo is `profiles.photo_url`, which is null when there is none:

| Function | Adds |
| --- | --- |
| `booking_view` (and so `my_booking_view`, `my_bookings`, `my_schedule`, `scheduler_calendar_impact`) | `therapist_photo` |
| `schedule_view`, therapist branch | `patient_photo` |
| `scheduler_booking_detail` | `patient_photo`, `actor_photo` per event |
| `scheduler_bookings` | `patient_photo`, `therapist_photo` |
| `scheduler_calendar_impact` | `patient_photo` |
| `scheduler_patients`, `scheduler_schedule_patients`, `scheduler_therapists` | `photo` |
| `scheduler_time_off` | `therapist_photo` |
| `admin_links` | `therapist_photo`, `patient_photo` |
| `admin_activity` | `actor_photo` |

Notifications gain `subject_id`: the other person a notification is about. For a booking kind, a trigger sets it from the booking: the therapist when the reader is the booking's patient, otherwise the patient. New kinds set it directly. Existing rows are backfilled the same way. `my_notifications` adds the subject's current `subject_name` and `subject_photo`, so a removed photo disappears from old notifications too.

### Apps

Both apps put their existing avatar component (Android `PersonAvatar`, web `Avatar`) next to names on these screens:
- the patient's bookings, schedule and home;
- the therapist's schedule;
- the Scheduler's requests, request detail and history, calendar impact, confirmed schedule, weekly series patient picker, therapist picker and time off;
- the notification list;
- the admin links (both people) and activity feed (the actor).

Dense rows use 24–32 px avatars. Exports stay text-only. Until Cloudinary is configured, every avatar shows initials.

The admin links and activity changes are administrator features, so both apps get them in the same change, and `docs/architecture/ADMIN-PARITY.md` records them.

## Part 2: notifications

### New kinds

| Kind | Reader | Fired by | Dedupe key | Subject |
| --- | --- | --- | --- | --- |
| `plan_updated` | Patient | Insert on `prescription_versions` | `plan_updated:<therapist>:<15-minute bucket>`, so a burst of publishes is one notification | Therapist |
| `session_finished` | The assignment's therapist, while the link is active | Insert on `session_measurements`, which `ingest_session` writes in the same transaction as the session | `session_finished:<session>` | Patient |
| `practice_reminder` | Patient with a reminder time and an active plan | `enqueue_practice_reminders()`, every 5 minutes | `practice:<center date>` | none |
| `patient_inactive` | Linked therapist with an active assignment for the patient | `enqueue_inactivity_alerts()`, every 30 minutes, only between 08:00 and 20:00 center time | `inactive:<patient>:<anchor epoch>` | Patient |
| `care_linked` / `care_unlinked` | Patient | Insert, or change of `active`, on `therapist_patients` | `<kind>:<therapist>:<patient>:<transaction time>` | Therapist |
| `patient_linked` / `patient_unlinked` | Therapist | Same trigger. Skipped when the therapist no longer has the therapist role, so removing that role does not send one notification per patient | Same | Patient |

The rule that nobody is told what they did themselves applies to all of these. A patient accepting an invitation tells only the therapist, and a therapist ending a link tells only the patient.

**Data each row carries:**
- `plan_updated`: `therapist_name`.
- `session_finished`: `patient_name`, `completed` and `target` repetitions, `side`.
- `patient_inactive`: `patient_name`, `days`, `last_session_at`.
- Care kinds: `therapist_name`, `patient_name`.

**Inactivity anchor:** the later of the patient's last session and the earliest active assignment between that therapist and patient. An alert is due when the anchor is at least 3 days old. Exercising again, or a new link and plan, moves the anchor, so the next stretch can alert once more.

**Practice reminder:** due when all of these hold:
- the center's local time is at or after `reminder_time` and less than 2 hours past it;
- the patient has an active assignment under an active link;
- no session started today in the center's time zone.

### Settings

A new table `notification_settings(user_id, bookings, exercise_plan, session_results, inactivity, care_team, reminder_time, updated_at)`. A person with no row gets the defaults: every switch on, and no reminder.

| Group (`notification_group(kind)`) | Kinds |
| --- | --- |
| `bookings` | Every booking kind |
| `exercise_plan` | `plan_updated` |
| `session_results` | `session_finished` |
| `inactivity` | `patient_inactive` |
| `care_team` | The four care kinds |
| `practice` | `practice_reminder`, which exists only when a time is set |

`queue_notification_email()` now does two things:
- It queues email only for `bookings`.
- It always queues push. When the reader's switch for that group is off, the push is queued as `skipped` with the reason `Turned off`.

The bell is never affected by switches.

`my_notification_settings()` and `save_notification_settings(...)` read and write the caller's own settings. The reminder time is `HH:MM`, or null for off.

### Delivery

- `claim_notification_deliveries` adds `user_id` to each delivery so that the phone can suppress a practice reminder.
- The dispatcher gets push text for the new kinds in English and Filipino. The text lives in a new `_shared/push_text.ts`. Booking kinds keep using the email sentences.
- The message carries data only. The lock screen still shows only that there is an update.

### Android

- The domain `NotificationKind` gains the new kinds. `AppNotification` makes session times optional, and adds `subjectId`, `subjectName`, `subjectPhoto` and the new facts.
- The bell list shows the subject's avatar. Tapping a row goes to the matching screen:

| Kinds | Opens |
| --- | --- |
| Booking kinds | As today |
| `plan_updated`, `practice_reminder` | Exercises |
| Care kinds for the patient | Home |
| `session_finished`, `patient_inactive`, `patient_linked` | That patient's record, or Patients if it is not in the workspace |
| `patient_unlinked` | Patients |

- **Push channels:** one Android notification channel per group. The existing `booking_updates` channel stays for bookings.
- **Reminder suppression:** before showing a `practice_reminder`, the messaging service checks the local database for a session that this user started today (center time). If one exists, it shows nothing.
- **Settings card:** Profile gets a Notifications card listing the groups for the account's roles:

| Role | Groups |
| --- | --- |
| Patient | Bookings, Exercise plan, Daily reminder with a time picker (defaults to 18:00 when turned on), Care team |
| Therapist | Bookings, Session finished, Inactivity, Care team |
| Scheduler | Bookings |

  An admin-only account sees no card. The card says when this build has no Firebase values, and offers the permission prompt when Android has not granted notifications.

### Web

- `NotificationKind` gains the new kinds.
- Unknown kinds are skipped, as on Android.
- Rows show the subject's avatar.
- Opening a row goes by kind, using the same mapping as Android, with web routes (`/patient/exercises`, `/patient`, `/therapist/patients/:id`, `/therapist/patients`).

## Error handling

- A notification is written in the same transaction as the change that caused it. `notify` already ignores a reader whose profile is gone.
- Triggers never raise. A missing name becomes an empty string rather than blocking a publish, an upload or a link.
- Jobs are idempotent through their dedupe keys. A job that runs twice sends nothing new.
- Disabled accounts still get bell rows but no push, as today.

## Testing

- **`scripts/test_care_notifications.py`** runs on the local stack with disposable accounts and no real email. It checks:
  - each trigger reaches exactly the right readers;
  - the self-action rule;
  - the 15-minute coalescing;
  - session-finished repetitions;
  - removing the therapist role skips the ex-therapist;
  - the reminder window, the active-plan check and the exercised-today check;
  - inactivity once per stretch, and again after a new stretch;
  - switches skipping push but keeping the bell;
  - no email for the new kinds;
  - the subject photo in `my_notifications`;
  - photo fields in the redefined functions;
  - settings validation and ownership.
- **Reruns:** `scripts/test_booking.py notifications`, `scripts/test_push.py`, `scripts/test_profile_photos.py` and `scripts/verify_backend_migrations.py`.
- **Web:** unit tests for decoding, text and routing of the new kinds, plus the push text contract test, `npm run build`, `check_web_bundle.py` and lint.
- **Android:** JVM tests for JSON decoding, notification text and routing, channels by group, the reminder suppression rule and the settings ViewModel. Instrumented `PushNotifierTest` on an emulator if one can run.
- **Parity:** `check_admin_parity.py` and `check_resources.py`.
- **Deferred:** a real FCM push to a real phone, and a real Cloudinary photo shown in the new places, stay in `docs/validation/POST-IMPLEMENTATION-CHECKLIST.md`.
