# Booking and scheduling

This is the design for in-center therapy sessions, approved by the owner on 2026-11-06 before any code was written. Patients request a session on the web or Android, and a Scheduler confirms requests and runs the center's calendar. Sprints S9 to S12 track the work.

Supabase remains the only backend, so "endpoints" here are database functions called over HTTP with the signed-in token.

## What this changes

- **Patients get the whole app on the web, except the camera.** The earlier design sent a patient who signed in on the web to a "use the mobile app" page. Patients now have a full web workspace with everything they can do on Android. Only the camera exercise suggests moving to the phone.
- **The web has sign-up.** Registration existed only on Android.
- **A fourth role exists.** Android parsed roles with `UserRole.valueOf`, which throws on a role it does not know, so that had to change before any account could hold the new role.

## Choices left open in the brief

| Question | Decision | Why |
| --- | --- | --- |
| How long before a session can a patient cancel? | 24 hours by default, editable by the Scheduler | It is a setting, not a constant |
| Where do holidays come from? | A seeded list, editable by the Scheduler | Eid'l Fitr and Eid'l Adha are proclaimed separately, so no API knows them ahead of time. The seed follows Proclamation 1006 (2026) and Proclamation 1427 (2027). February 25 is a special working day in both years, so it stays bookable |
| How is Gmail reached? | SMTP with the existing App Password | Supabase blocks ports 25 and 587 from Edge Functions, so notification email uses port 465 through its own setting. Port 465 is not documented as blocked, but only a hosted project can prove it, so that check is deferred |
| Push through FCM? | Built last, inert until the owner adds credentials | Firebase was not set up. Its values go in `android/.env`, so the app builds and runs without them |

## Decisions

- **What stays on the phone.** The exercise session and the camera check need the camera. Local history and Sync now describe what is stored on that phone, so they have no meaning on the web.
- **Withdrawing consent on the web reaches the phone.** Android trusts its own last consent record, so after a web withdrawal it would reuse the old grant, and the server would reject that session on upload. Android reads the server's latest consent when it refreshes, so it asks again.
- **Every session has a specific time.** A patient chooses a time slot, not just a day, and a Scheduler who reschedules picks another specific slot. Each session has a start and end time, such as 9:00-10:00 AM, in the center's time zone. My Schedule lays out the chosen date by time across the center's opening hours. The same start and end time appear on My bookings, the Scheduler's tables, notifications, emails and exports.
- **My Schedule shows only what a Scheduler has confirmed.** That means confirmed and rescheduled sessions. Requests still waiting, and rejected or cancelled ones, stay on the patient's My bookings page. A therapist sees only sessions assigned to them, with the patient's name, time and reference number. Opening the patient's record still needs the existing therapist-patient link, so a booking alone grants no access to clinical data.
- **A pending request holds its place.** Simultaneous requests must not both succeed, so pending, confirmed and rescheduled bookings all count toward capacity. To stop one patient filling the calendar, a setting caps active bookings per patient (default 5).
- **"Rescheduled" is an active status.** A Scheduler reschedule moves the same booking to a new time and it stays confirmed in effect. It needs a therapist. A patient's own reschedule of a confirmed booking returns it to Pending, so a Scheduler re-confirms it.
- **The Scheduler workspace is web only.** It is built from data tables and exports, and the parity rule covers administrators. A Scheduler on Android sees a note to use the web, plus their notifications.
- **Admins are not Schedulers.** An admin gets a 403 on scheduling unless another admin grants them the role, because the existing rule blocks changing your own roles.
- **The patient does not pick a therapist.** The Scheduler assigns one, and must before confirming. Therapists already linked to the patient are shown first.
- **Closures and holidays must resolve every active booking they touch,** pending ones too. Otherwise a patient would keep a live request on a closed day and nobody would tell them.
- **Removing a therapist unassigns their future bookings.** Revoking the role or disabling the account returns those bookings to Pending for the Scheduler to reassign.
- **The waitlist notifies everyone waiting** when a place opens, and the first to book gets it. Notifying in turn could stall on one person who never responds.
- **Exports are built in the browser** from the same filtered query, and each export is written to the audit log.

