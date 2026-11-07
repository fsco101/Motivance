# Booking implementation evidence

What was built for in-center booking (S9 to S12), what ran, and what did not. The design is in [BOOKING.md](../architecture/BOOKING.md). Live API results are recorded in [booking-test-results.json](booking-test-results.json), which `python scripts/test_booking.py` regenerates.

Everything here ran against the local Supabase stack with disposable synthetic accounts. None of it is clinical validation, a hosted deployment or a test on a physical phone. Checks that did not run are in [the follow-up checklist](POST-IMPLEMENTATION-CHECKLIST.md).

## MOT-49: Scheduler role

The migration `202611060001_scheduler_role.sql` adds the role, `require_scheduler()` and `scheduler_patients`, and updates `admin_set_role` and `admin_summary`. Schedulers are left out of `can_read_patient`, so the role opens no clinical record.

Three existing assumptions would have failed quietly, and are fixed:

- `admin_summary` would have counted Schedulers as patients.
- Both apps' link pickers would have offered them as patients.
- Android's bottom bar would have shown them the patient tabs.

Android also parsed roles with `UserRole.valueOf`, which throws on a role it does not know, so one Scheduler account would have failed to sign in. `UserRole.of` now ignores unknown roles, so a role added later cannot lock out an older app.

| Check | Command | Result |
| --- | --- | --- |
| Live API: who can assign the role, 403 and 401 for every `scheduler_` function, no clinical reads | `python scripts/test_booking.py roles` | 40 checks passed |
| Database rules | `npx supabase@2.20.12 test db` | 29 tests passed |
| Web unit tests | `npm test` | 171 passed |
| Web contract tests | `npm run test:contract` | 32 passed |
| Web browser tests, including the 403 page for each role and granting the role | `npx playwright test tests/e2e/auth.spec.ts tests/e2e/admin.spec.ts` | 39 passed |
| Administrator suite | `python scripts/test_administration.py` | Passed |
| Android unit tests, including sign-in with an unknown role | `gradlew :core:domain:test :app:testDebugUnitTest` | Passed |
| Administrator parity | `python scripts/check_admin_parity.py` | 10 functions matched |

Both languages sit in the first download, so booking text would have broken the 300 KB budget. It now lives in `booking.en.json` and `booking.fil.json`, which load with the booking pages. Initial JavaScript is 290 KB, down from 293 KB.

The Scheduler note was first left unverified, because the only emulator was the owner's working session and `scripts/test_role_routing.py` clears app data. It was then run on a separate spare emulator during MOT-54, and `LiveRoleRoutingTest` passes, including the Scheduler seeing the note.

## MOT-50: center calendar and availability

The migration `202611060002_center_calendar.sql` adds `center_settings`, `center_hours`, `center_holidays` and `center_closures`, and seeds them with the defaults in the design and all 36 holidays from Proclamations 1006 and 1427. Eid'l Fitr and Eid'l Adha are not seeded, because their dates are proclaimed separately.

`booking_availability` returns each date's status and specific slots. A patient sees that the center is closed, but not why. Slot times are absolute, so the phone's or browser's zone cannot move them: the tests set the database session to New York and still get Manila's answers.

| Check | Command | Result |
| --- | --- | --- |
| Live API: slots, weekends, holidays, seasonal breaks, full and partial closures, notice, horizon, write refusal | `python scripts/test_booking.py availability` | 21 checks passed |
| Database rules, including every seeded holiday count and time zone independence | `npx supabase@2.20.12 test db` | 54 tests passed |

## MOT-51: conflict-safe bookings and the audit log

The migration `202611060003_bookings.sql` adds `bookings`, `booking_events` and the patient and Scheduler functions. Clients have no direct reads or writes on either table.

Three layers stop a conflict:

- **Exclusion constraints** reject overlapping active bookings for one patient or one therapist, even from a direct insert as the database owner.
- **One transaction lock** covers every booking change, so the capacity count cannot race. It also covers closures and settings.
- **Re-validation** runs at each decision, so a stale screen cannot confirm a time that has since closed.

The concurrent tests use real parallel HTTP requests through PostgREST, released together by a barrier:

| Race | Result |
| --- | --- |
| Ten patients request the last place in a slot | Exactly one succeeds, nine are told it is full, and the slot holds exactly its capacity |
| One patient asks for the same slot twice at once | One booking |
| Two Schedulers confirm one therapist at the same time | Exactly one succeeds, the other is told the therapist is busy |

The audit trail is written by a trigger, so no function can skip it, and it refuses changes even from the database owner. Each event records who, in which role, what changed and why, and is mirrored to `audit_events`. Both administrator feeds show a Bookings category, naming each booking by its reference number.

Two rules went beyond the brief, because the design needs them. A patient has a cap on active bookings, because a pending request holds a place. A therapist who leaves returns their future sessions to Pending, so nobody stays booked with someone who is gone.

| Check | Command | Result |
| --- | --- | --- |
| Live API: every rule, the races above, the audit trail, a therapist leaving | `python scripts/test_booking.py bookings` | 82 checks passed |
| All sections, with the 403 guard now covering 8 `scheduler_` functions | `python scripts/test_booking.py` | 166 checks passed |
| Database constraints and immutability | `npx supabase@2.20.12 test db` | 69 tests passed |
| Web unit tests, including booking event wording | `npm test` | 180 passed |
| Android unit tests, including booking event wording | `gradlew :core:domain:test :app:testDebugUnitTest` | Passed |
| Administrator parity | `python scripts/check_admin_parity.py` | 10 functions matched |

