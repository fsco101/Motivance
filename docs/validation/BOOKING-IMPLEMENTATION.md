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

**Not run.** The Scheduler note on Android compiled but was not seen on a device. The only emulator was the owner's Android Studio session, with the app open, and `scripts/test_role_routing.py` clears app data. The machine had too little free memory for a second emulator. `LiveRoleRoutingTest` now covers this case and is ready to run on a spare emulator.

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

**Not run.** `SessionStoreTest.aWithdrawalMadeOnTheWebMeansTheNextSessionRecordsANewGrant` compiled but needs a device, for the reason under MOT-49. The decision it relies on is covered by the `ServerConsentTest` unit tests.

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
