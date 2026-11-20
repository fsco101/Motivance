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

## #134 Pose tracking in the browser

**What was built** (`web/src/features/exercise/pose/`):

- **Runtime.** `@mediapipe/tasks-vision` 1.2.3, the newest stable web release on 2026-11-19, pinned exactly. Android's `0.10.21` is a separate Android library with its own numbering. MediaPipe's Apache-2.0 licence covers the web runtime.
- **Model.** The same lite pose model as Android (`float16/1`), copied to `models/pose_landmarker_lite.task`. Both copies are recorded in `docs/validation/pose-model.json`, and `scripts/check_pose_model.py` (in both CI workflows) fails if either differs. The model licence review is still pending, as on Android.
- **Served from the app.** Vite emits the runtime and the model as hashed files under `/assets/`, and `web/vercel.json` caches `/assets/` for a year, so they download once.
- **The settings that change results match Android:** video mode, up to two people, and MediaPipe's default 0.5 thresholds. A landmark's confidence is the lower of visibility and presence, as on Android.
- **Where detection runs.** A module worker on the graphics chip. A browser that can only use the graphics chip on the page's thread uses that; otherwise the worker runs on the processor (`choose.ts`). The worker gets each frame as a transferred `ImageBitmap` and sends it back with its landmarks, so the picture drawn is the frame that was measured.
- **Frame handling.** `FrameLoop` runs from `requestVideoFrameCallback`, keeps only the newest frame (`LatestFrameGate`), and gives each frame a later timestamp than the last. It skips results more than a second old and pauses while the tab is hidden, in place of Android's heat pause. Its FPS and p95 diagnostics and its slow-camera rule are the shared `CameraDiagnostics` and `PerformancePolicy`.
- **Loading.** `preparePoseTracking()` starts as soon as the camera check opens, warms up with one blank frame, and is kept for the visit.
- **Statistics are refused.** MediaPipe's web runtime posts usage statistics (task type and timings, not images) to `odml.pa.googleapis.com` every minute and when it closes. The worker refuses every request that is not to the app's own address, and the page thread refuses that one address (`offOrigin.ts`). In the browser runs below, MediaPipe tried to send statistics in some runs, and each time it was refused.
- **Unsupported browsers.** A browser without a secure page, camera access, WebAssembly or image bitmaps gets the "use the phone" suggestion (`support.ts`).

**Bug found by the browser test.** The worker's warm-up frame came from a canvas with no drawing context, which Chromium rejects. That made the worker fail, and tracking moved to the page thread. The test now requires the worker on Chromium.

| Check | Command | Result |
| --- | --- | --- |
| Frame gate, frame loop, landmarks, request guard, browser support, host choice | `npx vitest run --project unit src/features/exercise/pose` | 21 of 21 |
| Real MediaPipe in Chromium, fake camera | `npx playwright test tests/e2e/pose-tracking.spec.ts --workers=1` | Pass: worker on the graphics chip, 30 frames at 640×480, about 2 FPS (software graphics), p95 about 450–600 ms, 235–299 frames dropped rather than queued, no request to any other address |
| Production build | `npm run build`, then the built files were inspected | Runtime, worker and model are files under `/assets/`; the only outside address in them is the statistics address the guard refuses |
| Model copies | `python scripts/check_pose_model.py` | Both match `59929e1d1ee9…`; a changed copy fails |

**Not run:**

- Comparing the web and Android landmarks for the same recorded video. No recording of a person exists in the repository.
- Real devices and browsers.

Both are in the checklist.

## #136 Camera check and live skeleton screen

**What was built.**

- **Page.** `/patient/camera-check` (`CameraCheckPage.tsx`), opened from Camera positioning check on Exercises. It follows Android's setup checklist, live camera with demo rules, and "nothing recorded" summary. Nothing is measured or saved.
- **Camera** (`useCamera.ts`). It asks for 640×480 to match Android. It explains a blocked, missing, busy or unusable camera. When a blocked camera is allowed in site settings, it starts by itself through the Permissions API. Switch camera moves between cameras. A camera facing the patient, or one that doesn't report its direction, as laptop webcams usually don't, is mirrored.
- **Drawing** (`stage.ts`). Android's skeleton, focus ring, torso tint, brackets and protractor are drawn on one canvas from the frame that was tracked, with the same colours, widths and 48-pixel protractor minimum, through the shared `previewMapping`.
- **Readouts** (`CameraStage.tsx`). Android's angle gauge, repetition steps, metric tiles, rule summary and legends are React components on the web's night tokens. The quality message, the repetitions and the active step are announced politely; the angle is not announced on every frame.
- **Text.** English and Filipino strings in `locales/exercise.*.json`, taken from Android's wording with "phone" changed to "device" or "browser" where it applies. They load with the camera page, not with the first download.