## MOT-52: patients on the web

Patients now have a full workspace at `/patient`, replacing the old "use the mobile app" page. Home, Exercises, Progress and Profile reuse the existing history and profile code, and the invitation, consent and data-request functions already on the server, so this needed no database change. Every read filters to the signed-in account, because row-level security alone would show an administrator everyone's records.

Starting an exercise or the camera check opens a suggestion to continue on the phone. `VITE_ANDROID_APP_URL` adds a store link and a QR code, and until it is set the suggestion gives the instruction alone. A browser test watches `getUserMedia`, and the page never asks for the camera.

Two problems came up that the existing checks did not catch:

- **Consent.** Android reused its last local grant, so after a withdrawal on the web the next session would have been rejected on upload and lost. Android now reads the server's latest consent when it refreshes, and records a new grant.
- **Clipped results on a phone.** The sessions table was cut off, hiding range of motion, repetitions and result, though the sideways-scroll check passed because the panel hides overflow. Sessions now stack on a phone, and a new check looks at each element. Putting the bug back makes that check fail.

| Check | Command | Result |
| --- | --- | --- |
| Patient browser tests, with axe, at desktop and phone width | `npx playwright test tests/e2e/patient.spec.ts` | 11 passed, three runs in a row |
| Full browser suite | `npx playwright test --workers=2` | 152 passed, 83 opt-in capture tests skipped. At the default worker count some tests time out on this 16 GB machine, and they pass serially |
| Web unit tests | `npm test` | 187 passed |
| Android unit tests, including consent reconciliation | `gradlew :core:domain:test :app:testDebugUnitTest` | Passed |
| Bundle | `python scripts/check_web_bundle.py` | 290 KB of 300 KB |

`SessionStoreTest.aWithdrawalMadeOnTheWebMeansTheNextSessionRecordsANewGrant` passes on a spare emulator, with all 9 tests in that class. A full withdrawal on the web followed by a camera session on a phone has not been run.

## MOT-53: patient booking on the web

Patients choose a date, then a specific time, on `/patient/book`, and follow it on `/patient/bookings`. Home shows the next session. The calendar and slot list live in `features/booking/`, because My Schedule and rescheduling need them too.

The server works out whether a booking can still be cancelled and until when, so the web and Android cannot drift apart on the rule. The client request ID is kept per chosen time, so trying again after a lost response returns the same booking. A refused request names its reason, the choice is cleared because the time may be gone, and the times reload.

All times are formatted in the center's zone. A browser test set to New York still reads 9:00 AM.

Reviewing the screens by eye found three things the tests had not: Upcoming relied on input order rather than sorting, the bottom bar cut off "My bookings", and a rejected booking said its therapist was "To be assigned". All three are fixed.

| Check | Command | Result |
| --- | --- | --- |
| Live API: `my_bookings`, the cut-off, reasons, slots a patient already holds | `python scripts/test_booking.py my_bookings` | 13 checks passed |
| All sections | `python scripts/test_booking.py` | 179 checks passed |
| Contract tests, including retry and refusal wording | `npm run test:contract` | 36 passed |
| Browser tests, with axe, at desktop and phone width, by keyboard and in another time zone | `npx playwright test tests/e2e/booking.spec.ts tests/e2e/patient.spec.ts --workers=2` | 22 passed |
| Design screens, with axe | `npx playwright test tests/e2e/design.spec.ts --workers=2` | 58 passed |
| Web unit tests | `npm test` | 198 passed |
| Bundle | `python scripts/check_web_bundle.py` | 291 KB of 300 KB |

## MOT-54: patient booking on Android

Patients get a Bookings tab, a Book a session screen and a next-session card on Home. `BookingRepository` is a domain contract, and `BookingViewModel` keeps each account's data apart. Times come from `SessionFormat`, which always uses the center's zone.

This was run in the real app on a spare API 35 emulator, driven through the interface against the local backend: sign in, open Bookings, choose a date and a specific time, request it, see it Pending, cancel it, see it Cancelled. The database agreed at each step. It ran as a throwaway AVD outside `~/.android`, addressed only by serial, so the owner's emulator and its app were not touched. `docs/operations/DEVELOPMENT.md` explains how to repeat this.

Running it found six things the unit tests could not:

| Found by using the app | Fix |
| --- | --- |
| Tapping Book while the list was loading dropped the calendar load, leaving it empty with no error, because reads and changes shared one guard | Reads now run alongside each other, with a test that reproduces it |
| Choosing a time changed nothing visible, because the next step was below the fold | The next step now scrolls into view, on Android and on the web |
| The calendar had no weekday header | Added |
| Unavailable days stood out more than available ones | They now sit flat on the page |
| The dialog offered "Cancel" and "Cancel booking" | The safe choice now says "Keep booking", on both apps |
| Pending looked like an error | It is now neutral |

`LiveRoleRoutingTest` failed intermittently at first, for two reasons. It typed into the Email field while a sign-out still had the form disabled, which is fixed. It also fails on the first run straight after a cold boot on this memory-starved machine. After the emulator settled it passed 3 runs of 3 on the final build.

