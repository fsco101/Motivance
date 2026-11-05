# Assigned exercises falling back to demo rules

Date: 2026-11-05. Emulator engineering evidence only. No physical-device, therapist or patient check was executed; those are listed in `POST-IMPLEMENTATION-CHECKLIST.md`.

## Reported problem

A patient running an assigned exercise could end up on the camera's testing (demo) mode.

## Findings

Tapping Start on an assignment did select the prescription. The defect was that demo rules were the default for every reset, so ordinary paths left a patient holding a valid assignment on demo thresholds. Demo results stay on the phone and never reach the therapist.

| Path | Effect before the fix | Fix |
| --- | --- | --- |
| "New session" on the camera | `newSession()` always reset to demo rules. | It keeps the assignment in use, or takes the first valid one. |
| "Check camera again" on the summary | The camera reopened on the saved session, so nothing measured until "New session" dropped to demo. | The action starts a new session first. |
| Camera check on Home or Exercises | Opened on demo rules even with an assignment waiting. | Valid assignments replace demo rules as soon as they are available. |
| "Recover" on the camera | A leftover interrupted demo session was offered and could replace the assignment. | Demo sessions are not offered to an account with a valid assignment. Interrupted assigned sessions still are. |

The camera's assignment buttons all read "Use downloaded prescription", including for the one already selected. They now name the exercise and side, and only the other assignments are listed.

## Behaviour to review

- Camera check now opens on the assignment for a patient who has one, so ticking consent and tapping Start there records a real assigned session. Nothing is recorded without those two steps.
- With several assignments, the first valid one is selected, the same one the Home card shows.
- Demo rules remain for accounts with no valid assignment, including when the only assignment has expired. Demo recording remains debug-only.

## Evidence

| Check | Result |
| --- | --- |
| `AssignedRulesTest` before the fix, Pixel 6 AVD | 6 tests, 4 failures, one for each defect. The two guard tests passed. |
| `AssignedRulesTest` after the fix | 7 tests OK. The seventh renders the real camera screen with a real view model and Room, and was added after the fix, so it was not run against the old code. |
| Instrumented suite, Pixel 6 AVD | 74 tests OK, before the seventh test was added. `CameraLifecycleTest` was excluded because it needs a signed-out app. |
| JVM suites | 242 results, 0 failures, 0 errors. |
| English/Filipino resources | 730 strings per locale, format parity passed. |
| Module boundaries | Passed. |

The "Check camera again" button's one-line wiring in `MotivanceApp` has no automated test of its own; `AssignedRulesTest` covers the `newSession()` call it makes. A full sign-in walkthrough was not run, because it would have signed out the account on the shared emulator.
