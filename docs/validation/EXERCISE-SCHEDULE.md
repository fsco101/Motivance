# Exercise schedules

Epic #124. Local-stack, emulator and browser engineering evidence only. No physical-phone, therapist or patient check was executed, and nothing here is a clinical validation. Deferred checks go to [POST-IMPLEMENTATION-CHECKLIST.md](POST-IMPLEMENTATION-CHECKLIST.md).

Design: [spec](../superpowers/specs/2026-11-17-exercise-schedule-design.md). Server rules: [DATABASE.md](../architecture/DATABASE.md#exercise-schedules).

## #125: date range, rest days and today's exercises on the server (2026-11-17)

Migration `202611170004_exercise_schedules.sql` adds `exercise_schedules`, `exercise_assignments.schedule_id` and the functions `save_exercise_schedule`, `publish_scheduled_prescription`, `stop_exercise`, `end_exercise_schedule` and `exercise_day`. The web data layer is `web/src/data/exerciseSchedule.ts`.

| Acceptance criterion | Evidence |
| --- | --- |
| Only an actively linked therapist can save, change and end a set; any other caller is refused | `exercise-schedule.test.ts`: "lets only a linked therapist save…", "ends a started schedule today…", "keeps an edited exercise in its schedule…" (another therapist, even once linked, and the patient get `42501`) |
| The day function returns the right state before the start, on an exercise day, a weekly rest day, a dated rest day, the last day and after the end | "tells each day apart…" |
| A session today marks the exercise done for today only | "marks an exercise done for today only…" |
| A both-sides exercise is done only once both sides are completed | "counts a both-sides exercise done only once both sides are finished" |
| Day boundaries follow the center's time zone around midnight | "counts days at the center, which turns at midnight in Manila" (15:59:59Z and 16:00:00Z) |
| Plans without dates behave exactly as before | "keeps an exercise without a schedule as before: due every day"; the full contract suite still passes unchanged |
| `DATABASE.md` and `PLAN.md` describe the new tables and functions | `docs/architecture/DATABASE.md#exercise-schedules`, `docs/PLAN.md` |

Also covered: days already past are never rewritten ("never rewrites days already past"), one exercise can be taken off the plan ("takes one exercise off the plan…"), and the day and the table are readable only by the patient and their linked therapists ("shows a day to the patient and their linked therapist only").

| Check | Command | Result |
| --- | --- | --- |
| Migration | `npx --yes supabase@2.20.12 migration up --local` | Applied without a reset |
| Schedule contract | `npx vitest run --project contract tests/contract/exercise-schedule.test.ts` | 12 tests passed |
| Full contract regression | `npm run test:contract` | 23 files, 232 passed, 3 skipped by design |
| Web unit | `npm test` | 312 passed (includes `exerciseSchedule.test.ts`, 6) |
| Web types and lint | `npm run typecheck`, `npm run lint` | Clean |

**Not done in #125:** the hosted database does not have this migration yet. Apply it before redeploying the web app.

## #126: assign a set of exercises with a date range and rest days, on the web and Android (2026-11-17)

- **Web.** The patient record lists each current or coming schedule with its dates, today's state, the exercise and rest days, the days left, its rest days and its exercises, each marked "Done today", "To do today" or "Not today". "New schedule" and "Change dates" open a form with a start and end date, weekday toggles and rest dates, which counts the days and says what is wrong before saving. "Add exercise" opens the assignment editor inside that schedule, and its review panel names the schedule. An exercise can be removed, and a schedule ended, each after a confirmation that names the patient. Exercises without a schedule keep their own "Every-day exercises" panel; ones left in an ended schedule are listed apart. Another therapist's schedule shows who set it and offers no changes.
- **Android.** The same on the therapist's patient screen (`ScheduleScreens.kt`), with the form on its own page (`PLAN_SCHEDULE`). The day rules are mirrored in `core/domain` (`ScheduleRules`). The date field gained an allowed range, so the pickers only offer days the schedule can use.

| Acceptance criterion | Evidence |
| --- | --- |
| On both apps a therapist can create a set of two or more exercises with a start date, an end date and rest days, and see it on the patient record | Web: `tests/e2e/exercise-schedule.spec.ts` (save with a rest weekday and date, add an exercise into it). Android: `ExerciseScheduleTest` (form saves dates and rest weekdays; record lists the schedule with its exercises and today's state); `ScheduleRepositoryTest` (calls and fields) |
| An end before the start, a start in the past, or a range with no exercise day is refused with a clear message | Web: "the form says what is wrong…", `exerciseSchedule.test.ts`; Android: `ScheduleRulesTest`, `ExerciseScheduleTest.theFormRefusesAWeekWithNoExerciseDay`; server: `exercise-schedule.test.ts` |
| Changing dates or rest days applies from the next load; past days are not rewritten | Web: "changing the dates of a started schedule keeps its start"; Android: `aStartedScheduleKeepsItsStartDate`; server: "never rewrites days already past" |
| Ending a set early removes it from the patient's list from the next day | Web: "ending a started schedule ends it today"; Android: `endingAndRemovingAskFirstAndNameThePatient`; server: "ends a started schedule today…" |
| The web pages pass axe, and every string exists in English and Filipino | Axe on the form (WCAG 2.1 AA, no violations after the weekday buttons were given their full names); `locales.test.ts`; `python scripts/check_resources.py` (1307 strings per language, format parity) |

| Check | Command | Result |
| --- | --- | --- |
| Web schedule flow | `npx playwright test tests/e2e/exercise-schedule.spec.ts --workers=1` | 9 passed |
| Web regression touching the record | `npx playwright test tests/e2e/therapist.spec.ts tests/e2e/therapist-caseload.spec.ts tests/e2e/design.spec.ts tests/e2e/chat-cards.spec.ts --workers=1` | 125 passed, 1 skipped by design (motion timing, run on demand) |
| Web unit, types, lint | `npm test`, `npm run typecheck`, `npm run lint` | 312 passed; types and lint clean |
| Android domain and app unit | `.\gradlew.bat :core:domain:test :app:testDebugUnitTest` | 118 and 284 tests, 0 failures (includes `ScheduleRulesTest` 5, `ScheduleRepositoryTest` 5) |
| Android lint | `.\gradlew.bat :app:lintDebug` | 0 errors; no warning in the changed files |
| Android screens (emulator, Pixel 6, API 35) | `connectedDebugAndroidTest` for `ExerciseScheduleTest` and `ProfilePhotoPreparationTest` | 10 of 10 passed |

`ProfilePhotoPreparationTest` had not compiled since photos moved to Supabase Storage (39bdb88), which stopped every Android device test from building. It now runs the app's current steps (`loadPhoto`, then `encodePhoto` on the centred square) with the marker positions recomputed for the 384 px picture.

**Not done:** physical-phone and therapist checks, in the checklist.

## #127: the patient sees today's exercises, and a finished one is gone until its next day (2026-11-17)

- **Server.** Migration `202611170005_exercise_day_reminders.sql`: the daily practice reminder is sent only when an exercise due today is still to do. It is never sent on a rest day, before a schedule starts or after it ends, and it stops once everything due today is done.
- **Web.** The patient's Exercises page and home list only today's exercises, with "Done today: 1 of 2" when there is more than one. When nothing is left, they say "All done for today" and name the next exercise day, or "Rest day", "Your schedule has not started", or "No exercises planned". The lists refresh when the page comes back into view (`planForToday`).
- **Android.** Each cached exercise also stores its schedule (Room version 5, migration `FROM_4_TO_5`), so today's list works offline. An exercise is done when the server says so, or when this phone finished it today, counting sessions still waiting to upload; a both-sides exercise needs both sides. Days count in Manila whatever the phone's zone (`patientToday`, `TodayPlanner`).

| Acceptance criterion | Evidence |
| --- | --- |
| On an exercise day the patient sees exactly that day's exercises; on a rest day none, with the rest-day message | Web: `tests/e2e/patient-today.spec.ts` ("today lists the exercises due…", "a rest day says so…"); `exerciseSchedule.test.ts`. Android: `PatientTodayTest`, `TodayPlannerTest`, `PatientTodayScreenTest` |
| Finishing an exercise removes it from today's list on Android at once, and on the web at the next load | Web: "an exercise finished on the phone leaves the list at the next load". Android: `PatientTodayTest.aSessionFinishedHereTodayTakesTheExerciseOffTheList` (the list is built from the phone's own sessions as they are saved) |
| On the next exercise day it appears again | Server: `exercise-schedule.test.ts` "marks an exercise done for today only…"; Android: `TodayPlannerTest`; web: "once every exercise is done, the page says so and names the next day" |
| A session finished offline still removes the exercise from today's list | Android: `PatientTodayTest` (local sessions count whether or not they are uploaded; `theServerCountsSessionsFromOtherPhones` covers the other direction) |
| No practice reminder on a rest day or after today's exercises are done | `exercise-schedule.test.ts` "sends the practice reminder only on a day with an exercise still to do"; `python scripts/test_care_notifications.py` (62 checks) |
| Every new string exists in English and Filipino | `locales.test.ts`; `python scripts/check_resources.py` (1317 strings per language) |

| Check | Command | Result |
| --- | --- | --- |
| Server and contract | `npm run test:contract` | 23 files, 234 passed, 3 skipped by design (includes the schedule suite, 14) |
| Care notification checks | `python scripts/test_care_notifications.py` | 62 passed |
| Web patient flows | `npx playwright test tests/e2e/patient.spec.ts tests/e2e/patient-today.spec.ts --workers=1` | 17 passed |
| Web gallery, patient pages | `npx playwright test tests/e2e/design.spec.ts --grep patient --workers=1` | 23 passed |
| Web unit, types, lint | `npm test`, `npm run typecheck`, `npm run lint` | 316 passed; clean |
| Android domain and app unit | `.\gradlew.bat :core:domain:test :app:testDebugUnitTest` | 123 and 291 tests, 0 failures |
| Android lint | `.\gradlew.bat :app:lintDebug` | 0 errors, 147 warnings, as before |
| Android device tests (emulator, Pixel 6, API 35) | `PatientTodayScreenTest`, `ConnectedPersistenceTest` (with the version 4 to 5 migration), `ExerciseScheduleTest` | 18 of 18 passed |

Two older checks were brought up to date. `test_care_notifications.py` expected a patient who did one of two exercises not to be reminded, which #127 changes on purpose. It also left out the `messages` switch that care chat added on 2026-11-15, so it had been failing since then.

**Not done:** physical-phone checks, in the checklist.