| Check | Command | Result |
| --- | --- | --- |
| Domain and app unit tests, 32 of them new | `gradlew :core:domain:test :app:testDebugUnitTest` | Passed |
| Lint | `gradlew :app:lintDebug` | Passed |
| Live role routing on the spare emulator, including the Scheduler | `python scripts/test_role_routing.py` | 3 of 3 on the final build |
| Consent and storage on the spare emulator | `am instrument -e class com.motivance.data.local.SessionStoreTest` | 9 passed |
| Resources and module boundaries | `python scripts/check_resources.py`, `python scripts/check_module_boundaries.py` | Passed |
| Web after the shared fixes | `npx playwright test tests/e2e/booking.spec.ts` | 12 passed |

**Not run.** A physical phone, large text sizes and TalkBack.

## MOT-55: Scheduler request table

The Requests page at `/scheduler/requests` lists every booking. Search, filters, sorting and paging all happen in `scheduler_bookings`, so the table stays correct however many bookings exist. Sort columns come from a fixed list, so the parameter cannot carry anything else into the query.

Each booking opens beside the table with its history, and Confirm, Reject, Reschedule, Assign or Change Therapist and Cancel each happen in a dialog that names the patient and the time. The therapist list puts linked therapists first and marks who is busy, so a conflict is visible before it is refused. A Scheduler can reschedule inside the patient notice window, through `scheduler_availability`.

When an action is refused, the list always reloads. If the booking itself has changed, the dialog closes to show what happened. If only the choice is wrong, such as a therapist who has just become busy, it stays open with the updated choices.

`center_availability` now holds the slot calculation once, for both audiences, instead of a third copy.

A review before closing found problems the first tests had missed, and each now has a test. A selection could outlive its rows, so the confirmation could count a request already decided. Deciding the only row on the last page left an empty page reading "26 to 25 of 25". The Outdated filter dropped a search while its text stayed in the box. A count of one read "1 pending requests". The first two tests were shown to fail with their fix removed.

| Check | Command | Result |
| --- | --- | --- |
| Live API: search, filters, sorting, paging, history, therapist choices, short-notice slots, a sort injection attempt, and a patient asking for the staff view | `python scripts/test_booking.py requests` | 38 checks passed |
| All sections, with the 403 guard now covering every `scheduler_` function | `python scripts/test_booking.py` | 233 checks passed |
| Contract tests | `npm run test:contract` | 41 passed |
| Whole browser suite with axe, including 11 Scheduler tests | `npx playwright test --workers=2` | 178 passed. 83 opt-in tests did not run, as designed: 82 design captures need `CAPTURE_DESIGNS` and 1 motion measurement needs `MEASURE_MOTION` |
| Web unit tests | `npm test` | 199 passed |
| Database tests | `npx supabase test db` | 69 passed |
| Bundle | `python scripts/check_web_bundle.py` | 292 KB of 300 KB |

## S9 outcome

All seven issues are implemented and closed. Both sprint exit criteria stay recorded as not passed, under a deferral the user authorised, because part of each needs a physical phone: MOT-54-AC7 (booking at large text sizes and with TalkBack) and the sprint demo in one sitting.

Every step of the demo has passed in automated runs, though never as one continuous run. An administrator grants the Scheduler role in `web/tests/e2e/admin.spec.ts`. Patients request sessions in the browser tests, and in the real Android app on an emulator. Requests are confirmed and rejected in `web/tests/e2e/scheduler.spec.ts`. The live API test sends 10 parallel requests for the last place, and exactly 1 succeeds.

## MOT-56: My Schedule

Patients and therapists see the sessions a Scheduler has confirmed, at `/patient/schedule` and `/therapist/schedule` on the web, and on Android. A month calendar marks the dates with sessions, and choosing a date lays it out by the hour across the center's opening hours. Requests still waiting stay on My bookings.

`my_schedule` and `therapist_schedule` share `schedule_layout`, which builds each day on the server, so the two apps cannot disagree about one. Days are cut in the center's zone: 7 AM in Manila is still the day before in UTC, and a session then stays on its Manila date. A session always shows, even if the hours around it have changed since it was confirmed.

A booking grants no clinical access. `can_read_patient` is unchanged, and the schedule only says whether a link already exists, so the apps can offer the record. A therapist assigned to an unlinked patient sees their name and reference and nothing else. The live test reads empty results from four clinical tables as that therapist, and reads the same rows as the linked therapist, which shows the empty results are real.

On Android a therapist has a Schedule tab. A patient's five tabs are full, so theirs opens from My bookings. On the web's phone bar, My Schedule takes Book's place, and Book stays on the pages around it.