## Data model

All times are `timestamptz` in UTC and are shown in the center's zone (Asia/Manila) whatever the device's zone. Clients get no direct writes; everything goes through the functions below.

| Table | Fields | Relationships and rules |
| --- | --- | --- |
| `user_roles` (changed) | `role` also allows `scheduler` | `admin_set_role` accepts it. `admin_summary` adds a schedulers count and no longer counts them as patients |
| `center_settings` | One row: center name, location, time zone, slot minutes (60), slot capacity (3), cancel and reschedule cut-offs (24 h), minimum notice (24 h), booking horizon (60 days), max active bookings (5), max self-reschedules (2) | Readable by any active account, written by Schedulers |
| `center_hours` | Weekday 1-7, open flag, opens at, closes at | Seeded Monday to Friday, 09:00-17:00 |
| `center_holidays` | Name, kind (regular, special, seasonal), starts on, ends on, source | Seeded for 2026 and 2027. Date ranges allow seasonal breaks |
| `center_closures` | Starts at, ends at, all day, required reason, created by | Full day or a time range |
| `therapist_time_off` | Therapist, starts at, ends at, reason, created by | References `profiles`. The reason is visible to scheduling only |
| `booking_series` | Patient, therapist, weeks, created by, cancelled at | Groups weekly repeats |
| `bookings` | Reference no., patient, therapist (optional until confirmed), series, starts at, ends at, status, status reason, previous start, attendance, marked by and at, self-reschedule count, client request ID, calendar token | Two exclusion constraints stop overlaps for one patient and for one therapist among active bookings |
| `booking_events` | Booking, actor, actor role, action, from and to status, time and therapist, reason, recorded at | Immutable, written by a trigger so it cannot be skipped. Also mirrored to `audit_events` for the admin feed |
| `booking_waitlist` | Patient, starts at, ends at, status, notified at | One open entry per patient per slot |
| `notifications` | User, kind, booking, data, read at, dedupe key | The owner reads their own. Clients render the text, so it follows their language |
| `notification_deliveries` | Notification, channel (email, push), status, attempts, next attempt, last error, sent at | The queue. Retries back off, then stop as failed |
| `device_tokens` | User, token, platform, updated at | For FCM |

**Conflict prevention.** Exclusion constraints guard patients and therapists in the database itself. Capacity uses a transaction lock, then a count of overlapping active bookings, so two simultaneous requests for the last place cannot both pass. That single lock also covers closures and settings changes. Every confirmation re-checks hours, holidays, closures, capacity, therapist leave and therapist conflicts. A repeated request with the same client ID returns the original booking, so retries are safe.

**Privacy.** `can_read_patient` is not widened. Schedulers read names, reference numbers and times through their own functions only, and tests prove they see no sessions, measurements, prescriptions, consents or patient profiles.

## Endpoints

All are `security definer` functions that re-check the caller. A failed role check returns HTTP 403.

| Who | Functions |
| --- | --- |
| Any active account | `booking_availability(from, to)`, `mark_notifications_read(ids)`, `register_device(token, platform)` |
| Patient | `request_booking`, `my_bookings`, `my_schedule(from, to)`, `cancel_my_booking`, `reschedule_my_booking`, `join_waitlist`, `leave_waitlist` |
| Therapist | `therapist_schedule(from, to)`, `mark_attendance` (Scheduler too) |
| Scheduler: requests | `scheduler_bookings` (search, filters, sort, page, total), `scheduler_booking_detail`, `scheduler_confirm`, `scheduler_reject`, `scheduler_reschedule`, `scheduler_assign_therapist`, `scheduler_cancel`, `scheduler_bulk_reject`, `scheduler_therapists`, `scheduler_patients`, `scheduler_log_export` |
| Scheduler: calendar | `scheduler_save_settings`, `scheduler_save_hours`, `scheduler_save_holiday`, `scheduler_delete_holiday`, `scheduler_closure_impact`, `scheduler_save_closure` (takes the resolution for each affected booking, in one transaction), `scheduler_delete_closure`, `scheduler_save_time_off`, `scheduler_delete_time_off` |
| Scheduler: series and dashboard | `scheduler_series_preview`, `scheduler_series_create`, `scheduler_series_cancel`, `scheduler_summary` |
| Scheduled jobs (`pg_cron`) | `enqueue_booking_reminders`, `expire_stale_bookings`, and a call to `notification-dispatch` |

