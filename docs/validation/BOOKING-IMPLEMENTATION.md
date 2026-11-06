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