| Check | Command | Result |
| --- | --- | --- |
| Live API: confirmed sessions only, each person's own, specific times, the Manila day boundary, closed days, holidays, closures, 403s, a forged owner, and no clinical access from a booking | `python scripts/test_booking.py schedule` | 54 checks passed |
| All sections | `python scripts/test_booking.py` | 287 checks passed |
| Contract tests | `npm run test:contract` | 45 passed |
| Whole browser suite with axe, including 8 schedule tests, a browser set to New York and phone width | `npx playwright test --workers=2`, then the five files it cut off with `--workers=1` | 188 passed across the two runs, on the same code. See below. 83 opt-in tests did not run, as designed: design captures need `CAPTURE_DESIGNS` and the motion measurement needs `MEASURE_MOTION` |
| Web unit tests | `npm test` | 208 passed |
| Database tests | `npx supabase test db` | 69 passed |
| Android unit tests, 18 of them new | `gradlew :core:domain:test :app:testDebugUnitTest` | 200 passed |
| Android resources, module boundaries and administrator parity | `python scripts/check_resources.py`, `check_module_boundaries.py`, `check_admin_parity.py` | Passed |
| Both roles in the real Android app on a spare emulator set to New York, against the local backend | Driven through the UI | Passed. The phone reported EST and sessions read 9:00 AM Manila time. A patient saw the therapist, location and reference, and a pending request stayed off. A therapist saw both patients and their references, the linked record opened, and the unlinked card offered no record |
| Live role routing on the spare emulator, including the therapist's new tab | `python scripts/test_role_routing.py` | 10 of 10 on the final build, with the retry described below |
| Bundle | `python scripts/check_web_bundle.py` | 292 KB of 300 KB |

The first full browser run did not finish cleanly, because the machine ran out of memory with an emulator and Android Studio open. Five tests crashed, with no assertion failing: one browser crash, three workers that could not start, and one failed `docker` command. The 48 tests after them in the same serial files did not run. Those five files were run again on the same code with one worker, and all 63 of their tests passed. The other 125 tests had already passed. The crash also left 7 disposable accounts behind, which made `access_policies.test.sql` count a stray session. Removing them with the suite's own cleanup restored all 69 database tests.

`LiveRoleRoutingTest` failed intermittently during this issue, so it was compared with the commit before MOT-56, in alternating runs: 5 of 6 passed without MOT-56 and 4 of 6 with it, so MOT-56 did not cause this. Failures landed on different sign-ins and never on a role check. One caught on screen showed the app's own connection error with the form still filled, and the gateway logged the client closing the connection (status 499) about a second after the previous sign-out. Why the emulator's link drops is not established. The app behaves correctly here, so the test now tries a sign-in again when the app reports that failure, up to three times, as a person would. Role routing is still checked after every sign-in.

## MOT-57: Calendar management and closure resolution

The Calendar page at `/scheduler/calendar` edits the opening days and hours, session length, capacity, booking rules, center name and location, and manages holidays and closures. A closure covers a full day or a time range, with a required reason, and a holiday can run for several days.

A closure or holiday that overlaps active bookings opens a second step listing each one. Every booking needs a decision, to reschedule or cancel, before the save is offered. The server insists on this too: `calendar_resolve` refuses a save unless each affected booking has exactly one decision, and reuses `scheduler_cancel` and `scheduler_reschedule`, so every existing rule still applies. The closure is saved first, so a move into it is refused by the same check as any other, and any failure undoes the whole save, including cancellations already made in it. A booking made while the Scheduler is deciding is caught at the save, and joins the list.

Changing the hours moves nothing. Sessions already booked keep their time, and the page keeps a notice on screen saying how many now fall outside the hours.

Test cleanup turns off foreign keys, so a closure made by a test Scheduler would have stayed behind and kept closing the center. Both cleanups now remove them.

| Check | Command | Result |
| --- | --- | --- |
| Live API: settings, hours, holidays, closures, the impact list, refusal without a decision, partial and extra decisions, all-or-nothing saves, a booking that arrives late, editing and deleting | `python scripts/test_booking.py calendar` | 70 checks passed |
| All sections, with the 403 guard covering the new `scheduler_` functions | `python scripts/test_booking.py` | 385 checks passed |
| Contract tests | `npm run test:contract` | 51 passed |
| Browser tests with axe: Calendar, Scheduler, booking and the design gallery | `npx playwright test tests/e2e/calendar.spec.ts tests/e2e/scheduler.spec.ts tests/e2e/booking.spec.ts tests/e2e/design.spec.ts --workers=1` | 96 passed, and the opt-in motion measurement did not run |
| Web unit tests | `npm test` | 212 passed |
| Database tests | `npx supabase test db` | 69 passed |
| Bundle | `python scripts/check_web_bundle.py` | 292 KB of 300 KB |

Hours and rules are shared by every browser suite, so `calendar.spec.ts` intercepts those two saves and checks what the page sends. The live API test runs them for real, one at a time. The whole browser suite is not rerun for each issue, because of the memory limit on this machine, and runs again before the sprint closes.

## MOT-58: Therapist time off

Schedulers add, edit and delete a therapist's leave on the Calendar page, as a specific time range. `booking_check_therapist` is the one gate for confirming, assigning and rescheduling, so a single check there refuses all three. The therapist picker marks who is on leave and will not offer them.

Leave resolves like a closure, through the same `calendar_resolve`, but only that therapist's sessions need a decision. Because the center stays open, there is one more choice: a session can pass to another therapist at the same time.

The reason stays with scheduling. A patient whose session is cancelled for leave reads only that their therapist is away, because they can see a cancellation's reason and a therapist's reason for being away is their own. A therapist's own schedule shows the hours without the reason. Other therapists and patients do not see it at all.

