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
