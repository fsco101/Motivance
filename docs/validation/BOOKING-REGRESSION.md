# In-center booking: final regression and handover

The whole booking feature (S9 to S12, MOT-49 to MOT-70), run together on a freshly reset local stack on 2026-11-07. The design is in [BOOKING.md](../architecture/BOOKING.md), and each issue's evidence is in [BOOKING-IMPLEMENTATION.md](BOOKING-IMPLEMENTATION.md).

**What this is not.** It ran on the local stack with disposable synthetic accounts. It is not clinical validation, a hosted deployment or a test on a physical phone, and no real email or push was sent. What that leaves is in [What has not been proved](#what-has-not-been-proved).

## The run

`supabase db reset` applied all 31 migrations to an empty database, 20 of them from this feature, leaving 0 accounts and 0 bookings. Every suite then ran one after another on commit `9130a68` plus the sign-up demo test, one browser at a time. Only that test, a fix to `PushNotifierTest` described below, and documents changed afterwards, so no application code differs from what ran. Nothing failed in this run, apart from one script that needs an emulator, described below. No test account was left behind.

### What the brief asked to prove

| Area | Where it is tested | Result |
| --- | --- | --- |
| Permissions: each role, 403 and 401 on every `scheduler_` function, no clinical reads, who can mark attendance, phones | `test_booking.py` sections `roles`, `attendance`, `devices` | 184 checks passed |
| Conflict prevention, including concurrent requests: ten patients racing for the last place, one patient asking twice at once, two Schedulers confirming one therapist, two moves into the last place, two weekly courses after the last place | `test_booking.py` sections `bookings`, `self_reschedule`, `series` | 161 checks passed |
| Holiday and closure blocking: availability, resolving each affected booking, all-or-nothing saves, leave, a weekly course meeting each | `test_booking.py` sections `availability`, `calendar`, `time_off`, `series` | 181 checks passed |
| Notifications: who hears what, reminders, the waitlist, one message for a course | `test_booking.py` sections `notifications`, `reminders`, `waitlist` | 127 checks passed |
| Email, through the real queue to Mailpit | `test_email.py` | 64 checks passed |
| Push, against a stub FCM server | `test_push.py` | 30 checks passed |

`series` appears twice above because a weekly course tests both conflicts and closures.

### Every suite

| Suite | Command | Result |
| --- | --- | --- |
| Live API, all 18 sections | `python scripts/test_booking.py` | 749 checks passed |
| Real sends to Mailpit | `python scripts/test_email.py` | 64 checks passed |
| Push against a stub FCM server | `python scripts/test_push.py` | 30 checks passed |
| Database rules | `npx supabase test db` | 69 tests passed |
| Administration, connected workflow, profiles, photos | `test_administration.py`, `test_connected_workflow.py`, `test_patient_profiles.py`, `test_profile_photos.py` | Passed |
| Custom exercises | `python scripts/test_custom_exercises.py` | 34 checks passed |
| Web unit tests | `npm test` | 253 passed |
| Web contract tests | `npm run test:contract` | 159 passed |
| The whole browser suite with axe, one browser at a time | `npx playwright test --workers=1` | 266 passed, 0 failed, in 20.6 minutes. 83 opt-in tests did not run, as designed: 82 design captures and 1 motion measurement |
| Typecheck, lint and production build | `npm run typecheck`, `npm run lint`, `npm run build` | Passed |
| Bundle | `python scripts/check_web_bundle.py` | 296 KB of 300 KB |
| Android unit tests | `gradlew :core:domain:test :core:assessment:test :app:testDebugUnitTest` | 299 passed |
| Android lint and debug build | `gradlew :app:lintDebug :app:assembleDebug` | Passed |
| Administrator parity, resources, module boundaries, sprint sync rules | `check_admin_parity.py`, `check_resources.py`, `check_module_boundaries.py`, `test_sync_sprints.py` | Passed, including 12 sync tests |

### On a throwaway emulator, against the same stack

`test_assignment_delivery.py` needs a device, and none was attached during the browser run, which uses that memory, so it failed to start. It and the other device suites then ran on an API 35 emulator with the final build.

| Suite | Command | Result |
| --- | --- | --- |
| Therapist to patient delivery | `python scripts/test_assignment_delivery.py` | Passed |
| Live role routing | `python scripts/test_role_routing.py` | Passed |
| A real notification on a real Android system | `am instrument -e class com.motivance.data.push.PushNotifierTest` | 5 passed, 8 runs in a row. See below |

`PushNotifierTest` failed at first in about half its runs, on a different test each time. Posting a notification is asynchronous, and the test read the list straight away. The test now waits for the system, so this changed the test and not the app.

### The S12 demo

The demo ran in the browser against the real backend, in `web/tests/e2e/signup.spec.ts`: a visitor opened sign-up, went through its four steps, entered the emailed code, reached the patient workspace and booked a session. The email itself was held back, as explained below. This handover is the rest of the demo.

### Running this again

**Back up the local database first.** It holds more than test accounts. This run found 8 accounts, some of them real addresses, so their data was dumped and each table counted before the reset. Afterwards it was restored, and all 45 tables matched their counts. A plain reset would have lost them.

**Local Auth sends through a real Gmail account.** Any test that signs up for real sends real email. `signup.spec.ts` holds back the send and enters the real code, `auth.spec.ts` does the same for recovery, and `test_local_auth.py` refuses to run at all, so it did not run here.

## What changed

222 files changed since the plan was committed (`bd682f3`).

| Area | Files | New |
| --- | --- | --- |
| Database migrations | 20 | 20 |
| Edge Functions | 6 | 5 |
| Web app | 72 | 49 |
| Android | 49 | 21 |
| Web tests | 32 | 27 |
| Database tests | 3 | 3 |
| Scripts | 6 | 3 |
| Documents | 21 | 6 |
| Sprint records | 4 | 0 |
| Configuration | 9 | 0 |

<details><summary>Database migrations (20)</summary>

- New: `supabase/migrations/202611060001_scheduler_role.sql`
- New: `supabase/migrations/202611060002_center_calendar.sql`
- New: `supabase/migrations/202611060003_bookings.sql`
- New: `supabase/migrations/202611060004_my_bookings.sql`
- New: `supabase/migrations/202611060005_scheduler_requests.sql`
- New: `supabase/migrations/202611060006_my_schedule.sql`
- New: `supabase/migrations/202611060007_calendar_management.sql`
- New: `supabase/migrations/202611060008_therapist_time_off.sql`
- New: `supabase/migrations/202611060009_notifications.sql`
- New: `supabase/migrations/202611060010_email_queue.sql`
- New: `supabase/migrations/202611060011_reminders_and_expiry.sql`
- New: `supabase/migrations/202611060012_schedule_export.sql`
- New: `supabase/migrations/202611060013_schedule_patients.sql`
- New: `supabase/migrations/202611060014_notify_removed_recipient.sql`
- New: `supabase/migrations/202611060015_waitlist.sql`
- New: `supabase/migrations/202611060016_self_reschedule.sql`
- New: `supabase/migrations/202611060017_attendance.sql`
- New: `supabase/migrations/202611060018_weekly_series.sql`
- New: `supabase/migrations/202611060019_scheduler_summary.sql`
- New: `supabase/migrations/202611060020_push.sql`

</details>

<details><summary>Edge Functions (6)</summary>

- Removed: `supabase/functions/.gitkeep`
- New: `supabase/functions/_shared/email.ts`
- New: `supabase/functions/_shared/ics.ts`
- New: `supabase/functions/_shared/push.ts`
- New: `supabase/functions/booking-calendar/index.ts`
- New: `supabase/functions/notification-dispatch/index.ts`

</details>

<details><summary>Web app (72)</summary>

- Changed: `web/src/app/routes.tsx`
- Changed: `web/src/auth/SignInPage.tsx`
- New: `web/src/auth/SignUpPage.tsx`
- Changed: `web/src/auth/roles.test.ts`
- Changed: `web/src/auth/roles.ts`
- New: `web/src/auth/signup.test.ts`
- New: `web/src/auth/signup.ts`
- New: `web/src/components/AppQrCode.tsx`
- Changed: `web/src/components/Dialog.tsx`
- Changed: `web/src/components/StatCard.tsx`
- Changed: `web/src/data/admin.test.ts`
- Changed: `web/src/data/admin.ts`
- New: `web/src/data/booking.test.ts`
- New: `web/src/data/booking.ts`
- New: `web/src/data/calendar.test.ts`
- New: `web/src/data/calendar.ts`
- Changed: `web/src/data/database.types.ts`
- New: `web/src/data/notifications.test.ts`
- New: `web/src/data/notifications.ts`
- New: `web/src/data/patient.test.ts`
- New: `web/src/data/patient.ts`
- New: `web/src/data/schedule.test.ts`
- New: `web/src/data/schedule.ts`
- New: `web/src/data/scheduler.ts`
- Changed: `web/src/features/admin/AccountsView.tsx`
- Changed: `web/src/features/admin/ActivityView.tsx`
- Changed: `web/src/features/admin/AdminOverviewView.tsx`
- Changed: `web/src/features/admin/types.ts`
- New: `web/src/features/booking/AttendanceControl.tsx`
- New: `web/src/features/booking/MonthCalendar.tsx`
- New: `web/src/features/booking/SchedulePage.tsx`
- New: `web/src/features/booking/ScheduleView.tsx`
- New: `web/src/features/booking/SlotPicker.tsx`
- New: `web/src/features/booking/format.ts`
- New: `web/src/features/notifications/NotificationBell.tsx`
- New: `web/src/features/notifications/NotificationsView.tsx`
- New: `web/src/features/notifications/pages.tsx`
- New: `web/src/features/patient/BookSessionView.tsx`
- New: `web/src/features/patient/MyBookingsView.tsx`
- New: `web/src/features/patient/PatientCareView.tsx`
- New: `web/src/features/patient/PatientExercisesView.tsx`
- New: `web/src/features/patient/PatientHomeView.tsx`
- New: `web/src/features/patient/RescheduleView.tsx`
- New: `web/src/features/patient/UseThePhone.tsx`
- New: `web/src/features/patient/pages.tsx`
- New: `web/src/features/scheduler/CalendarDialogs.tsx`
- New: `web/src/features/scheduler/CalendarView.tsx`
- New: `web/src/features/scheduler/ConfirmedScheduleView.tsx`
- New: `web/src/features/scheduler/Pager.tsx`
- New: `web/src/features/scheduler/RequestDialogs.tsx`
- New: `web/src/features/scheduler/RequestsView.tsx`
- New: `web/src/features/scheduler/SchedulerDashboardView.tsx`
- New: `web/src/features/scheduler/WeeklySeriesDialog.tsx`
- New: `web/src/features/scheduler/exportSchedule.ts`
- New: `web/src/features/scheduler/pages.tsx`
- Changed: `web/src/features/therapist/ProgressView.tsx`
- New: `web/src/features/therapist/history.ts`
- Changed: `web/src/features/therapist/pages.tsx`
- Changed: `web/src/gallery/fixtures.ts`
- Changed: `web/src/gallery/routes.tsx`
- Changed: `web/src/landing/LandingPage.tsx`
- Changed: `web/src/layout/Shell.tsx`
- New: `web/src/locales/booking.en.json`
- New: `web/src/locales/booking.fil.json`
- New: `web/src/locales/booking.ts`
- Changed: `web/src/locales/en.json`
- Changed: `web/src/locales/fil.json`
- New: `web/src/locales/landing.en.json`
- New: `web/src/locales/landing.fil.json`
- New: `web/src/locales/landing.ts`
- Changed: `web/src/locales/locales.test.ts`
- Changed: `web/src/motion/RollingNumber.tsx`

</details>

<details><summary>Android (49)</summary>

- Changed: `android/.env.example`
- Changed: `android/app/build.gradle.kts`
- Changed: `android/app/src/androidTest/java/com/motivance/data/local/SessionStoreTest.kt`
- New: `android/app/src/androidTest/java/com/motivance/data/push/PushNotifierTest.kt`
- Changed: `android/app/src/androidTest/java/com/motivance/navigation/LiveRoleRoutingTest.kt`
- Changed: `android/app/src/main/AndroidManifest.xml`
- Changed: `android/app/src/main/java/com/motivance/MainActivity.kt`
- Changed: `android/app/src/main/java/com/motivance/MotivanceApplication.kt`
- Changed: `android/app/src/main/java/com/motivance/data/local/SessionStore.kt`
- New: `android/app/src/main/java/com/motivance/data/push/Push.kt`
- New: `android/app/src/main/java/com/motivance/data/remote/BookingJson.kt`
- Changed: `android/app/src/main/java/com/motivance/data/remote/SupabaseAuthRepository.kt`
- Changed: `android/app/src/main/java/com/motivance/di/AppModule.kt`
- Changed: `android/app/src/main/java/com/motivance/feature/admin/AdminAccounts.kt`
- Changed: `android/app/src/main/java/com/motivance/feature/admin/AdminActivity.kt`
- Changed: `android/app/src/main/java/com/motivance/feature/admin/AdminComponents.kt`
- Changed: `android/app/src/main/java/com/motivance/feature/admin/AdminOverview.kt`
- Changed: `android/app/src/main/java/com/motivance/feature/auth/AuthViewModel.kt`
- New: `android/app/src/main/java/com/motivance/feature/booking/BookingScreens.kt`
- New: `android/app/src/main/java/com/motivance/feature/booking/BookingViewModel.kt`
- New: `android/app/src/main/java/com/motivance/feature/booking/ScheduleScreens.kt`
- New: `android/app/src/main/java/com/motivance/feature/booking/ScheduleViewModel.kt`
- New: `android/app/src/main/java/com/motivance/feature/notifications/NotificationScreens.kt`
- New: `android/app/src/main/java/com/motivance/feature/notifications/NotificationsViewModel.kt`
- Changed: `android/app/src/main/java/com/motivance/navigation/MotivanceApp.kt`
- New: `android/app/src/main/res/drawable/ic_notification.xml`
- Changed: `android/app/src/main/res/values-fil/strings.xml`
- Changed: `android/app/src/main/res/values/strings.xml`
- New: `android/app/src/test/java/com/motivance/data/push/PushRegistrarTest.kt`
- Changed: `android/app/src/test/java/com/motivance/data/remote/AdministrationRepositoryTest.kt`
- New: `android/app/src/test/java/com/motivance/data/remote/BookingRepositoryTest.kt`
- Changed: `android/app/src/test/java/com/motivance/data/remote/SupabaseAuthRepositoryTest.kt`
- Changed: `android/app/src/test/java/com/motivance/feature/auth/AuthViewModelTest.kt`
- New: `android/app/src/test/java/com/motivance/feature/booking/BookingViewModelTest.kt`
- New: `android/app/src/test/java/com/motivance/feature/booking/ScheduleViewModelTest.kt`
- New: `android/app/src/test/java/com/motivance/feature/notifications/NotificationsViewModelTest.kt`
- Changed: `android/app/src/test/java/com/motivance/navigation/WorkspaceNavigationTest.kt`
- Changed: `android/core/domain/src/main/kotlin/com/motivance/domain/Administration.kt`
- New: `android/core/domain/src/main/kotlin/com/motivance/domain/Booking.kt`
- Changed: `android/core/domain/src/main/kotlin/com/motivance/domain/Models.kt`
- New: `android/core/domain/src/main/kotlin/com/motivance/domain/Notifications.kt`
- Changed: `android/core/domain/src/main/kotlin/com/motivance/domain/Rehabilitation.kt`
- New: `android/core/domain/src/main/kotlin/com/motivance/domain/SessionFormat.kt`
- Changed: `android/core/domain/src/test/kotlin/com/motivance/domain/AdministrationTest.kt`
- New: `android/core/domain/src/test/kotlin/com/motivance/domain/BookingTest.kt`
- New: `android/core/domain/src/test/kotlin/com/motivance/domain/ServerConsentTest.kt`
- New: `android/core/domain/src/test/kotlin/com/motivance/domain/SessionFormatTest.kt`
- Changed: `android/core/domain/src/test/kotlin/com/motivance/domain/UserSessionTest.kt`
- Changed: `android/gradle/libs.versions.toml`

</details>

<details><summary>Web tests (32)</summary>

- Changed: `web/tests/contract/admin.test.ts`
- New: `web/tests/contract/attendance.test.ts`
- New: `web/tests/contract/booking.test.ts`
- New: `web/tests/contract/calendar.test.ts`
- New: `web/tests/contract/confirmed-schedule.test.ts`
- New: `web/tests/contract/email.test.ts`
- New: `web/tests/contract/push.test.ts`
- New: `web/tests/contract/reschedule.test.ts`
- New: `web/tests/contract/schedule.test.ts`
- New: `web/tests/contract/scheduler.test.ts`
- New: `web/tests/contract/series.test.ts`
- New: `web/tests/contract/signup.test.ts`
- New: `web/tests/contract/summary.test.ts`
- New: `web/tests/contract/waitlist.test.ts`
- Changed: `web/tests/e2e/admin.spec.ts`
- New: `web/tests/e2e/attendance.spec.ts`
- Changed: `web/tests/e2e/auth.spec.ts`
- New: `web/tests/e2e/booking.spec.ts`
- New: `web/tests/e2e/calendar.spec.ts`
- New: `web/tests/e2e/confirmed-schedule.spec.ts`
- New: `web/tests/e2e/dashboard.spec.ts`
- Changed: `web/tests/e2e/design.spec.ts`
- New: `web/tests/e2e/landing.spec.ts`
- New: `web/tests/e2e/notifications.spec.ts`
- New: `web/tests/e2e/patient.spec.ts`
- New: `web/tests/e2e/reschedule.spec.ts`
- New: `web/tests/e2e/schedule.spec.ts`
- New: `web/tests/e2e/scheduler.spec.ts`
- New: `web/tests/e2e/series.spec.ts`
- New: `web/tests/e2e/signup.spec.ts`
- New: `web/tests/e2e/waitlist.spec.ts`
- Changed: `web/tests/support/stack.ts`

</details>

<details><summary>Database tests (3)</summary>

- New: `supabase/tests/bookings.test.sql`
- New: `supabase/tests/center_calendar.test.sql`
- New: `supabase/tests/scheduler_access.test.sql`

</details>

<details><summary>Scripts (6)</summary>

- Changed: `scripts/seed_local_accounts.py`
- Changed: `scripts/test_administration.py`
- New: `scripts/test_booking.py`
- New: `scripts/test_email.py`
- New: `scripts/test_push.py`
- Changed: `scripts/test_role_routing.py`

</details>

<details><summary>Documents (21)</summary>

- Changed: `docs/PLAN.md`
- Changed: `docs/architecture/ADMIN-PARITY.md`
- Changed: `docs/architecture/BOOKING.md`
- Changed: `docs/architecture/DATABASE.md`
- Changed: `docs/architecture/WEB-DESIGN.md`
- Changed: `docs/operations/DATA-LIFECYCLE.md`
- Changed: `docs/operations/DEVELOPMENT.md`
- Changed: `docs/operations/ENVIRONMENT.md`
- New: `docs/operations/NOTIFICATIONS.md`
- New: `docs/validation/BOOKING-IMPLEMENTATION.md`
- New: `docs/validation/BOOKING-REGRESSION.md`
- Changed: `docs/validation/POST-IMPLEMENTATION-CHECKLIST.md`
- New: `docs/validation/booking-test-results.json`
- New: `docs/validation/email-test-results.json`
- Changed: `docs/validation/patient-profile-backend-results.json`
- Changed: `docs/validation/profile-photo-backend-results.json`
- New: `docs/validation/push-test-results.json`
- Changed: `docs/validation/sprint-03-backend-results.json`
- Changed: `docs/validation/sprint-04-admin-backend-results.json`
- Changed: `docs/validation/sprint-04-history-backend-results.json`
- Changed: `docs/validation/sprint-04-resource-checks.json`

</details>

<details><summary>Sprint records (4)</summary>

- Changed: `sprints/sprint-09.json`
- Changed: `sprints/sprint-10.json`
- Changed: `sprints/sprint-11.json`
- Changed: `sprints/sprint-12.json`

</details>

<details><summary>Configuration (9)</summary>

- Changed: `.github/workflows/database-ci.yml`
- Changed: `README.md`
- Changed: `supabase/.env.example`
- Changed: `supabase/config.toml`
- Changed: `web/.env.example`
- Changed: `web/package-lock.json`
- Changed: `web/package.json`
- Changed: `web/tsconfig.json`
- Changed: `web/vite.config.ts`

</details>

## New settings

Nothing here is needed to build or to run the tests. [NOTIFICATIONS.md](../operations/NOTIFICATIONS.md) has the steps, and [ENVIRONMENT.md](../operations/ENVIRONMENT.md) lists them with the others.

| Variable | Where | Needed for | Status |
| --- | --- | --- | --- |
| `NOTIFICATION_SMTP_PORT` | Edge secrets | Booking email. 465 on a hosted project | To set on a hosted project |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_EMAIL`, `SMTP_SENDER_NAME` | Edge secrets | Booking email. The same Gmail sender as Auth, now given to the Edge Functions too | To set on a hosted project |
| `NOTIFICATION_DISPATCH_SECRET` | Edge secrets | Lets the scheduled job call `notification-dispatch` | To set on a hosted project |
| `notification_dispatch_secret`, `notification_dispatch_url` | Vault | The same secret and the function's address. Until both exist the job does nothing | To set on a hosted project |
| `PUBLIC_SITE_URL`, `PUBLIC_FUNCTIONS_URL` | Edge secrets | Links in emails, and where calendar links point | To set on a hosted project |
| `FCM_SERVICE_ACCOUNT` | Edge secrets | Sending push. A secret | The owner adds it |
| `FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID`, `FIREBASE_API_KEY`, `FIREBASE_SENDER_ID` | `android/.env` | Push in the app. Public values, and all four are needed | The owner adds them |
| `VITE_ANDROID_APP_URL` | `web/.env` | The store link and QR code | When the app has a public address |
| `FCM_API_URL` | Edge secrets | Tests only: points the dispatcher at a stub | Leave unset |

## What has not been proved

[The follow-up checklist](POST-IMPLEMENTATION-CHECKLIST.md) lists every deferred check, and none is claimed as passed. The ones that matter most before real patients use this:

- **Nothing has run on a hosted project.** That includes the migrations, the Edge Functions, the scheduled jobs and port 465.
- **No real email has been sent** through the booking queue or web sign-up. Mailpit proves the content and the queue.
- **No real push has been sent.** No Firebase project exists, so no real token has been issued. The stub proves what the server sends, and the emulator proves what the app does with a message, but not the join between them through Google.
- **No physical phone has been used** for any of this, nor large text sizes or TalkBack.
- **No Scheduler, therapist or patient has used it.** The Filipino text has not been reviewed by a speaker.
- **The seeded center details are placeholders,** and retention for booking data awaits the owner's approval.

Two sprints outside booking are still open, and this does not change them: S5 (final validation and release, MOT-25 to MOT-30) and two issues in S8 (MOT-47 and MOT-48).
