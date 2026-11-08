# Live assessment and a repetition count that stays at zero

Account names do not switch off repetition checking. Both demo and prescribed exercises use MovementAssessment. The camera can display a skeleton and angles before a session starts, but preview movement never counts or creates a session automatically.

## Start and complete a counted repetition

1. Open the assigned exercise from Exercises, or use the camera demo in a debug build. Choose the correct supported exercise and anatomical side before a demo session. A mirrored front preview does not swap the prescribed left/right side.
2. In the measurement panel below the camera image, give the separate movement-summary saving consent. Camera permission alone does not start recording. Wait for tracking to become ready and press **Start measurement**.
3. Confirm **Recording · repetition checking is active**. **Preview only** or **Measurement paused** means repetitions are not being counted, and the coach at the top of the camera card says **Not counting yet** or **Paused**. If Start is disabled, read the tracking/assignment/build message in that panel. If tracking dropped as Start was tapped, the panel says measurement did not start: get back in view and tap Start again.
4. Follow the coach at the top of the camera card. It names the step the counter is waiting for: 1, go to the start; 2, move to the target; 3, hold it there, with a progress bar; 4, go back. The count goes up on step 4, the return to or below the lower threshold, not at the peak. After each attempt the coach shows **Counted** with the new total, or **Not counted** with what to change, for 2.5 seconds. With **Voice on**, the phone also says it.
5. For the unchanged default demonstration rules, the cycle is at or below 20 degrees -> at least 90 degrees held for 0.1 seconds -> at or below 20 degrees, with each repetition taking at least 0.6 seconds. A median filter adds roughly one accepted frame of delay. These are development targets, not medical recommendations. Therapist prescription values on screen take precedence.
6. **Pause measurement** stops counting while retaining camera preview. **Resume measurement** needs ready tracking and a fresh starting position; a partially completed cycle is discarded. Pausing the camera/backgrounding also interrupts assessment. Finish and save retains completed counts.

## Why a visible skeleton may not count

- Start was not pressed, saving consent is absent, or measurement is paused. The panel and the coach both state this.
- The current exercise is elbow flexion but the motion is shoulder/knee movement, or vice versa. A therapist-selected knee/wrist/hip/ankle focus ring is a visual cue; it does not implement another exercise algorithm. The angle tile names the joint actually measured.
- The angle has not reached both target thresholds in order. Holding at the top without returning is not a full repetition. Starting already bent/raised still requires returning to the initial threshold first: the coach then shows step 1.
- Required joints are poorly visible, out of frame or below the confidence threshold; multiple people are detected; the upper body leans past the prescribed limit; tracking drops or a frame gap exceeds one second. These interrupt the partial cycle instead of fabricating a repetition. Keep the exercise's shoulder/elbow/wrist and hip visible as required by its setup. A partially drawn overlay is not proof that every assessment landmark is valid.
- The camera view does not match the 2D measurement plane. Elbow flexion uses a side-on view; shoulder abduction uses a front view. Motion toward/away from the camera can look different in the image plane. Follow the setup instructions; do not relax confidence/form thresholds merely to force a count.
- The movement is too brief, misses the target/hold, or times out. The coach's **Not counted** line names which, and the incomplete count records it. Use a controlled full cycle.
- A completed/saved session is still displayed: start a new session before collecting another set.

A frame that reaches the screen more than a second late is skipped. Measurement keeps recording, and the repetition in progress starts over under the one-second gap rule. Before issue #95, one late frame paused measurement until the patient tapped Resume, so a slow phone could stop counting with no visible cause.

## Demo, local test account and assigned exercise

`rules.demo`, not the email/account name, determines demonstration behavior. `app-debug.apk` is `com.motivance.debug` and permits local demo counting after consent/Start. Demo results are stored as LOCAL_ONLY and never uploaded. A local seeded patient account can also use an actual downloaded assignment; that path uses the same counter and queues a prescribed result for authenticated synchronization. Online access is not required for an already valid downloaded session under the existing cache/session policy.

Release builds intentionally disable starting demonstration measurement. They must show the explanation and use a supported, valid patient assignment for recording. The current check uses release-equivalent UI gating and source review; it is not a claim that a signed production APK was tested.

## Verification limits

Synthetic angle/repetition replays and Android tests can verify engine, Start/consent, counter updates, the coach, spoken-result events and persistence. A virtual camera room confirms native inference/camera lifecycle but contains no exercising patient. The user's particular phone, movement, lighting and tracking message are not reproduced by those checks. Physical-device/therapist/reference verification remains recorded in POST-IMPLEMENTATION-CHECKLIST.md; no clinical accuracy claim follows from a passing automated test.
