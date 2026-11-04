# Skeleton calculation overlay

Implemented 2026-11-04 as a follow-up to MOT-10 and the prescribed-focus work. This change makes the skeleton overlay show the angle and repetition calculation the engine uses to count. It does not change any counting threshold, the pose model or persisted session data. It makes no claim of clinical accuracy.

## Problem

The overlay showed only a filtered angle number and a repetition count. Patients and therapists could not see:

- what 0° was measured from;
- where the therapist's low and high thresholds were;
- which step of the repetition rule was active;
- why an attempt was not counted.

When the visual focus differed from the measured joint, as with knee focus on an elbow exercise, the measured limb was drawn muted. The angle then appeared to come from nowhere.

## Design

### One source of truth for the geometry

`core/assessment/.../MeasurementGeometry.kt` is pure Kotlin and passes `check_module_boundaries.py`.

`MeasurementChain` defines the three measured landmarks and the 0° reference.

- **Elbow flexion:** 0° continues the upper arm, so a straight arm is 0°. The angle is `180° − included(shoulder, elbow, wrist)`.
- **Shoulder abduction:** 0° points down the trunk. The angle is `included(hip, shoulder, elbow)`.

`MovementAssessment` now reads its landmarks from this chain instead of keeping its own copy. All 24 existing engine tests pass unchanged, so the counting behaviour is the same. The landmarks required for the trunk-lean check are unchanged.

### Protractor

`MeasurementOverlay.protractor()` builds the protractor in frame pixel space and converts it to normalized points. The existing FIT_CENTER/mirror `PreviewMapping` positions it, so angles stay correct on any aspect ratio, letterbox or front-camera mirror.

It returns `null` under the same confidence and in-frame rules the engine uses, so nothing is drawn for a frame the engine rejects. A 48dp minimum radius, converted through the preview scale, keeps it readable when the limb is small on screen. The angles do not change.

### Hold timer

`AssessmentSnapshot.holdElapsedMs` reports how long the current attempt has stayed at or above the high threshold. It is live state only: `ExerciseJson` does not store it, and a restored session starts again at 0.

It resets when the patient leaves the target, when an attempt is invalid, on pause and after each repetition.

### Repetition guide

`RepetitionGuide.of()` maps the engine's phase onto the four-step rule:

1. **Start:** at or below the low threshold.
2. **Reach:** at or above the high threshold.
3. **Hold:** for the prescribed hold time.
4. **Return:** back to the low threshold, within the minimum and maximum cycle time.

It also reports progress toward the target (`(angle − low) / (high − low)`) and hold progress. Both come only from the engine snapshot and the rules, with no extra inference.

## What the patient sees (`SkeletonPreview.kt`)

**On the camera view, at the measured joint:**

- a dashed 0° reference line;
- a grey start-zone band (0 to low);
- a mint target-zone band (high to 180°);
- labelled low and high ticks;
- the live angle arc, coloured grey at or below low, white in between and mint at or above high;
- the angle value. It sits inside the arc, or just across the 0° line when the sweep is under 30° so it never covers a threshold label.

When the focus joint is not the measured joint, the measured limb is drawn in white so the protractor stays attached to a visible limb.

**Below the camera view:**

- **Angle gauge (0–180°):** start zone, target zone, the session's achieved range and a live needle. "% to target" shows only during the Reach and Hold steps, so it never contradicts a "return to start" instruction. TalkBack reads a full description of the gauge.
- **Four step cards:** Start, Reach, Hold and Return, each with the therapist's value. The active step is highlighted and the Hold card shows a progress bar. The active step is announced politely to TalkBack.
- **Session ROM and Not counted tiles**, next to the existing angle and repetition tiles.
- **A plain-language rule sentence** built from the session's rules, for example: "A repetition counts when the Elbow angle starts at 20° or less, reaches 90° or more, stays there for 100 ms, and returns to 20° or less within 0.6–30 s."
- **A source line:** either "Thresholds from therapist prescription <version>" or an amber "Demo thresholds · not a therapist prescription".

The duplicate "Cycle targets" line under the camera panel in `CameraPrototype.kt` was removed, because the overlay now shows those thresholds. The string is still used on the connected Exercises screen.

The arc follows this frame's raw landmark geometry, because it is drawn on the limb. The number on it is the engine's median-filtered angle, which is the value counting uses. On a real camera stream the two differ only by the 3-frame median filter.

## Executed checks

- **JVM unit tests:**
  - `:core:assessment:test` ran 41 tests with 0 failures. That includes 8 new `MeasurementGeometryTest` cases:
    - the protractor angle equals the engine angle for every exercise and side;
    - ticks sit at the therapist angles;
    - the arc ends on the moving limb;
    - angles hold on 720×1280 and 1280×720 frames;
    - the minimum radius does not change the angle;
    - unreliable landmarks produce no protractor;
    - the guide and hold timer follow one full repetition;
    - leaving the target resets the hold.
  - `:core:domain:test` ran 13 tests and `:app:testDebugUnitTest` ran 53, all passing.
- **Static checks:** `:app:assembleDebug`, `:app:assembleDebugAndroidTest` and `:app:lintDebug` passed, with 0 lint errors (existing warnings remain). `python scripts/check_resources.py` reported 448 strings per language, with format parity and the critical contrast pairs passing. `python scripts/check_module_boundaries.py` and `git diff --check` passed.
- **Emulator (Pixel_6 AVD, API 35), run with `am instrument`:**
  - `SkeletonPreviewTest` passed 4 of 4, including the new `calculationOverlayShowsTherapistThresholdsHoldAndSessionRange`.
  - `LiveAssessmentTest` passed 3 of 3, `ExerciseLifecycleTest` 1 of 1, and `SessionStoreTest` 8 of 8.
- **Not passed:** `CameraLifecycleTest` failed on this AVD. Its camera is mapped to the host webcam (`hw.camera.*=webcam0`) and CameraX stayed in `PENDING_OPEN`, so no frame ever reached inference. The camera never opened, before any overlay code runs. Rerun it on an AVD with an emulated or virtual-scene camera, or on a phone, before claiming the camera smoke test passes.

## Visual evidence

These renderer screenshots use synthetic landmarks on a gradient bitmap, not real patient or model output.

In the knee-focus and shoulder fixtures, the snapshot angle (80° and 45°) is hard-coded and doesn't match the fixture's limb geometry. In those two images the arc sweep and the number differ for that reason. On a live camera, both come from the same frame.

- [Hold step with prescribed thresholds 25°/75°, session range and rule sentence](ui/skeleton-calc-hold-step.png)
- [Elbow protractor at the Start step, with progress hidden](ui/skeleton-calc-elbow-start.png)
- [Knee visual focus with the measured elbow limb drawn in white](ui/skeleton-calc-knee-focus.png)
- [Mirrored right shoulder at 200% Filipino font scale](ui/skeleton-calc-shoulder-large-fil.png)

## Deferred (not executed)

These checks are recorded in `POST-IMPLEMENTATION-CHECKLIST.md`:

- protractor alignment on a physical phone with real pose output;
- readability for patients and therapists;
- TalkBack wording;
- review of the new Filipino strings by a fluent reviewer;
- whether therapists find the rule sentence and step cards clinically appropriate.
