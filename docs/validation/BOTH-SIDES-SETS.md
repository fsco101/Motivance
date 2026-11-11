# Both-sides sets and a time per side

Date: 2026-11-11. Local-stack, emulator and browser engineering evidence only. No physical-phone, therapist or patient check was executed, and nothing here is a clinical validation. The deferred checks are in [POST-IMPLEMENTATION-CHECKLIST.md](POST-IMPLEMENTATION-CHECKLIST.md#both-sides-sets-and-a-time-per-side-2026-11-11).

Design: [spec](../superpowers/specs/2026-11-11-bilateral-timed-sets-design.md). Plan: [implementation plan](../superpowers/plans/2026-11-11-bilateral-timed-sets.md).

## What was added

- **Therapist, on Android and the web.** The side choice is Left, Right or Both. A "Set a time" switch adds a time stepper next to the repetitions: 15-second steps from 0:15 to 30:00, starting at 1:00. It reads "Time" for one side and "Time per side" for Both. The plan, the review panel and the patient's exercise list show "Both sides" and the time.
- **Patient, on Android.** Both runs left, then right. With a time, the session screen shows the time left. Reaching the target with time left is announced once ("Target reached. Keep going until the time is up."), and measuring continues. When the time runs out, or at the target for an untimed left side, the side is saved as its own session. The voice announces the next side, then counts down from 5. A Pause button holds the countdown until Start. The right side starts on its own when tracking is ready, under the consent given at the first Start. The last side ends with "Exercise complete." The results screen lists each side.
- **Server.** Migration `202611110001_bilateral_sets.sql` accepts `bilateral` and `side_seconds`, checks each side's upload, and stores the measured side. See [DATABASE.md](../architecture/DATABASE.md#both-sides-sets-and-a-time-per-side).
- **History.** Filtering by side matches the side measured, in both apps. The web progress table shows each session's measured side.

## Executed checks

| Area | Command | Result |
| --- | --- | --- |
| Server rules | `python scripts/test_bilateral_sets.py` | 19 checks passed |
| Server regression | `python scripts/test_custom_exercises.py` | 34 checks passed; its emulator part was skipped (no emulator attached at that moment) |
| Server regression | `npx --yes supabase@2.20.12 test db` | 5 files, 99 tests, PASS |
| Android domain | `.\gradlew.bat :core:domain:test` | 83 tests, 0 failures (includes `SideSetTest` 11 and `SecondsTest` 5) |
| Android assessment | `.\gradlew.bat :core:assessment:test` | 54 tests, 0 failures |
| Android unit | `.\gradlew.bat :app:testDebugUnitTest` | 200 tests, 0 failures (includes cache, publish, history-filter, `SetCueLinesTest` and the web-published fixture) |
| Android lint | `.\gradlew.bat :app:lintDebug` | Passed |
| Android resources | `python scripts/check_resources.py` | 956 strings per language, format parity and contrast passed |
| Android editor (emulator) | `BothSidesEditorTest`, `PrescribedFocusTest` | 6 tests OK |
| Android set run (emulator) | `ExerciseSetTest` | 6 tests OK: left then right with two sessions under one consent and prescription; the 6-second announcement fallback; Pause holds the countdown until Start; withdrawn consent stops the next side without a new grant; cues are not replayed; Finish during the countdown ends the set |
| Android regression (emulator) | All instrumented tests except the four `Live*` classes | 111 of 112 passed. `PushNotifierTest.twoMessagesAreTwoNotifications` failed once in the full run and passed when run alone, twice (5 of 5). This branch does not touch the push code. |
| Web types and lint | `npm run typecheck`, `npm run lint` | Clean |
| Web unit | `npm test` | 20 files, 270 tests passed |
| Web contract | `npm run test:contract` | 16 files, 161 tests passed; then `queries` and the regenerated `crossApp` fixture, 17 passed |
| Web browser | `npx playwright test therapist.spec.ts patient.spec.ts --workers=1` | 31 passed |
| Web browser, full | `npx playwright test --workers=1` | 270 passed, 0 failed; 83 skipped are the opt-in design-capture and motion-measuring tests |
| Web build | `npm run build` | Built; `python scripts/check_web_bundle.py` 296 KB of 300 KB initial JavaScript |
| Parity and sprints | `python scripts/check_admin_parity.py`, `python scripts/sync_sprints.py --validate-only` | Passed; no administrator function changed |

Emulator runs used a throwaway AVD (`motivance_verify`, `emulator-5560`), never a working emulator.

## Not executed

- The four `Live*` Android classes, which need a signed-in local account on the emulator.
- Every physical-phone, therapist and patient check, listed in the follow-up checklist.
- Hosted rollout: the migration is applied only to the local stack.

## Rollout notes

- Apply `202611110001_bilateral_sets.sql` to the hosted project before publishing the web app, because the web editor sends `bilateral` and `side_seconds`.
- Older installed Android builds skip `bilateral` prescriptions, because their decoder accepts only `left` and `right`. An older build does show a single-side plan with a time, but it runs it without the time and records no `sideSeconds`, so the server rejects that upload as not matching the plan. Patients must update the app before a therapist gives them a Both plan or a time. No Android release has been distributed yet (issue #29), so no installed build is affected today.
- Untimed single-side plans keep working on every build.
- The app being killed during the 5-second countdown ends the set after the saved side. Starting the exercise again begins from the left side.

## Known limits

- Each side is an ordinary session, so screens that summarise a patient's latest session show the most recent side, not the pair.
- The countdown and auto-start follow the engine's tracking-ready signal; how long a patient needs to reposition for the other side is unmeasured (follow-up checklist).