| Check | Command | Result |
| --- | --- | --- |
| Live API: adding and refusing leave, all three ways onto a session, the picker, only that therapist's sessions needing a decision, all-or-nothing saves, what My Schedule shows and to whom, editing and deleting | `python scripts/test_booking.py time_off` | 48 checks passed |
| All sections | `python scripts/test_booking.py` | 445 checks passed |
| Contract tests | `npm run test:contract` | 52 passed |
| Browser tests with axe: Calendar, schedule, Scheduler and the design gallery | `npx playwright test tests/e2e/calendar.spec.ts tests/e2e/schedule.spec.ts tests/e2e/scheduler.spec.ts tests/e2e/design.spec.ts --workers=1` | 96 passed, and the opt-in motion measurement did not run |
| Web unit tests | `npm test` | 213 passed |
| Android unit tests | `gradlew :core:domain:test :app:testDebugUnitTest` | 201 passed |
| Database tests | `npx supabase test db` | 69 passed |
| Bundle | `python scripts/check_web_bundle.py` | 292 KB of 300 KB |

On Android, leave on My Schedule is covered by unit tests of the data it reads, and has not yet been seen on an emulator screen. That check runs before the sprint closes.

## MOT-59: In-app notifications and scheduler alerts

A trigger on `booking_events` writes notifications, so every change to a booking reaches the people it matters to, however it was made, including changes made while resolving a closure. Confirming, rejecting, rescheduling, cancelling and changing the therapist tell the patient and the therapists involved. New requests, patient cancellations and sessions that lose their therapist alert every active Scheduler. Nobody is told what they have just done themselves.

A row holds facts rather than sentences, and each app writes the text, so it follows the reader's language and reads the time in Asia/Manila. Switching language rewrites what is already in the list. A Scheduler's reason goes to the patient only.

The web has a bell in the header and a Notifications page for patients, therapists and Schedulers, and Android has the same bell and list. Administrators have neither, because they take no part in bookings. Opening a notification marks it read and goes to where the booking can be seen. Both apps check every minute while open, and Android ignores a result for an account that has since signed out.

| Check | Command | Result |
| --- | --- | --- |
| Live API: every kind of change, who hears and who does not, a closure, a therapist leaving, reading only your own, no writes or forged notifications, read and unread | `python scripts/test_booking.py notifications` | 49 checks passed |
| All sections | `python scripts/test_booking.py` | 494 checks passed |
| Contract tests | `npm run test:contract` | 52 passed |
| Whole browser suite with axe, one browser at a time | `npx playwright test --workers=1` | 209 passed, 1 failed and 1 did not run. 83 opt-in tests did not run, as designed |
| The two left over, after the fix below | `npx playwright test tests/e2e/notifications.spec.ts tests/e2e/schedule.spec.ts --workers=1` | 15 passed, so all 211 tests that run by default have passed on this code |
| Web unit tests | `npm test` | 216 passed |
| Android unit tests | `gradlew :core:domain:test :app:testDebugUnitTest` | 215 passed |
| Android resources and module boundaries | `python scripts/check_resources.py`, `check_module_boundaries.py` | Passed |
| The bell, the list and leave in the real Android app, on a spare emulator set to New York, against the local backend | Driven through the UI | Passed. The phone reported EST and a notification read 9:00 AM Manila time. Opening it went to My bookings or My Schedule, cleared the bell, and the server agreed. A therapist's leave showed on its hours, without the reason |
| Live role routing on the spare emulator, with the new header | `python scripts/test_role_routing.py` | 5 of 5 |
| Database tests | `npx supabase test db` | 69 passed |
| Bundle | `python scripts/check_web_bundle.py` | 297 KB of 300 KB |

The failed test measured sideways scrolling while the page was still sliding in. Settled pages do not overflow at 320, 360 or 390 pixels wide, so that test and the same check in `schedule.spec.ts` now wait for the page to settle.

The first download reads 297 KB, up from 292 KB, which looked larger than a bell should cost. Comparing source maps with the previous commit shows it gained five small modules, about 7.5 KB of source, and removing the bell saves only 1.2 KB compressed. The rest is the bundler regrouping shared code between files, which compresses a little worse. Only 3 KB of margin is left, so later web work has to load on demand.

The emulator check also covers what MOT-58 left open: leave on My Schedule has now been seen on an Android screen.

## MOT-60: Queued Gmail email and calendar links

Each notification adds a row to `notification_deliveries`, so a booking never waits for email and cannot fail because of it. `notification-dispatch` needs a shared secret, and claims rows with `for update skip locked` so two runs cannot send one email twice. A failure waits 2, 4, 8 and 16 minutes, then stops as failed. A row left claimed by a run that died comes back after 5 minutes. `pg_cron` calls the function every minute, with its address and secret in Vault, and does nothing until they are set.

Emails come in English and Filipino, with the session date, specific time, therapist, location and reference number. The server did not know anyone's language, because it lived only on each device, so `profiles.preferred_language` now holds it, and both apps report it. This was not in the plan, but the criterion cannot be met without it.

Confirmation and reschedule emails link to `booking-calendar`, which is public because a calendar app cannot sign in. A long random token is the only key, and the file names no patient. Every version of a booking's file has the same `UID` and a higher `SEQUENCE`, so a calendar replaces the entry.

