# Motion arc mobile redesign

Engineering review: Claude Code, 2026-11-05. This redesigns the native Android UI and interaction model at the user's request, disregarding the Stitch prototype design. It does not establish clinical validation, physical-device usability or TalkBack approval.

## Delivered behavior

- Logo-derived theme (`designsystem/MotivanceTheme.kt`): ink, lagoon, sprout, mist and amber tokens; a dark `SessionTheme` for the camera stage; Bricolage Grotesque (OFL, bundled resource, licence in `app/src/main/assets/licenses/`) for headings and live numbers.
- Shared interaction primitives (`designsystem/Interaction.kt`): named haptics, press-settling `TappableSurface`, animated `Collapsible`, `RollingCount`, the `MotionArc` gauge and the `WeekStrip`. `designsystem/Stage.kt` paints the system-bar areas for the dark session.
- Navigation: depth-aware slide transitions, tab fades, pull-to-refresh on workspace pages (explicit Refresh buttons retained), avatar account button, restyled bottom bar with haptic tab changes.
- Patient home Today card starts the next valid downloaded assignment in one tap; a weekly strip shows days with a completed session. Therapist home lists the first three linked patients.
- Patient list rows open the record directly; revocation remains behind the overflow menu and confirmation. Invitation codes have a Copy action.
- Prescription editor: drag either end of the range arc (5° snapping, 15° minimum span, haptic ticks); typed fields unchanged.
- Live session: dark full-bleed stage, tracking chip on the image, larger angle/repetition readouts, controls directly below the readouts, counting rules after the controls, a pulsing recording indicator, and haptic confirmation of each counted repetition.
- Copy: all-caps labels converted to sentence case in English and Filipino; the corrupted Filipino tagline separator fixed; legend wording matches the new green target band.

No database, backend, authentication, consent, assessment rule or Gradle dependency changed. The imported prototype folder is untouched.

## Executed evidence

| Check | Result |
|---|---|
| `:app:compileDebugKotlin`, `:app:installDebug`, `:app:assembleDebugAndroidTest` | Passed |
| App JVM suite (`testDebugUnitTest`) | 76 tests in 13 suites, zero failures/errors |
| Android lint (`:app:lintDebug`) | 0 errors, 104 advisory warnings (the one new error, a `LocalContext` configuration read, was fixed) |
| Pixel 6 AVD, API 35 UI classes (Workspace, PrescribedFocus, Accessibility, ResultsDashboard, SkeletonPreview, LiveAssessment, AuthScreen, PatientProfile, AdministrationScreen) | 35 tests passed: [transcript](motion-arc/instrumentation.txt) |
| English/Filipino resources | 708 strings per locale, no missing keys, format-argument parity passed, no all-caps strings |
| Text contrast | 15 foreground/background pairs between 4.53:1 and 14.83:1 |

The full 35-test run passed twice. In one intermediate run, `PatientProfileTest.signupStepsBlockIncompleteDetails` failed once, then passed three times in isolation and in the final full run. The signup flow was not modified, but the intermittent failure is recorded here and has not been diagnosed. `CameraLifecycleTest` was not run, because it starts from the signed-out landing screen and the emulator was signed in to a test account that was intentionally preserved.

Screenshots from the actual composables with synthetic fixtures: [landing](motion-arc/ui-workspace-landing.png), [patient hero](motion-arc/ui-workspace-patient.png), [double-size text](motion-arc/ui-workspace-large-text.png), [draggable prescription arc](motion-arc/assignment-editor-targets.png), [Filipino assignment at 2× font](motion-arc/sprint-04-assignment-large-fil.png), [calculation overlay](motion-arc/skeleton-calculation-overlay.png), [mirrored shoulder in Filipino at 2× font](motion-arc/skeleton-shoulder-large-fil.png). Installed-app captures without a person in frame: [session stage](motion-arc/emulator-session-stage.png), [session controls](motion-arc/emulator-session-controls.png). The patient home, exercise list, profile and camera setup were inspected on the emulator but not stored, because they show the test account's name and email.

## Deferred verification

Listed in `POST-IMPLEMENTATION-CHECKLIST.md`: haptic strength and timing on physical phones, arc dragging with real fingers and TalkBack, pull-to-refresh discoverability, Filipino review of the new copy, and therapist review of the Today card and the weekly strip wording.
