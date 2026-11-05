# One sign-in page

Date: 2026-11-05. Emulator and local-backend engineering evidence only. No physical-device, therapist or patient check was executed; those are listed in `POST-IMPLEMENTATION-CHECKLIST.md`.

## What changed

The landing page asked people to pick patient, therapist or administrator before signing in. That choice only changed the sign-in page's wording and whether it offered sign-up; access was always decided by the account's roles on the server. Everyone now uses one sign-in page and lands on the workspace for their role.

| Area | Now |
| --- | --- |
| Landing | Welcome, one Sign in button, camera trial and language. |
| Sign-in | One page for everyone. "Create patient account" shows for all, because sign-up only ever creates patients. Staff roles still come from an administrator. |
| Routing | `UserSession.primaryRole` picks admin, then therapist, then patient. |
| Accounts with several roles | Every account starts as a patient, so staff usually hold both roles. They land on the staff workspace and can switch on the Profile page. |
| Switching | A switched workspace lasts for that sign-in only and survives rotation. It is cleared on sign-out, so it cannot carry over to the next person. |
| "No access to this portal" screen | Removed, because a wrong role can no longer be picked. A role the account does not hold is never shown. |

No backend change was needed. Server-side role checks are unchanged.

## Evidence

| Check | Result |
| --- | --- |
| `scripts/test_role_routing.py` with `LiveRoleRoutingTest`, real app, real sign-in page, local backend | Passed. Patient, therapist, therapist who is also a patient, and administrator each reach their own workspace. Switching to the patient workspace works, and signing in again returns to the staff workspace. |
| `UserSessionTest` | Passed, including both orders of a therapist's roles. |
| JVM suites | 265 results, 0 failures, 0 errors. |
| English/Filipino resources | 742 strings per locale, format parity passed. |

## Instrumented suite: not clean

One full run on the Pixel 6 AVD gave 81 tests with 2 failures, and a later repeat of the sign-in tests hung. These are open, not passed.

| Result | Status |
| --- | --- |
| `CameraLifecycleTest` failed | Environment. The emulator log reports "No cameras available". The test reached the camera through the new landing page first. It must be re-run on a device with a working camera. |
| `PatientProfileTest.signupStepsBlockIncompleteDetails` failed once | Unexplained. It passed on re-run, and the sign-in and sign-up classes then passed once in full (14 tests). |
| `AuthScreenTest.recoveryHasDistinctCodeAndNewPasswordSteps` hung over 5 minutes at full CPU | Unexplained. It does not touch the changed routing, but no root cause was found. |

A comparison with commit `20c1ac7`, which has no login change, was stopped early. That build passed once and hung once, in `therapistSummaryShowsUsernameAvatarAndDemographics`. The emulator then exited with code 1, so the current build was never measured and there are no comparable rates. The one baseline hang suggests the hangs do not come from this change, but it does not prove it.

Screens: [landing](one-sign-in/landing.png), [sign-in](one-sign-in/sign-in.png).
