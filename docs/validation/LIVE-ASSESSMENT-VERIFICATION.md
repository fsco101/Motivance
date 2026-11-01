# Live assessment and repetition-count verification

Reviewed by Codex on 2026-11-01 after the user reported a visible skeleton without an incrementing repetition count. The user's physical phone/movement/status has not been reproduced, so this report does not assign a confirmed cause to that particular observation.

## Findings

Live assessment is implemented: CameraX/MediaPipe supply timestamped landmarks, ExerciseSessionViewModel feeds MovementAssessment, and its snapshot supplies angle, ROM, duration, completed/incomplete counts and quality/phase feedback. The algorithms support elbow flexion and shoulder abduction. A focus ring on another therapist-selected part changes visual guidance, not the exercise algorithm.

There is no account-name or demo-login restriction on the repetition engine. The supplied debug artifact has package `com.motivance.debug`; it allows `rules.demo` measurement after saving consent and explicit Start, retaining its results as LOCAL_ONLY. Prescribed sessions use the same counter and queue their completed payloads. Release builds intentionally reject starting demonstration measurement; the code and release-equivalent UI gate were checked, not a newly signed production binary.

Preview is intentionally non-recording. Visible landmarks and an available angle do not increment the counter before Start. The original layout placed consent/Start below the enlarged skeleton panel while labeling the camera live; that made the separate Start step easy to miss. This is a confirmed usability issue, not evidence that the user's demo account disables counting.

A complete cycle needs a stable, reliable starting position, reaching/holding the high target, and returning to the low threshold in order. Default demonstration values remain 20 -> 90 held for 100ms -> 20 degrees, with a 600ms minimum cycle. The count increments on the final return. Invalid tracking resets a partial cycle; it never bridges missing people/joints or invents a repetition. No thresholds, consent requirements or quality gates were weakened in this change.

## Changes

MeasurementControls now appears above the skeleton. It names Preview only, Recording, Measurement paused and Finished states, gives explicit saving consent/Start/Resume controls, shows target-dependent phase instructions, and offers Pause measurement while retaining the camera preview. Invalid tracking, expired assignments and the release-demo restriction have visible explanations near Start. Existing camera pause, finish/save, interruption recovery and local history remain available. New text has English/Filipino resources. No database migration or backend contract changed for this clarification.

## Executed verification

`MovementAssessmentTest.visiblePreviewDoesNotCountUntilMeasurementStarts` verifies live angles/zero count before Start and a counted cycle afterward. Complete-cycle replay covers both supported exercises, both anatomical sides and demo/prescribed rules. Existing tests retain incomplete/too-fast cycles, hold/timing, outliers, tracking loss, interrupted recovery and long traces.

`LiveAssessmentTest` uses the real Android ExerciseSessionViewModel, Room store, Compose consent/Start/Pause controls and timed synthetic landmarks. Its demo and prescribed cases each verify zero during a moving preview, Recording after Start, count 1 in the UI after a full cycle, unchanged count during Pause, and persisted count 1 after Finish. Demo outbox state is LOCAL_ONLY; prescribed outbox state is PENDING. A third case verifies the explanation/disabled Start for release-equivalent demo restrictions. These three targeted checks passed before final regression. A newly added JUnit cleanup method initially had a non-void return; it was corrected and the targeted suite passed.

Final suite counts/case names are recorded in `live-assessment-test-results.json`. Build/lint, bilingual resource/format parity, pure module boundaries and native runtime packaging are checked separately. CameraLifecycleTest exercises actual native inference and background/rebind with a software camera source; its virtual room has no exercising patient. Generated landmark tests establish software flow and counting behavior, not physical camera accuracy or clinical validity.

Use [live assessment troubleshooting](../operations/LIVE-ASSESSMENT-TROUBLESHOOTING.md) on the actual phone, recording the build, exercise/side, tracking message, Recording state and observed angle sequence. The corresponding physical follow-up remains unchecked in POST-IMPLEMENTATION-CHECKLIST.md. There is no claim that the particular phone report is already resolved by synthetic tests.