No test can reach a real inbox. `scripts/test_email.py` starts the functions with an environment pointing at Mailpit, reads the running function's mail server, and stops if it is anything else.

| Check | Command | Result |
| --- | --- | --- |
| Real sends to Mailpit: the queue, the secret, both languages, calendar links, overlapping runs, retries, a dead run, HTML injection, and the scheduled job draining the queue | `python scripts/test_email.py` | 50 checks passed |
| Booking and notification sections | `python scripts/test_booking.py` | 494 checks passed |
| Contract tests, including every email kind in both languages and the calendar file format | `npm run test:contract` | 95 passed |
| Browser tests with axe: notifications and schedule, including the language reaching the server | `npx playwright test tests/e2e/notifications.spec.ts tests/e2e/schedule.spec.ts --workers=1` | 15 passed |
| Web unit tests | `npm test` | 216 passed |
| Android unit tests | `gradlew :core:domain:test :app:testDebugUnitTest` | 219 passed |
| Database tests | `npx supabase test db` | 69 passed |

Deferred, not passed: a real email reaching an inbox through Gmail from a hosted project on port 465. Locally the mail server is reached by address, because the mail library cannot resolve a Docker container's name inside the Edge runtime, so that check also proves it can look up `smtp.gmail.com` there.

## MOT-61: Reminders and expiring old requests

`enqueue_booking_reminders` runs every 5 minutes and reminds the patient and therapist 24 hours and 1 hour before a confirmed session. The session's start time is part of each reminder's key, so a job that runs twice finds the key and sends nothing, and a session that moves has a new key and gets fresh reminders. Cancelled, rejected and pending bookings get none.

`expire_stale_bookings` runs every 15 minutes and rejects pending requests whose time has passed. The patient is told, through the same trigger as any rejection.

The booking history records the system as the actor for both, and the audit log for expiry. Reminders stay out of the administrators' feed, which they would only fill up, so no new label was needed on either app.

System reasons were checked for in six places, so each platform now has one place that turns a reason code into words: `useReasonText` on the web and `bookingReasonText` on Android, plus the email template.

| Check | Command | Result |
| --- | --- | --- |
| Live API: both windows, exactly once including overlapping runs, a moved session, sessions that get none, the audit trail, expiry, and access | `python scripts/test_booking.py reminders` | 37 checks passed |
| All sections | `python scripts/test_booking.py` | 531 checks passed |
| Real sends to Mailpit | `python scripts/test_email.py` | 50 checks passed |
| Contract tests | `npm run test:contract` | 101 passed |
| Browser tests with axe: notifications, Scheduler, booking and patient | `npx playwright test tests/e2e/notifications.spec.ts tests/e2e/scheduler.spec.ts tests/e2e/booking.spec.ts tests/e2e/patient.spec.ts --workers=1` | 41 passed |
| Web unit tests | `npm test` | 216 passed |
| Android unit tests | `gradlew :core:domain:test :app:testDebugUnitTest` | 220 passed |
| Database tests | `npx supabase test db` | 69 passed |
| Bundle | `python scripts/check_web_bundle.py` | 297 KB of 300 KB |

The expiry job closes exactly what the Scheduler's outdated-requests test creates, so that suite pauses the job with `cron.alter_job` and restores it at the end, even after a failure.

## MOT-62: Confirmed schedule with XLSX and PDF export

The Schedule page at `/scheduler/schedule` lists confirmed and rescheduled sessions, with search and filters for date range, therapist, patient and status. It reuses `scheduler_bookings`, so search, sorting and paging stay on the server.

An export reads the whole filtered result, page by page, not the rows on screen. The audit entry is written first, with the format and row count, because the rule is that every export is recorded: a file that then fails to build leaves one line too many, which is better than a file nobody recorded. Administrators see exports in Activity, and that label shipped to the web and Android together.

The PDF carries the center's name and logo, the date range and when it was made. The export libraries load only on export, so the first download did not grow. They are the three the plan listed, each more than two weeks old. `fflate` is a test dependency, used to open exported spreadsheets.

Testing this turned up five problems, all fixed here:

- Axe: with more than 9 unread, the bell showed "9+" but its label gave the exact number, so someone using voice control could not say what they saw. The label now holds what the badge shows.
- A review of the labels: the new Activity label was under the wrong key, so the web feed fell back to its generic wording while every test passed. It is moved, every audit kind now has a test for its words in both languages, and a browser test reads the real feed as an administrator.
- A review of the patient filter: `scheduler_patients` is a search capped at 50 that hides disabled accounts, so as a list it left patients out. The filter now comes from `scheduler_schedule_patients`, the people actually on the schedule.
- Contract set-up sat on a 10 second limit while the tests themselves had 30, so a busy machine could fail a run before any test began. Set-up now has the same 30 seconds.
- A contract test failed once in a whole run, on a booking insert. The database log showed why: `notify_schedulers` listed a Scheduler that another test then removed, the foreign key failed, and that rolled back the booking. So a notification could cost a patient their request. `notify` now skips a recipient who has gone. The new live check failed with the same error before the fix.

