# Assignment delivery fix and action toasts

Date: 2026-11-05. Emulator and local-backend engineering evidence only. No physical-device, therapist or patient check was executed; those are listed in `POST-IMPLEMENTATION-CHECKLIST.md`.

## Reported problem

A patient could not get the exercise a therapist assigned.

## Findings

The backend was not at fault. For a real affected account, row-level security returned the assignment and its version, and the app's exact PostgREST query returned the assignment over the API. Three client defects were found.

| Defect | Effect | Fix |
| --- | --- | --- |
| The patient's list reads a local cache that only `loadOverview()` filled, which ran at sign-in and from some refresh actions. Nothing ran on opening Exercises, returning to the app or staying open. | A patient already signed in when the therapist published saw nothing. | The download moved to the start of `loadWorkspace()`. `RehabilitationViewModel.syncAssignments()` runs quietly on opening Home or Exercises, on returning to the app, and every 30 seconds while either page is open. |
| The download ran after four other requests. | A failure in any of them held the exercise back. | It now runs first in the workspace load. |
| The new-assignment form kept its `assignmentId` after publishing. | A second exercise from the same form became version 2 of the first assignment and replaced it on the patient's phone. | The form closes on success, so the next assignment gets a new ID. |

A related false alarm was also fixed: accounts holding both patient and therapist roles saw "assignment unavailable" because their patients' prescriptions were compared with their own cache.

The cache still expires 24 hours after its last download, and the patient's offline behaviour is unchanged. Each check is a full workspace load of six requests. Review this interval before a production rollout with many concurrent patients.

## Toasts

`Toaster` is a singleton and `ToastHost` sits above every screen, so a toast survives navigation. Every toast lasts `TOAST_DURATION_MS` (5 seconds). Only the latest is kept, which lets a pending toast become its result, and each replacement gets its own 5 seconds.

Each toast has a close button and a bar along its bottom edge that empties as its time runs out. One frame-based timer drives both the bar and the closing, so the bar is empty exactly when the toast goes, and the toast keeps its 5 seconds when system animations are turned off. Closing a pending toast only hides it: the action continues and its result still appears.

| Area | Toasts |
| --- | --- |
| Sign-in, account creation, verification, recovery, session refresh, sign-out | Pending, then done or the failure reason. A new account stays pending until the email is verified. Invalid input is reported too. |
| Connected workflow | Invite, accept, revoke, publish, sync, consent withdrawal, export and deletion requests, requested refreshes, and copying a code. |
| Patient assignments | A new or updated exercise arriving by itself. |
| Exercise sessions | Start, pause, restore, saved (pending upload for prescribed sessions), and failure. |
| Background uploads | Uploaded, failed, or sign-in required, as the worker finishes. |
| Profile and administration | Saving, saved and failed. Read-only loads stay silent on success. |

Launch-time session restore, automatic loads and quiet checks show no toast. Errors also stay inline where they offer Retry. Connected-workflow and profile success notices moved to toasts only; the administration page keeps its inline confirmation as well.

## Evidence

| Check | Result |
| --- | --- |
| JVM suites | 152 tests, 0 failures |
| Instrumented suite, Pixel 6 AVD, API 35 | 68 tests OK, including one live test skipped without accounts. `CameraLifecycleTest` was excluded because it needs a signed-out app and the emulator's signed-in session was preserved. |
| `scripts/test_assignment_delivery.py` | Passed. Real local Auth and PostgREST: publish, second exercise, edit and revoke all reached a patient who stayed signed in. |
| Toast duration | `ToastHostTest` holds the toast past 4.7 s and sees it gone by 5.7 s on the virtual clock. Screenshot bursts on the real app read 4.7 s with animations off and 5.2 s with them on, at about 1 s sampling and including a brief pending stage. |
| Close button and time bar | `ToastHostTest` closes a toast at once, gives the next toast its full time, and reads the bar's filled width from pixels at 1, 2.5 and 4.5 s. In the real app the toast was gone 0.5 s after tapping the button. |
| App walkthrough with disposable accounts | All checks passed: [results](assignment-delivery/app-walkthrough-results.json). The open app received an exercise 20 s after publishing, and a toast appeared after returning to the app. |
| English/Filipino resources | 730 strings per locale, format parity passed |

Screens: [failed sign-in](assignment-delivery/toast-login-failed.png), [exercise arrived](assignment-delivery/toast-exercise-arrived.png), [two plans after publishing](assignment-delivery/toast-published-two-plans.png), [close button and time bar](assignment-delivery/toast-close-and-time-bar.png).

The walkthrough did not cover creating an account through the signup screens or the camera session toasts. Those are covered by `AuthViewModelTest` and `ExerciseLifecycleTest` at view-model level with fixtures.

## Known limits

- Up to 30 seconds can pass before an open app sees a new exercise. A check requested while the previous one is finishing is skipped, and the next one picks it up.
- The therapist's exercise picker lists every published version, so Elbow flexion and Shoulder abduction each appear twice. This existed before this change and was not altered.