| Check | Command | Result |
| --- | --- | --- |
| Helpers: visible landmarks, when to draw the body, durations, camera errors, mirroring | `npx vitest run --project unit src/features/exercise/camera` | 6 of 6 |
| From Exercises to the summary, live camera, quality message, diagnostics, gauge, axe at 390 and 1280 px | `npx playwright test tests/e2e/camera-check.spec.ts --workers=1` | Pass |
| Skeleton drawn on the right joints, mirrored and not | same file | Pass: shoulder, forearm and wrist pixels are the focus colour; the mirrored side is empty |
| Blocked camera explained, then starting once allowed, axe | `tests/e2e/camera-blocked.spec.ts` | Pass. The browser's answers are simulated, because headless Chromium has no permission prompt |
| Text parity | `npx vitest run --project unit src/locales` | 7 of 7, including the new bundle |
| Web | `npm run typecheck`, `npm run lint`, `npm test`, gallery `design.spec.ts` | 0 errors; 0 warnings; 29 files, 344 tests; 84 of 84 |

**Existing problem, not caused by this work.** `python scripts/check_web_bundle.py` reports 327 KB of initial JavaScript, against a 300 KB budget. The last commit before the camera screen, which had no camera code in the first download, gives the same 327 KB. The camera page adds only its breadcrumb label to the first download. This needs its own fix.

## #137 A full exercise session on the web

**What was built.**

- **Start.** Start exercise on Home and on Exercises opens `/patient/exercises/:versionId/session`. A browser that cannot run the camera still gets the "use the phone" suggestion. Only the assignment's newest prescription version can be measured, as on the phone. Any other address says the exercise is no longer assigned.
- **Rules** (`session/rules.ts`). The prescription is read exactly as Android's `PrescriptionCache` reads it: the same kinds, measurement conventions, defaults and refusals. A web test reads the same server fixture Android's `WebPublishedPrescriptionTest` reads, and gets the same rules.
- **The run** (`session/controller.ts`, from `ExerciseSessionViewModel`):
  - consent is recorded at the first Start, through `record_consent`, and used for the whole run;
  - Start is refused while tracking isn't ready;
  - Pause and Resume keep the same session;
  - a hidden tab pauses measuring and holds a countdown;
  - demo rules are never recorded.
- **Both-sides sets** (`session/sideSet.ts`). This is a port of `SideSet.kt`, tested with Android's numbers. The left side ends at the target or when its time is up. A 5-second countdown follows, with Pause and Start, and the right side starts once tracking is ready. Each side is saved as its own session under the one consent.
- **Saving.** Each finished side is sent to `ingest_session` with the same fields as Android's upload, plus `client: "web"`. The web has no outbox, so a failed save stays on the result page with Try again, and leaving the page asks first. A retry sends the same session id, and the server accepts it once.
- **Afterwards.** Once saved, the patient's queries refresh, so the exercise leaves today's list straight away and appears in history and progress.
- **Server** (`supabase/migrations/202611200001_session_client.sql`). `sessions.client` is `android` or `web`. A payload without it, as Android sends, records `android`; any other value is refused. Nothing else in `ingest_session` changed.
- **Screen.** Android's measurement controls (status, guidance, consent, Start, Pause, Resume, Finish), the side-switch card, the Time left tile, the calculations panel and a result page, in English and Filipino.

**Bug found.** `performance.now()` has fractions of a millisecond, so the active time came out as 8165.9 ms, and the server refused it: it stores whole milliseconds, as Android's clock gives them. Frame timestamps and the session's own start and pause times are now whole milliseconds. Tests cover both.

