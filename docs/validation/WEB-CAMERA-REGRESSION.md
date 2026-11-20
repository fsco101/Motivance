# Web camera exercise: regression and validation record (#141)

Epic #142, run on 2026-11-20 on the development laptop (Windows 11, Intel UHD Graphics). This record says what was run and what passed. It makes **no clinical-accuracy claim**: every measurement below comes from a drawn figure, not from a person. Checks with real people, browsers, devices and therapists are listed at the end. They are in [POST-IMPLEMENTATION-CHECKLIST.md](POST-IMPLEMENTATION-CHECKLIST.md) and have **not** been run.

The build-up of each feature is in [WEB-CAMERA-EXERCISE.md](WEB-CAMERA-EXERCISE.md).

## The recorded exercise

The repository has no video of a real person, so the regression uses a recording that is drawn the same way every time (`web/tests/support/exerciseVideo.ts`). The model person from the exercise guide does elbow flexion:

- 1.5 seconds at rest;
- three repetitions from 5° to 125°, each 0.8 s up, a 0.5 s hold, 0.8 s down and 0.7 s rest;
- then the same with the right arm toward the camera.

That makes 21 seconds and 630 frames at 640×480 and 30 frames a second. They are written as JPEG frames, and as a `.y4m` that Chrome's fake camera plays in a loop. The files go to `web/test-videos/`, which git ignores.

Real MediaPipe finds the figure as one person, with visibility close to 1. It reads the drawn angle roughly: a drawn 90° reads about 73°, and a drawn 150° about 139°. That is why the figure bends to 125°, well past the 90° target. These numbers show that the two apps agree with each other on identical frames. They say nothing about either app's accuracy on a real body.

Chrome's fake camera would not open an `.mjpeg`, so the feed is `.y4m`. Headless Chromium draws in software unless told otherwise. There, MediaPipe ran at 1.1 FPS with p95 1,023 ms, and the engine treated every gap as lost tracking. The regression therefore starts Chromium with `--ignore-gpu-blocklist --enable-gpu --use-angle=d3d11`, so it uses the laptop's graphics chip as a patient's browser would.

## Results

### Full session in the browser with real MediaPipe

`npx playwright test recorded-exercise --workers=1`: 4 of 4.

| Step | Result |
| --- | --- |
| Camera check | Tracking ready. 13.3 FPS, p95 66 ms, on the graphics chip |
| Both-sides session (prescribed 20° to 90°, 2 repetitions a side, untimed) | Start; the left side ends at its target; the countdown runs; the right side starts once its arm is tracked; 2 of 2; Finish. 12.9 FPS, p95 93 ms during the session |
| Saved | Two sessions, `client = web`. Left: 2 repetitions, range 106.2°. Right: 2 repetitions, range 110.3° |
| History | The exercise is listed in the patient's Progress |
| axe (WCAG 2.1 A and AA) | No violations on the live session |

### The same frames on the web and on Android

The two runs worked as follows:

- **Web:** offline in the browser, in the test above. MediaPipe `@mediapipe/tasks-vision` 1.2.3 ran in a Worker on the graphics chip, followed by the TypeScript engine.
- **Android:** `RecordedExerciseTest` on a throwaway Android 15 emulator (`motivance_verify`, x86_64). MediaPipe `tasks-vision` 0.10.21 ran on the processor, with the app's own model, settings and landmark confidence (`CameraPrototype`), followed by the Kotlin engine.

Both runs used the same rules (20° to 90°, 0.1 s hold, 0.6 to 30 s per repetition) and the same timestamps. `python scripts/compare_recorded_exercise.py` drives the Android half and compares the two.

The criteria were set before the first run, from the project's provisional gates in `SPRINT-01-PROTOCOL.md`:

- the same count on each side;
- session range within 5°;
- a mean absolute elbow-angle difference of at most 5° on frames both apps measured.

| Side | Web count / range | Android count / range | Range gap | Angle difference, mean (worst) | Frames both measured | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Left | 3 / 108.7° | 3 / 109.2° | 0.48° | 0.91° (4.67°) | 310 of 630 | Pass |
| Right | 3 / 109.9° | 3 / 107.0° | 2.91° | 1.31° (3.64°) | 310 of 630 | Pass |

