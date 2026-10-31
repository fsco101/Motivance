# Loading, login and signup design refinement

Date: 2026-10-31. Scope: existing Android email/password authentication UI. Reviewer: Codex engineering and emulator visual review.

The supplied Motivance logo, navy/teal palette, light mint/blue background and rounded white form surfaces now connect startup loading, patient/therapist login, patient signup, email confirmation and password recovery. Forms have clear headings, 56dp primary actions, a secondary camera link, a maximum width of 480dp and scrolling for smaller screens and the keyboard. Password visibility uses an accessible labeled eye control that preserves input space at larger font sizes. All new text has English and Filipino resources.

`AuthState.restoring` distinguishes startup session restoration from form submission. A branded indeterminate loading screen is shown during the real request, without an artificial delay. Restored, absent and failed sessions leave loading normally. Submission feedback identifies the action and disables repeated submissions and form navigation. Errors and acknowledgements are readable live-region notices. Switching forms clears passwords/codes/visibility and stale notices. Only email/current form use saved instance state. Existing trusted roles and backend APIs remain unchanged; therapist login does not offer patient registration.

## Executed checks

- Debug assembly and Android lint completed successfully; lint reports 0 errors, 78 warnings and 1 informational finding. Remaining warnings include dependency updates, unused resources and existing platform advisories; this is not a release-approval claim.
- 37 app JVM tests passed, including 10 authentication ViewModel tests. Two new tests check loading while restoration is pending and leaving loading after restoration failure.
- The full emulator suite passed all 21 tests on Pixel 6 / Android 15, including six new auth UI tests. They cover submission/busy controls, password visibility, signup/confirmation with preserved email and cleared password, recovery, therapist signup exclusion, loading and Filipino at 1.6x font scale within a 320dp-wide layout.
- Visual review found the original text visibility control squeezed the password field at large font sizes. It was replaced with a labeled eye control and extra input space.
- After that adjustment, all six focused authentication emulator tests passed again. The full and focused Gradle runs are retained in [auth-ui-validation.log](auth-ui-validation.log) and [auth-ui-final.log](auth-ui-final.log).
- Final resource packaging/lint passed ([log](auth-ui-package.log)). The packaged app was installed on the emulator and all six auth tests passed via the instrumentation runner ([log](auth-ui-device.log)); the final screenshots were retrieved and reviewed. Machine-readable counts are in [auth-ui-test-results.json](auth-ui-test-results.json).

The Compose tests use synthetic fixtures and callbacks, not live accounts or delivered emails. They do not repeat the previously documented live backend auth checks. Screenshots contain only synthetic data. Physical-device, TalkBack and wording/comprehension checks remain unchecked in [POST-IMPLEMENTATION-CHECKLIST.md](POST-IMPLEMENTATION-CHECKLIST.md).

## Screenshots

- [Login](ui/auth-login.png)
- [Patient signup](ui/auth-signup.png)
- [Startup loading](ui/auth-loading.png)
- [Therapist login](ui/auth-therapist.png)
- [Submission loading](ui/auth-busy.png)
- [Filipino signup, 320dp / 1.6x text, scrolled to the form](ui/auth-signup-large-fil.png)

This is an enhancement to completed MOT-04. It does not complete the broader MOT-21 accessibility/usability acceptance or the outstanding Sprint 1 CI requirement. No new sprint or authentication provider is introduced. Changes remain local for the user's manual commit/push workflow.