| Check | Command | Result |
| --- | --- | --- |
| Side sets (Android's numbers), rules (with Android's fixture), payload, controller | `npx vitest run --project unit src/features/exercise/session` | 32 of 32 |
| Saved through the web code to the local backend | `npx vitest run --project contract tests/contract/web-session.test.ts` | 4 of 4. A web session saves once and a retry returns duplicate; `client` is `web`; today's exercise is done; both sides save separately under one consent; changed rules and withdrawn consent are refused; a payload without `client` records `android`, and an unknown one is refused |
| Sessions saved by other paths still accepted | contract tests `summary`, `missed-days`, `exercise-schedule`, `session-videos`, `crossApp`, `queries`; `python scripts/test_bilateral_sets.py`, `test_custom_exercises.py`, `test_connected_workflow.py`; `supabase test db` | 48 of 48; all three pass; 99 of 99 |
| The whole session in Chromium, signed in, against the local backend | `npx playwright test tests/e2e/exercise-session.spec.ts --workers=1` | 2 of 2. Start, consent, measuring, 2 of 2 repetitions, saved, gone from today's list; axe at 390 and 1280 px; an unassigned exercise says so. The fake camera shows no person, so the MediaPipe host module is replaced with one that scripts an elbow bending; everything else is the real app |
| Patient pages under the new decision | `tests/e2e/patient.spec.ts` | 13 of 13. The test that said exercises "never run here" now checks they open here, ask for nothing until the camera is allowed, and still suggest the phone in a browser without camera access |
| Web | `npm run typecheck`, `npm run lint`, `npm test` | 0 errors; 0 warnings; 31 files, 377 tests |

**Deploying.** The migration and the web app can go to the hosted project in either order. The current hosted `ingest_session` ignores `client`, and the new one records a phone session as `android`.

**Not run:**

- a real person exercising in a real browser;
- comparing a web session's result with a phone session of the same movement.

Both are in the checklist.

## #138 Guide, rep coach, spoken cues, side switch and finish celebration

**What was built.**

- **Exercise guide** (`guide/rig.ts`, `outline.ts`, `draw.ts`, `ExerciseGuide.tsx`). These are ports of `:core:domain` `ExerciseGuide.kt` and the app's `GuideOutline.kt` and `drawGuide`: the same poses, framing, outlines, outfits and prescribed range. The tests are Android's `ExerciseGuideTest` cases with its numbers. The figure is SVG, redrawn from `motion`'s `useAnimationFrame` over Android's 4.2-second repetition. It has a pause button. It shows on the session's setup panel, and on the camera screen until measuring starts, as on Android. When the patient prefers reduced motion it holds the target position with no button. That preference is read from the live media query (`motion/useStill.ts`), so a change made while the page is open stops the figure at once; `motion`'s own hook reads the setting only once.
- **Rep coach** (`coach/Coach.tsx`). It shows the step the engine is waiting for, from the shared `repetitionGuide`, as on Android's `RepCoach`: "Step n of 4", the prompt, and the hold bar. Each counted, incomplete, too-fast or timed-out result stays for 2.5 seconds. It sits in the camera panel's coach slot.
- **Spoken cues** (`coach/cues.ts`). These are `RepCueScript`, `SetCueLines`, `CueVoice` and `FinishLines` from Android:
  - the praise rotates and never repeats the line just said;
  - the voice is Filipino when the browser has one, otherwise English;
  - a repetition result cuts off anything still being said, so quick repetitions never pile up;
  - set announcements wait their turn;
  - without a voice for the language, each line is shown as text in the coach.

  Speech goes through `speechSynthesis`, outside the frame loop. Voice off is kept in `localStorage`.
- **Side switch.** The controller now has Android's announcing stage: the countdown waits until "Left side done. Next: Right side…" has been said, or 6 seconds, whichever comes first. With the voice off it starts at once. The card is the one from #137.
- **Finish celebration.** Android's tune: the same samples, played through the Web Audio API. The words are the same, including the last exercise of the day, which is read from `exercise_day` once the sessions are saved. It has its own sound switch, kept in `localStorage`, and a button straight to the results. The icon's pop stays still when the patient prefers reduced motion.
- **Sound only after a press.** The voice and the audio context are only used after Allow camera, Start or a switch has been pressed.
- **Text.** The `coach`, `cue`, `guide` and `finish` sections, in English and Filipino, are taken from Android's strings. "Tap" became "Select" or "See your results".

**Bugs found.**

- A voice that reports "done" straight away, as with the voice off, made the controller cancel its own countdown. The fallback timer is now set before the cue, and a unit test covers it.
- The browser test found that React's development double mount left the cue player released for good, so nothing was spoken. Cleanup now only stops speech.