Each side is measured on the 310 frames where its arm faces the camera. On the other frames both apps found the arm too poorly visible, and neither measured it. No repetition went uncounted on either app.

The remaining differences come from the two MediaPipe releases, the graphics chip against the processor, and JPEG decoding. The engines themselves give identical answers on identical landmarks (below).

### Performance spot check

This was measured with the same laptop, recording and tracking path as above: real MediaPipe in a Worker on the graphics chip, a fake camera, and no page drawing. The provisional gate is median ≤ 150 ms and p95 ≤ 250 ms.

| Renderer | Frames in 30 s | FPS | Median latency | p95 latency | Result |
| --- | --- | --- | --- | --- | --- |
| Intel UHD Graphics (Direct3D 11) | 506 | 17.3 | 35.5 ms | 43.7 ms | Pass |

393 camera frames arrived while the previous one was still being tracked and were skipped, by design: the newest frame always wins (#134). For comparison, the same run on software graphics managed 1.3 FPS with p95 860 ms. A patient's browser without a usable graphics chip would be told tracking is slow.

While recording a video (#139), the session held 19.5 FPS before recording and 19.8 during it, with the scripted body. With speech on (#138), the cue path never touches the frame loop. Neither has been measured with real MediaPipe on real hardware.

## Shared engine and existing suites

| Suite | Command | Result |
| --- | --- | --- |
| Shared engine cases, Kotlin | `.\gradlew.bat :core:assessment:test --rerun` | 55 of 55, including `SharedCasesTest`'s 1,859 answers |
| Shared engine cases, web | `npx vitest run --project unit src/features/exercise/assessment` | 2 of 2: all 1,859 answers match |
| Cases match their generator | `python scripts/generate_assessment_cases.py --check` | Up to date |
| Android domain and app unit tests | `.\gradlew.bat :core:domain:test --rerun :app:testDebugUnitTest --rerun` | 123 of 123; 400 of 400, 1 skipped |
| Android instrumented tests | Not rerun in full: no Android app code changed in #134 to #141. `RecordedExerciseTest` is the only new instrumented test, and it ran as above | Not rerun |
| Web unit tests, lint, types, build | `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` | 35 files, 406 tests; 0 warnings; 0 errors; built |
| Web contract tests | `npm run test:contract` | 26 files, 252 passed, 3 skipped |
| Web browser suite | `npx playwright test --workers=1` | **Not complete.** The system stopped the full run for low memory. Its 73 failures were all crashes (worker exit `3221225794` or "Target crashed"), with no failed assertion. Run alone: `exercise-session`, `exercise-video`, `recorded-exercise`, `camera-check`, `camera-blocked`, `pose-tracking`, `patient-today`, `landing` and `patient` pass. The full suite still needs a clean run on a machine with free memory before #141 is closed |
| Repository checks | `check_admin_parity.py`, `check_module_boundaries.py`, `check_pose_model.py` | Pass |
| Bundle | `python scripts/check_web_bundle.py` | 327 KB against a 300 KB budget: the overage that existed before #134, unchanged |

**axe** covers every new screen at phone and desktop width:

- the camera check (`camera-check.spec.ts`, 390 and 1280 px);
- the session's preview and live states (`exercise-session.spec.ts`, 390 and 1280 px; `recorded-exercise.spec.ts`);
- the recording agreement and the video result page (`exercise-video.spec.ts`, 390 and 1280 px);
- the reworded landing page in both languages (`landing.spec.ts`).

The celebration screen is passed through by the session tests but not scanned on its own.

## Not run (in the checklist)

- Real laptops with and without a graphics chip.
- Chrome, Edge, Firefox and Safari on desktop.
- Chrome on an Android phone and Safari on an iPhone.
- A 15-minute session for FPS, latency, memory and heat.
- A real person, recorded once and played through both apps in place of the drawn figure.
- A therapist comparing web and phone results for the same patient movement.
