# Camera exercise on the web

Epic #142, started 2026-11-19. The web app gets the camera exercise, with the same features and the same results as Android, built with the current web release of MediaPipe and the browser's own tools. This record grows as each issue lands. It holds unit and browser evidence only; nothing here is a clinical validation, and real-device checks are deferred to [POST-IMPLEMENTATION-CHECKLIST.md](POST-IMPLEMENTATION-CHECKLIST.md).

## #135 The same measuring engine on both apps

**Decision.** The issue proposed a TypeScript port held to shared test cases, rather than compiling `:core:assessment` to JavaScript with Kotlin Multiplatform. The owner said to start implementing on that proposal. The engine is about 320 lines, so a port keeps the web build free of a Kotlin toolchain.

**What was built.**

- `web/src/features/exercise/assessment/`: the TypeScript copy of `MovementAssessment`, `JointAngles`, `MeasurementOverlay` (protractor), `RepetitionGuide`, `RepetitionOutcome`, `CameraDiagnostics`, `PerformancePolicy` and `PreviewMapping`, with the `ExerciseRules` defaults and validation from `:core:domain`. Kotlin keeps landmarks and some arithmetic in 32-bit floats, so the port rounds the same way (`Math.fround`) wherever a decision depends on it, and uses Java's degree and radian constants.
- `shared/assessment/cases.txt`, written by `scripts/generate_assessment_cases.py`: 1,859 commands covering:
  - every built-in and custom joint (elbow, shoulder, wrist, hip, knee and ankle) on both sides;
  - prescribed thresholds, the hold, and incomplete, too-fast and timed-out repetitions;
  - jitter, a one-frame spike and fast-movement outliers;
  - no person, two people, low visibility, out of frame, not-a-number coordinates, too few landmarks, trunk lean and an upside-down or flattened trunk;
  - loss of tracking at the target, a gap of more than a second, stale frames, pause and resume, restoring a saved session, start refusals, wide and tall frames;
  - a slow half-degree sweep through every threshold;
  - frames just either side of the lean, torso, confidence, frame-edge and speed limits;
  - the angle helper, preview mapping, diagnostics and frame policy.
- `shared/assessment/expected.txt`: the Kotlin engine's answer to each command, written by `SharedCasesTest` with `UPDATE_SHARED_CASES=1`. Each answer covers the snapshot, the repetition guide, the outcome and the protractor.
- `sharedCases.test.ts` replays the same commands through the web engine and requires each answer to match. Numbers may differ by at most a millionth (relative); everything else must be identical.
- Both CI workflows now also run when either engine, the cases or the generator changes, and both run `generate_assessment_cases.py --check`.

## Executed checks

| Check | Command | Result |
| --- | --- | --- |
| Kotlin engine against shared answers | `.\gradlew.bat :core:assessment:test --tests SharedCasesTest` | Pass |
| Web engine against shared answers | `npx vitest run --project unit src/features/exercise/assessment` | 2 of 2: 1,859 answers, all matching |
| A rule changed only on the web fails | 12 one-line changes to the web engine: the rest threshold, torso height, trunk lean, confidence, frame edge, speed, hold, timeout, median filter, start window and the degrees constant | Each failed the web test; restored afterwards |
| A rule changed only on Android fails | `lowDegrees+5` changed to `+4` in `MovementAssessment.kt` | `SharedCasesTest` failed at answer 885; restored with `git checkout` |
| Android engine and domain | `.\gradlew.bat :core:assessment:test :core:domain:test` | Pass |
| Web | `npm run typecheck`, `npm run lint`, `npm test` | 0 errors; 0 warnings; 26 files, 318 tests passed |
| Boundaries and parity | `python scripts/check_module_boundaries.py`, `python scripts/check_admin_parity.py` | Pass; no administrator change |
| Cases match their generator | `python scripts/generate_assessment_cases.py --check` | Up to date |

The first two mutation attempts (the rest threshold and torso height) passed before the limit frames and the sweep were added. That showed the first case set had gaps between thresholds. Both are caught now.