| Check | Command | Result |
| --- | --- | --- |
| Guide rig (Android's cases) and drawing for every joint, side and posture, both outfits | `npx vitest run --project unit src/features/exercise/guide` | 13 of 13. Every pose was also rendered and inspected as a picture |
| Phrases match Android in both languages; praise never repeats; voice choice; no overlap with a fake voice; announcements wait and report when said; silent until pressed; text without a voice; switches remembered; tune samples | `npx vitest run --project unit src/features/exercise/coach` | 8 of 8 |
| Announcing stage, 6-second fallback, immediate countdown with the voice off | `npx vitest run --project unit src/features/exercise/session` | 34 of 34 |
| Text parity | `npx vitest run --project unit src/locales` | 7 of 7 |
| Whole session in Chromium against the local backend, with a scripted body and a fake browser voice | `npx playwright test tests/e2e/exercise-session.spec.ts --workers=1` | 2 of 2. The guide shows the prescribed range, pauses, and has no button under reduced motion. Voice off survives a reload. The coach shows "Step n of 4" and "Counted! 1 of 2". The guide is hidden while measuring. Praise was spoken. The celebration says "That was today's last exercise." and speaks "Great work! Exercise finished. That was today's last exercise." Then the results page appears, and axe passes at 390 and 1280 px |
| Other camera pages | `camera-check`, `pose-tracking`, `camera-blocked`, `patient-today` specs | All pass |
| Web | `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` | 0 errors; 0 warnings; 34 files, 400 tests; built |

**Not run:**

- **FPS while speaking.** Headless Chromium has no real voice and draws in software at about 2 FPS, so a frame-rate comparison there would mean nothing.
- **Listening.** Nobody has listened to the real voices or the tune in browsers.

Both are in the checklist.

## #139 Record and share a session video

**Owner's decision (2026-11-20).** A web recording stays in the open tab for this visit, with Download and Share with my therapist. If the patient does neither, it is gone when they leave, and the page asks before they go. Nothing reaches the server unless the patient shares it.

**What was built** (`web/src/features/exercise/video/`):

- **Choice and consent.** "Record this session" is off by default and offered before Start, as on Android. The first time it is turned on, the recording's own agreement is asked. It is separate from the movement-summary consent and is kept in this browser for each account, as the phone keeps it. Its five points say where the video stays, what Download means on a shared computer, and that the video is gone when the patient leaves. They are in English and Filipino.
- **Recording** (`recorder.ts`). It is a port of Android's `SessionRecorder`:
  - each tracked frame is drawn on the recorder's own canvas, at the camera picture's shape (640×480 for a 640×480 camera, never more than 1280 pixels), by the same `drawStage` as the screen;
  - Android's caption band is added: exercise · angle · count / target;
  - the run's sessions join one video, as both sides of a set do on the phone;
  - the bitrate is Android's: about 3 bits a pixel, between 1 and 4 Mbps.

  Where `MediaRecorder` records MP4 (H.264), it records the canvas stream. Otherwise WebCodecs encodes the canvas through Mediabunny's MP4 muxer, and a frame that arrives while the encoder is busy is skipped rather than queued. With neither, the switch is replaced by "This browser cannot record session videos". Recording starts with the session, so opening the camera records nothing. A "Recording" pill shows while it runs.
- **In the tab** (`SessionVideo.tsx`). The result page shows the video, Download video (`Motivance-session-YYYYMMDD-HHMMSS.mp4`) and Let my therapist see it. Until one of those is done, closing the tab asks first through `beforeunload`, and leaving inside the app asks through React Router's blocker.
- **Sharing** (`prepare.ts`). The recording is made smaller with Mediabunny's conversion, which uses WebCodecs: 480p (`sharePlan`, Android's `sessionVideoPlan`), its first five minutes, about 500 kbps, written as an ordinary MP4. The share shows a progress percentage. It then follows Android's steps: `start_session_video`, upload the MP4 and the first-frame JPEG preview, `share_session_video`. The server's refusals are shown in the patient's words. Share waits until the session is saved, and Stop sharing is on the same panel. Watching and stopping from progress are the #129 screens, unchanged.
- **Dependency.** `mediabunny` 1.65.2 (MPL-2.0), pinned exactly. It is the maintained successor of `mp4-muxer`, which is deprecated in its favour. It loads only when a video is recorded or shared, so the first download is unchanged at 327 KB.

