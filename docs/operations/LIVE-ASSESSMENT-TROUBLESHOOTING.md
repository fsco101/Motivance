# Live assessment and a repetition count that stays at zero

Account names do not switch off repetition checking. Both demo and prescribed exercises use MovementAssessment. The camera can display a skeleton and angles before a session starts, but preview movement never counts or creates a session automatically.

## Start and complete a counted repetition

1. Open the assigned exercise from Exercises, or use the camera demo in a debug build. Choose the correct supported exercise and anatomical side before a demo session. A mirrored front preview does not swap the prescribed left/right side.
2. In the measurement panel above the skeleton, give the separate movement-summary saving consent. Camera permission alone does not start recording. Wait for tracking to become ready and press **Start measurement**.
3. Confirm **Recording · repetition checking is active**. **Preview only** or **Measurement paused** means repetitions are not being counted. If Start is disabled, read the tracking/assignment/build message in that panel.
4. Follow the displayed phase instruction. Return to the lower threshold first, move to at least the upper target, hold it for the configured time, then return to or below the lower threshold. The increment happens on that final return, not merely at the peak.
5. For the unchanged default demonstration rules, the cycle is at or below 20 degrees -> at least 90 degrees held for 100ms -> at or below 20 degrees, with a minimum full-cycle duration of 600ms. A median filter adds roughly one accepted frame of delay. These are development targets, not medical recommendations. Therapist prescription values on screen take precedence.
6. **Pause measurement** stops counting while retaining camera preview. **Resume measurement** needs ready tracking and a fresh starting position; a partially completed cycle is discarded. Pausing the camera/backgrounding also interrupts assessment. Finish and save retains completed counts.

## Why a visible skeleton may not count

- Start was not pressed, saving consent is absent, or measurement is paused. The new panel states this explicitly.
- The current exercise is elbow flexion but the motion is shoulder/knee movement, or vice versa. A therapist-selected knee/wrist/hip/ankle focus ring is a visual cue; it does not implement another exercise algorithm. The angle tile names the joint actually measured.
- The angle has not reached both target thresholds in order. Holding at the top without returning is not a full repetition. Starting already bent/raised still requires returning to the initial threshold first.
- Required joints are poorly visible, out of frame or below the confidence threshold; multiple people are detected; torso positioning is invalid; tracking drops or a frame gap exceeds one second. These interrupt the partial cycle instead of fabricating a repetition. Keep the exercise's shoulder/elbow/wrist and hip visible as required by its setup. A partially drawn overlay is not proof that every assessment landmark is valid.
- The camera view does not match the 2D measurement plane. Elbow flexion uses a side-on view; shoulder abduction uses a front view. Motion toward/away from the camera can look different in the image plane. Follow the setup instructions; do not relax confidence/form thresholds merely to force a count.
- The movement is too brief, misses the target/hold, or times out. Check the incomplete count/reason and use a controlled full cycle.
- A completed/saved session is still displayed: start a new session before collecting another set.

## Demo, local test account and assigned exercise

`rules.demo`, not the email/account name, determines demonstration behavior. `app-debug.apk` is `com.motivance.debug` and permits local demo counting after consent/Start. Demo results are stored as LOCAL_ONLY and never uploaded. A local seeded patient account can also use an actual downloaded assignment; that path uses the same counter and queues a prescribed result for authenticated synchronization. Online access is not required for an already valid downloaded session under the existing cache/session policy.

Release builds intentionally disable starting demonstration measurement. They must show the explanation and use a supported, valid patient assignment for recording. The current check uses release-equivalent UI gating and source review; it is not a claim that a signed production APK was tested.

## Verification limits

Synthetic angle/repetition replays and Android tests can verify engine, Start/consent, counter updates and persistence. A virtual camera room confirms native inference/camera lifecycle but contains no exercising patient. The user's particular phone, movement, lighting and tracking message are not reproduced by those checks. Physical-device/therapist/reference verification remains recorded in POST-IMPLEMENTATION-CHECKLIST.md; no clinical accuracy claim follows from a passing automated test.