Edge Functions in `supabase/functions/`, the first in this repository:

- `notification-dispatch` drains the queue, sending email through Gmail and push through FCM. It needs a shared secret.
- `booking-calendar` is public, and returns the `.ics` file for an unguessable per-booking token.

## Screens

| App | Screens |
| --- | --- |
| Web, Scheduler | Dashboard, Requests (table, detail panel, bulk reject), Schedule (filters, XLSX and PDF export), Calendar (hours and settings, holidays, closures, therapist time off), weekly repeat dialog, 403 page for anyone else |
| Web, Patient | Home (next session, next exercise, this week, recent sessions), My Schedule (month calendar of confirmed sessions; choosing a date shows that day by time, with start and end time, therapist and location), Book a session, My bookings, Exercises (assigned list with targets and instructions), Progress (history, filters, charts), Notifications, Profile (details, photo, password, language, consent and data requests, joining a therapist by code). Starting an exercise or the camera check suggests the phone, with links or a QR code. Works at phone width, unlike the staff workspaces |
| Web, Therapist | My Schedule (month calendar; choosing a date shows that day by time, with the patient booked at each time and attendance marking), notification bell |
| Web, Admin | Grant or revoke Scheduler, Schedulers filter and count, booking events in Activity |
| Web, public | Redesigned landing page, sign-up (four steps and an email code, same rules as Android) |
| Android, Patient | My Schedule (each date laid out by time), Bookings tab (status list, cancel, reschedule), Book a session, waitlist, notifications with a bell in the header |
| Android, Therapist | My Schedule (each date laid out by time, with the patient at each time and attendance marking), notifications |
| Android, Admin | The same Scheduler role, filter, count and activity changes, in the same commit as the web, per the parity rule |

Patient pages always filter to the signed-in account, because row-level security alone would show an administrator everyone's records.

## New dependencies

| Where | Package | Purpose |
| --- | --- | --- |
| Web | `write-excel-file`, `jspdf`, `jspdf-autotable` | XLSX and PDF export, downloaded only on export, so they stay out of the initial bundle budget |
| Web | `qrcode-generator` | App download QR code, loaded only where shown |
| Edge Function | `nodemailer`, pinned to a release at least two weeks old | Gmail SMTP |
| Android | `firebase-messaging` through its BOM | FCM, in MOT-69 only |
| Database | `btree_gist`, `pg_cron` | Exclusion constraints and scheduled jobs |

## Environment

| Variable | Where | For |
| --- | --- | --- |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_EMAIL`, `SMTP_SENDER_NAME` | Edge secrets (the existing values) | Gmail sender |
| `NOTIFICATION_SMTP_PORT` | Edge secrets | 465 |
| `NOTIFICATION_DISPATCH_SECRET` | Edge secrets and Vault | Lets the scheduled job call the function |
| `PUBLIC_SITE_URL` | Edge secrets | Links in emails |
| `VITE_ANDROID_APP_URL` | `web/.env` | Store link and QR code. The app is not on Play yet, so until this is set the page shows the instruction without a link |
| `FCM_SERVICE_ACCOUNT` | Edge secrets | Added by the owner later |
| `FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID`, `FIREBASE_API_KEY`, `FIREBASE_SENDER_ID` | `android/.env` | Added by the owner later |

## Before going live

Someone needs to enter the center's real name, address and capacity in the Calendar settings, because the seeded values are placeholders. Real Gmail delivery, port 465 from a hosted project, real FCM delivery, physical-device checks and representative review of the Filipino wording are deferred to [the follow-up checklist](../validation/POST-IMPLEMENTATION-CHECKLIST.md).