| Check | Command | Result |
| --- | --- | --- |
| Sizes, bitrate, share plan within the server's limits, file name, refusals, consent store | `npx vitest run --project unit src/features/exercise/video` | 6 of 6 |
| Record, keep, download and share in Chromium against the local backend, with the scripted body | `npx playwright test tests/e2e/exercise-video.spec.ts --workers=1` | 2 of 2. Details below |
| Recording off changes nothing | `tests/e2e/exercise-session.spec.ts` | Pass. No video panel; everything else as in #137 and #138 |
| Web | `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `python scripts/check_web_bundle.py` | 0 errors; 0 warnings; 35 files, 406 tests; built; 327 KB (the existing overage, unchanged) |

What the browser test checked:

- **Consent and recording.** The consent is asked once, with no axe violations. Recording starts only with the session.
- **The video.** It is a 640×480 MP4 that plays. A frame 4 seconds in has more than 200 pixels of the focus colour on the arm, and the dark caption band.
- **Accessibility.** axe passes at 390 and 1280 px.
- **Keeping it.** Leaving asks first. Nothing is uploaded before sharing. Download gives an `ftyp` MP4 with the phone's naming.
- **Sharing.** The share stores a 640×480 `video/mp4` under 20 MB on the web session. The therapist reads one shared video, and after Stop sharing none.
- **Trimming.** A 380-second 1280×720 recording made in the browser is shared as 852×480, 300 seconds and under 20 MB, with progress rising to 100%.
- **Frame rate.** FPS was the same before and during recording: 19.5 and 19.8, then 19.4 and 19.8. The slow-camera warning never showed. This is a spot check in headless Chromium with the scripted body, not MediaPipe on real hardware.

**Not run:** recording and sharing in real browsers, including Safari and Firefox, which take the other recording paths. Also not run: a recording longer than five minutes made in a real session, and the therapist watching a web video on Android. All are in the checklist.

## #140 Decisions, privacy text and documentation

**Decisions recorded.** `docs/PLAN.md` (Web workspace) records the owner's three-part decision of 2026-11-19 and the supported browsers. `docs/architecture/BOOKING.md` and `WEB-DESIGN.md` no longer say the exercise stays on the phone, and `UI-UX.md` points to them. `sprints/sprint-09.json` keeps S9's historical scope, with a note on MOT-52 that it was superseded.

**Dependencies and tools.** The `PLAN.md` dependency table has rows for `@mediapipe/tasks-vision` 1.2.3, with the model's source, SHA-256 and pending review, and for `mediabunny` 1.65.2. A new table lists each browser tool the camera relies on and what happens without it. The architecture diagram has the web branch: browser camera, MediaPipe in a Worker, the same quality gate, the TypeScript engine, canvas and React coaching, and saving directly.

**Code change found while writing the table.** The frame loop needs `requestVideoFrameCallback`, but the support check did not ask for it. A browser without it would have failed after opening the camera. It now gets the "use another browser or the phone" dialog at once, and a unit test covers this.

**Patient text, in English and Filipino:**

- The landing page's lead, the exercise card and the privacy section now say exercises run in the Android app or a current browser, and that camera frames stay on the device in both. The privacy section also says where each kind of recording stays.
- Sign-up point 4 covers recording in the browser.
- The fallback dialog is now "Use another browser or your phone".
- Withdrawing consent no longer says to agree again "on your phone".

**Operations.** `docs/operations/DATA-LIFECYCLE.md` has a table for web recordings: the tab, a download, the agreement in local storage, and the shared copy. `docs/operations/DEVELOPMENT.md` explains how to run and test the web camera, including the fake camera and the scripted body.

| Check | Command | Result |
| --- | --- | --- |
| Text parity | `npx vitest run --project unit src/locales` | 7 of 7 |
| Landing in both languages, axe | `npx playwright test landing --workers=1` | 10 of 10 |
| Patient pages, including the fallback dialog in a browser without a camera | `npx playwright test patient --workers=1` | 13 of 13 |
| Sprint records | `python scripts/sync_sprints.py --validate-only`, `python scripts/test_sync_sprints.py` | Valid; OK |
| Model copies | `python scripts/check_pose_model.py` | Match `59929e1d1ee9…` |
| Web | `npm test`, `npm run lint`, `npm run build` | 35 files, 406 tests; 0 warnings; built |
