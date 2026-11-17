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
