# Repetition coach, spoken feedback and plain timing words

Date: 2026-11-08. Issues [#95](https://github.com/fsco101/Motivance/issues/95), [#96](https://github.com/fsco101/Motivance/issues/96) and [#97](https://github.com/fsco101/Motivance/issues/97). This is engineering evidence from JVM tests, emulator tests and code review. No physical-device, therapist or patient check was run; those are in [POST-IMPLEMENTATION-CHECKLIST.md](POST-IMPLEMENTATION-CHECKLIST.md). The hosted sign-up email fix for #94 is recorded in [AUTH-EMAIL-IMPLEMENTATION.md](AUTH-EMAIL-IMPLEMENTATION.md).

## #95: the count does not go up

The engine counts a complete, valid cycle. The existing replays show it, and so does the new `aReplayedSessionYieldsOneResultPerAttempt`. Code review and synthetic replays found five defects that made a valid movement look uncounted. None is in the thresholds.

| Defect | Fix | Regression test |
| --- | --- | --- |
| The engine clears `feedback` on every accepted frame, so "Target reached", "Complete repetition" and each reason showed for about 0.1 seconds. | `RepOutcome` reads each counted or missed result from consecutive snapshots. The view model keeps the latest as `RepResult`, and the coach shows it for 2.5 seconds. The old one-frame banner is gone. | `RepetitionOutcomeTest` (5), `LiveAssessmentTest` (the result outlives later frames), `RepCoachTest` |
| The step guide and "return to 20°" sat below the image and the count, and the preview said "Live camera" while nothing was counted. | `RepCoach` sits in the camera card above the image. It shows "Not counting yet", "Paused", "Waiting for tracking", or step 1 to 4 with the angle to reach and a hold bar. | `RepCoachTest` (9) |
| A frame more than a second late called `session.interrupt()`, which paused measurement until the patient tapped Resume. | `PerformancePolicy.frameAction` skips the frame. The engine's one-second gap rule still discards the repetition in progress. Severe heat still pauses. | `PerformancePolicyTest` (2) |
| If tracking dropped while consent was saved, Start did nothing and said nothing. | `startRefused` shows a message in the panel until a start succeeds. | `LiveAssessmentTest.aStartThatCannotBeginSaysWhyAndClearsOnceItStarts` |
| On the first frame at the target the guide still said "Reach", so the patient was not told to hold. | `RepetitionGuide` reports Hold from the first frame at or above the target. | `MeasurementGeometryTest.guideAsksToHoldFromTheFirstFrameAtTheTarget` |

Unchanged: thresholds, confidence, outlier, upper-body lean and frame-gap rules, the Room schema and the upload contract. The reporter's session was not reproduced on their phone. The build, device, exercise and angle were never supplied, so the follow-up checklist asks for that reproduction.

## #96: spoken feedback

The owner chose Android text-to-speech with an English fallback. `RepCuePlayer` speaks in the app's language when the phone has that voice. It speaks the English phrase when there is no Filipino voice, and plays a short tone when there is no voice at all, so a result is never silent while the voice is on. Counted repetitions rotate through five phrases and never repeat the line just spoken. A missed attempt gets a prompt for its reason: reach and hold, slow down, or start again. The wording is encouragement only and makes no clinical claim.

- Only active measurement speaks. `RepOutcome.between` returns nothing unless the engine is running, and the player listens to a one-shot `results` flow, so a rotation never replays a phrase.
- A new result cuts off the previous phrase (`QUEUE_FLUSH`), so phrases never overlap. Speech runs in the speech service, off the camera and counting path.
- **Voice on/off** sits under the measurement panel. It is on by default and stored per phone in the `session_feedback` preferences.
- The manifest declares the `TTS_SERVICE` query, which Android 11 and later need to find a speech engine. There is no new Gradle dependency.

Tests: `RepCueTest` (7 JVM tests: rotation, a single phrase, reasons, Filipino, Tagalog-coded engines, English fallback, no voice), `RepSoundSettingTest` (2), and `LiveAssessmentTest`, which shows the voice hears nothing in preview, `Counted(1)` while recording and nothing while paused. No test hears audio: real speech on a phone is in the checklist.

## #97: timing in everyday words

- Patients see seconds: "Hold it there for 0.1 seconds", "Move to 90° or more and hold it for 1 second". "Trunk lean" became "upper body". The camera screen's rule summary gives the repetition time in seconds.
- The therapist editors on Android and the web take seconds and convert to milliseconds (`Seconds` in `core/domain`, `secondsText` and `readTiming` on the web). A comma also works as the decimal mark. Anything finer than a millisecond is refused, as before. Each field has a short explanation and an example.
- Stored prescriptions keep `minimum_cycle_ms`, `maximum_cycle_ms` and `peak_hold_ms`, so no migration is needed and older plans read the same.
- English and Filipino are updated in `values/`, `values-fil/`, `en.json` and `fil.json`. The five unused `feedback_*` strings were removed.

Tests: `SecondsTest` (4), web `therapist.test.ts`, `PrescribedFocusTest.timingIsTypedInSecondsAndPublishedInMilliseconds`, `SkeletonPreviewTest` (which fails if any text on the patient overlay contains " ms"), `RepCoachTest` for the panel wording, and the web browser test for the assignment editor's timing fields.

## Runs

The new tests were run before their fixes and failed for the missing behaviour. The core and app JVM tests failed on their assertions. The emulator run failed 16 of 17 checks, then the voice-event check failed again against a flow that never emitted. Two checks were written after the code they cover and passed on their first run: the large-font Filipino coach check and the browser test that publishes in seconds. All runs below are after the fixes.

- JVM (`:core:assessment:test`, `:core:domain:test`, `:app:testDebugUnitTest`): 415 tests, no failures. This includes the new `RepetitionOutcomeTest`, `SecondsTest`, `RepCueTest` and policy tests.
- The Android CI set (`:app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug` with the unit tests above) passed. `check_resources.py` (934 strings per language, matching formats), `check_admin_parity.py`, `check_module_boundaries.py` and `check_apk_native_libraries.py` also passed. Lint added no error. Its new warnings are style suggestions in `RepCoach.kt`, which uses plain `SharedPreferences.edit()` as the rest of the app does.
- Pixel 6 emulator, API 35, full instrumented suite: 107 of 109 passed. `CameraLifecycleTest` failed because that boot used the AVD's saved webcam camera, which supplies no frames ([DEVELOPMENT.md](../operations/DEVELOPMENT.md)). After a cold boot with `-camera-back emulated -camera-front emulated -no-snapshot-load` it passed, so the camera screen with the coach, the voice player and the late-frame rule runs on the native camera. `PatientProfileTest.signupStepsBlockIncompleteDetails` (sign-up, unchanged here) failed once under load and passed on rerun, with all 8 tests in its class.
- Emulator, through the instrumentation runner: `RepCoachTest`, `SkeletonPreviewTest` and `PrescribedFocusTest`, 17 of 17, including the coach and the measurement panel in Filipino at twice the font size. The screenshots were reviewed: the coach stays above the image, and the timing fields show seconds with their help text.
- Web: `typecheck`, `lint`, 263 unit tests, the admin parity checks, `build` and `check_web_bundle.py` (296 KB of 300 KB) passed. Against the local stack, the contract tests passed 159 of 159. `therapist-caseload.spec.ts` passed 17 of 17 with one worker, including a new test that types 0,7, 25 and 1.5 seconds and finds 700, 25000 and 1500 ms in the published plan.

Not run: audio on any device, the reporter's phone, a therapist's or Filipino speaker's review, and the database CI suites, which this change does not touch.