| Check | Command | Result |
| --- | --- | --- |
| Live API: recording exports, what an administrator sees, refusals | `python scripts/test_booking.py exports` | 9 checks passed |
| A removed recipient does not stop a booking | `python scripts/test_booking.py notifications` | Passed; failed before the fix |
| All sections | `python scripts/test_booking.py` | 549 checks passed |
| Real sends to Mailpit, and the S10 demo | `python scripts/test_email.py` | 58 checks passed |
| Contract tests, including reading a result across several pages | `npm run test:contract` | 108 passed, five runs in a row |
| Whole browser suite with axe, one browser at a time, before the last fixes below | `npx playwright test --workers=1` | 220 passed. 83 opt-in tests did not run, as designed |
| The four specs those fixes touch, after them, including 9 confirmed-schedule tests that open exported files, refuse a file with no audit record, and read the real Activity feed | `npx playwright test confirmed-schedule admin notifications scheduler --workers=1` | 45 passed |
| Web unit tests | `npm test` | 244 passed |
| Android unit tests | `gradlew :core:domain:test :app:testDebugUnitTest` | 220 passed |
| Administrator parity | `python scripts/check_admin_parity.py` | Passed |
| Database tests | `npx supabase test db` | 69 passed |
| Bundle | `python scripts/check_web_bundle.py` | 297 KB of 300 KB |

An exported PDF was also rendered and looked at: the logo, the header, the table and the times all draw correctly, and it runs to a second page for 30 sessions. The PDF's built-in font covers Western European text, so a name in another script would not draw correctly. The spreadsheet has no such limit.

## S10 outcome

All seven issues are implemented and closed. The sprint demo ran for real, in one sitting, through the same API the apps call, in `scripts/test_email.py`: a session was confirmed and shown on both My Schedules at its specific time, a closure was added over it, the booking was resolved, and the patient had the in-app notification and an email with a working calendar link. The issue criterion stays recorded as not passed, under a deferral the owner approved, because MOT-60 needs a real Gmail delivery from a hosted project.

## MOT-63: Waitlist

A full time can now be chosen, to wait for it, on the web and on Android. A place in line holds nothing: when a place opens, everyone waiting hears, in the app and by email, and the first to book gets it under the same rules as any booking. Someone who was not waiting can take it too.

The trigger sits on `booking_events`, so a place cannot be missed by a new way of cancelling or moving a booking. A burst of cancellations is one message per person, and once the slot fills again the next place is news. Raising the capacity counts as a place opening. A place nobody could book is not news: a closed time, or one inside the notice period, says nothing and drops off the list. A disabled account is not told.

An open place can be booked from My bookings in one step, because the first to book gets it.

| Check | Command | Result |
| --- | --- | --- |
| Live API: joining, refusals, who hears and how often, a race for one place, moving and closing | `python scripts/test_booking.py waitlist` | 40 checks passed, three runs in a row |
| All sections | `python scripts/test_booking.py` | 589 checks passed |
| A real send through the queue to Mailpit | `python scripts/test_email.py` | 60 checks passed |
| Contract tests | `npm run test:contract` | 114 passed |
| Browser tests with axe: joining, leaving, the place opening, booking it, losing it to someone else | `npx playwright test waitlist booking design patient scheduler notifications --workers=1` | 114 passed. 1 opt-in test did not run, as designed |
| Web unit tests | `npm test` | 244 passed |
| Android unit tests | `gradlew :core:domain:test :app:testDebugUnitTest` | 229 passed |
| The app on a throwaway emulator, against the local backend | Driven through its UI, checking the screen and the server at each step | 15 checks passed: joining, leaving, the list, the notification, booking the place |
| Bundle | `python scripts/check_web_bundle.py` | 297 KB of 300 KB |

Two older tests pinned the rule this changes, that a full slot cannot be chosen. The browser test now proves a full slot offers the waitlist and never a request. A held slot still cannot be chosen.

The whole live suite also caught a fault in a new check: raising the capacity told one patient about two slots whenever that patient had lost an earlier race, which is correct, so the check now looks at one slot. It had passed alone only when that patient won.

A physical phone is still to be tried, and is on the checklist.

## MOT-64: Patient self-service reschedule

A patient can move their own pending, confirmed or rescheduled session to another specific slot, on the web and on Android. A move is a new request for a new time: it obeys every rule a request does, plus the reschedule cut-off and the maximum number of moves, and a Scheduler confirms it again, so a confirmed session returns to Pending. The therapist stays only if they are free then, which includes not being on leave.

Schedulers and the therapist are told. A therapist who stays hears it as a move that needs confirming, with no calendar link, because the new time is not theirs to plan around yet. A therapist who cannot stay hears the session is no longer theirs. Moving to the time a session already has changes nothing and uses no move, so a retry after a lost response is safe. The place left behind opens for anyone on the waitlist.

| Check | Command | Result |
| --- | --- | --- |
| Live API: each rule, the therapist staying or going, the limit and cut-off, who hears, a race for the last place, the waitlist | `python scripts/test_booking.py self_reschedule` | 36 checks passed |
| All sections | `python scripts/test_booking.py` | 625 checks passed |
| Email wording, and no calendar link on a move that needs confirming | `npm run test:contract` | 119 passed, three runs in a row |
| Browser tests with axe: the card, the move page, a time taken while choosing, no moves left, an old link | `npx playwright test reschedule booking waitlist design patient notifications --workers=1` | All passed, over two runs on the same code. `booking` and `design` finished in a first run the system then stopped for low memory, with no assertion failing. The four files it cut off were rerun with one worker: 28 passed |
| Real sends to Mailpit | `python scripts/test_email.py` | 60 checks passed |
| Web unit tests | `npm test` | 244 passed |
| Android unit tests | `gradlew :core:domain:test :app:testDebugUnitTest` | 237 passed |
| The app on a throwaway emulator, against the local backend | Driven through its UI, checking the screen and the server at each step | 8 checks passed: moving a confirmed session as a patient, then reading the news as the therapist |
| Bundle | `python scripts/check_web_bundle.py` | 297 KB of 300 KB |

