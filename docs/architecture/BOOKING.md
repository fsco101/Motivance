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
- **The server lays out each day.** `my_schedule` and `therapist_schedule` return every date with the center's hours as rows and the person's sessions in place, so the web and Android cannot lay a day out differently. A time the center has closed drops out of its hours, and a session always shows, even if the hours around it have changed since it was confirmed.
- **Where My Schedule sits.** The bottom bars hold five. On the web's phone bar, My Schedule takes Book's place, and Book stays in the sidebar and on the pages that lead to it. On Android a therapist gets a Schedule tab, and a patient opens it from the Bookings tab.
- **"Rescheduled" is an active status.** A Scheduler reschedule moves the same booking to a new time and it stays confirmed in effect. It needs a therapist. A patient's own reschedule of a confirmed booking returns it to Pending, so a Scheduler re-confirms it.
- **The Scheduler workspace is web only.** It is built from data tables and exports, and the parity rule covers administrators. A Scheduler on Android sees a note to use the web, plus their notifications.
- **Admins are not Schedulers.** An admin gets a 403 on scheduling unless another admin grants them the role, because the existing rule blocks changing your own roles.
- **The patient does not pick a therapist.** The Scheduler assigns one, and must before confirming. Therapists already linked to the patient are shown first.
- **Closures and holidays must resolve every active booking they touch,** pending ones too. Otherwise a patient would keep a live request on a closed day and nobody would tell them.
- **Notifications come from the audit log.** A trigger on `booking_events` writes them, so every change reaches the people it matters to, however it was made, including changes made while resolving a closure. A row holds facts rather than sentences, so each app writes the text in its reader's language. Nobody is told what they have just done themselves, and administrators have no bell, because they take no part in bookings.
- **Email leaves through a queue.** A notification adds a row to `notification_deliveries`, so a booking never waits for Gmail and cannot fail because of it. `notification-dispatch` claims rows so two runs cannot send one email twice, and retries with growing waits before stopping as failed. The server keeps each person's language in `profiles.preferred_language`, because email has no app to choose it.
- **Reminders cannot repeat.** The session's start time is part of each reminder's key, so a job that runs twice finds the key and sends nothing, and a session that moves has a new key and gets fresh reminders. They are kept in the booking's own history, not the administrators' feed, which they would only fill up.
- **A request nobody decided ends by itself.** Once its time has passed nobody can act on it, so the system rejects it and tells the patient, with the reason written in each app's language.
- **An export is on the record before it exists.** The audit entry is written before the file is built, because the rule is that every export is recorded. A file that then fails to build leaves one line too many, which is better than a file nobody recorded. Administrators see exports in Activity on both apps.
- **The PDF covers Western European text only.** It uses a built-in font, which keeps the download small and handles Filipino names, but a name in another script would not draw correctly. The spreadsheet has no such limit.
- **Attendance belongs to the people who were there.** The assigned therapist or a Scheduler can mark it once a session has started, and marking again corrects it. Every change is recorded with what it was. A mark describes the time a session had, so moving the session clears it. "Not marked" means a session that has started, because one still to come needs nothing yet.
- **A patient's move is a new request.** It obeys every rule a request does, plus the cut-off and the move limit, and a Scheduler confirms it again, so a confirmed session returns to Pending. The therapist stays only if they are free then. Moving to the time a session already has changes nothing and uses no move, so a retry after a lost response is safe.
- **A move that needs confirming carries no calendar link.** A therapist hears about it, but the new time is not theirs to plan around until a Scheduler confirms it.
- **A weekly course leaves out what cannot happen.** The dates that pass are confirmed and the rest are left out, so one holiday does not cost a patient the whole course. Every date passes the same checks as any booking made by a Scheduler, again at the save, because the preview may be out of date by then. The cap on active bookings is for what a patient asks for, so a course can pass it. Sessions in a course still count towards it, so a patient on one books further sessions through the center.
- **A course is one message.** The patient and therapist hear once when a course is booked and once when it is cancelled, each with the number of sessions, and each session still gets its own reminders. Its email has no calendar link, because one link cannot hold a course.
- **Cancelling a course cancels what is still to come.** Sessions that have started are history and stay. A session the patient moved still belongs to the course, so it goes with the rest.
- **A figure counts what its page lists.** Each number on the Scheduler's dashboard comes from `scheduler_summary` and opens the page it counted, already filtered. Utilization is booked sessions as a share of the places in open slots from Monday to Sunday, counting the whole week so the figure does not shrink as the week passes. Booked means confirmed or rescheduled, because a pending request is not yet a session. A session left outside changed hours is not in an open slot, so it is not counted. With no open slots there is no share, and the page says so rather than showing zero.
- **Web sign-up is Android's sign-up.** It has the same four steps and rules, and sends the same `patient_profile` details, so the same trigger makes the account and enforces the same limits. A username already in use can only fail inside that trigger, which Auth reports as a database error, so the page sends the person back to change it with everything else kept.
- **Booking starts at sign-up.** Book a Session opens sign-up, and the wish to book survives sign-up and sign-in, so a patient arrives on the booking page. Staff who follow the same link still reach their own workspace.
- **Waiting holds nothing.** A place on the waitlist reserves no capacity, so anyone can book a place that opens, whether they were waiting or not. A time that can no longer be booked, because it is closed or inside the notice period, drops off the list rather than leaving someone waiting for nothing.
- **One opening is one message.** A burst of cancellations tells each person once. If the slot fills again, the next place is news.
- **A notification never costs anyone their booking.** It runs inside the change it reports, so `notify` skips a recipient who disappeared part-way through rather than failing the whole change.
- **Leave stays private.** A therapist's reason is seen only by Schedulers. A patient whose session is cancelled for it reads only that their therapist is away, and a therapist's own schedule shows the hours without the reason. Other therapists and patients do not see it at all.
- **Leave resolves like a closure, with one more choice.** The center stays open, so a session can pass to another therapist at the same time. That is usually kinder than moving it.
- **Changing the hours moves nothing.** Sessions already booked keep their time, because hours change far more often than people can be rung. The save reports how many now fall outside the hours, and the Calendar page keeps that on screen until someone looks at them. A closure or holiday is different: it means the center is shut, so each booking needs a decision first.
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
| `booking_series` | Patient, therapist, weeks (2 to 26), client request ID, created by, cancelled at and reason | Groups weekly repeats |
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
| Any active account | `booking_availability(from, to)`, `my_notifications(limit)`, `mark_notifications_read(ids)`, `set_my_language(language)`, `register_device(token, platform)` |
| Patient | `request_booking`, `my_bookings`, `my_schedule(from, to)`, `cancel_my_booking`, `reschedule_my_booking`, `join_waitlist`, `leave_waitlist`, `my_waitlist` |
| Therapist | `therapist_schedule(from, to)`, `mark_attendance` (Scheduler too) |
| Scheduler: requests | `scheduler_bookings` (search, filters, sort, page, total), `scheduler_booking_detail`, `scheduler_availability` (open slots without the patient notice window or horizon), `scheduler_confirm`, `scheduler_reject`, `scheduler_reschedule`, `scheduler_assign_therapist`, `scheduler_cancel`, `scheduler_bulk_reject`, `scheduler_therapists`, `scheduler_patients`, `scheduler_schedule_patients`, `scheduler_log_export` |
| Scheduler: calendar | `scheduler_save_settings`, `scheduler_save_hours`, `scheduler_save_holiday`, `scheduler_delete_holiday`, `scheduler_calendar_impact`, `scheduler_save_closure` (takes the resolution for each affected booking, in one transaction), `scheduler_delete_closure`, `scheduler_time_off`, `scheduler_save_time_off`, `scheduler_delete_time_off` |
| Scheduler: series and dashboard | `scheduler_series_preview` (each date with what would stop it), `scheduler_series_create`, `scheduler_series_cancel`, `scheduler_summary` |
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
| Web, tests only | `fflate` | Opens exported spreadsheets so a test can read them. Already in the tree through `write-excel-file` |
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
