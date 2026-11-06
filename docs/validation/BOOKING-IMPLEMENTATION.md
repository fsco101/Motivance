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