The contract suite failed once more while this was tested, this time because a count was compared across two reads while another file was adding accounts. That was the third failure caused by test files sharing one database at the same moment, after the notification race and the set-up time limit in MOT-62, so `npm run test:contract` now runs its files one at a time. It takes 50 seconds rather than 15, and CI uses the same script.

A physical phone is still to be tried, and is on the checklist.

## MOT-65: Attendance

The assigned therapist or a Scheduler can mark a session attended or no-show once it has started, and marking again corrects it. Nobody else can: `mark_attendance` refuses other therapists, patients and administrators with a 403, and clients have no direct write. The same mark twice changes nothing, so a double tap records one event.

Therapists mark from My Schedule on the web and Android. Schedulers mark from the confirmed schedule, which gains an attendance column, a filter and an attendance column in both exports. "Not marked" means a session that has started, because one still to come needs nothing yet. The server says when a session has started, so the apps cannot disagree with it about the moment marking opens.

Every change is recorded with what it was, in the booking's history and the audit log. A mark describes the time a session had, so moving a session clears it.

| Check | Command | Result |
| --- | --- | --- |
| Live API: who can mark, correcting, the history, refusals, the filters, moving a session | `python scripts/test_booking.py attendance` | 26 checks passed |
| All sections | `python scripts/test_booking.py` | 651 checks passed |
| Contract tests | `npm run test:contract` | 124 passed |
| Browser tests with axe: marking and correcting, a patient seeing no marks, the column, filters and an opened export, the history | `npx playwright test attendance schedule confirmed-schedule scheduler design admin --workers=1` | 126 passed. 83 opt-in tests did not run, as designed |
| Web unit tests | `npm test` | 244 passed |
| Android unit tests | `gradlew :core:domain:test :app:testDebugUnitTest` | 242 passed |
| Android lint | `gradlew :app:lintDebug` | Passed |
| The app on a throwaway emulator, against the local backend | Driven through its UI, checking the server at each step | 5 checks passed: both marks offered, marking, correcting, the history, and no marks on a session still to come |
| Database tests | `npx supabase test db` | 69 passed |
| Administrator parity | `python scripts/check_admin_parity.py` | Passed |
| Bundle | `python scripts/check_web_bundle.py` | 297 KB of 300 KB |

The Schedule table was also looked at by eye at 1024 and 1440 pixels. The two marks stack at the narrower width and nothing scrolls sideways.

A physical phone is still to be tried, and is on the checklist.

## MOT-66: Weekly repeat bookings

A Scheduler chooses a patient, therapist, first session and number of weeks from the Schedule page, and sees every date with what would stop it before anything is saved. Saving confirms the dates that pass and leaves out the rest, so one holiday does not cost a patient the whole course. Every date goes through the same checks as any booking a Scheduler makes, again at the save, because a preview can go out of date. Saving twice with the same request returns the same course.

The patient and therapist get one notification and one email for the course, with the number of sessions, and each session still gets its own reminders. Cancelling works the same way: the remaining sessions go together, with a reason, from any session in the course. Sessions that have started stay, and each therapist hears about the sessions that were theirs. The places that open reach the waitlist.

A date of a course is recorded as booked, not requested, so nobody is asked to decide it. Administrators read it in Activity, and that label shipped to the web and Android together.

| Check | Command | Result |
| --- | --- | --- |
| Live API: one course meeting a closure, a holiday, leave, a busy therapist, an overlap and a full slot, a stale preview, a retry, two Schedulers racing for the last place, cancelling, who hears what | `python scripts/test_booking.py series` | 43 checks passed |
| All sections, with the 403 guard covering the new functions | `python scripts/test_booking.py` | 706 checks passed |
| Real sends to Mailpit: one email each, in each reader's language, and one for cancelling | `python scripts/test_email.py` | 64 checks passed |
| Contract tests, including every new email in both languages | `npm run test:contract` | 132 passed |
| Browser tests with axe: the dialog, the dates, going back, saving, cancelling | `npx playwright test series scheduler confirmed-schedule notifications design --workers=1` | 101 passed. 83 opt-in tests did not run, as designed |
| Web unit tests | `npm test` | 246 passed |
| Android unit tests, including reading a course's notification and its audit label | `gradlew :core:domain:test :app:testDebugUnitTest` | 243 passed |
| Database tests | `npx supabase test db` | 69 passed |
| Administrator parity | `python scripts/check_admin_parity.py` | Passed |
| Bundle | `python scripts/check_web_bundle.py` | 297 KB of 300 KB |

The Scheduler workspace is web only, so the only Android change is reading the four new notifications and the audit label. Those are covered by unit tests, not yet seen on an emulator screen.
