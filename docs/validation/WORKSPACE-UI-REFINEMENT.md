# Workspace UI refinement

Engineering review: Codex, 2026-11-01. This refines the existing native Android application; it does not establish clinical validation or physical-device usability approval.

## Delivered behavior

- Shared navy/teal theme with explicit typography, surface colors and rounded shapes. Shared cards, 56dp action buttons, loading notices, retry feedback and empty states cover connected workspaces and session saving.
- Patient and therapist home cards emphasize exercises and patient management. Camera checks remain available as secondary actions. Landing cards are more compact; wide displays have bounded content widths.
- Visible parent-screen Back actions, related bottom-navigation selection and fresh scroll position on destination changes. Administrators have a dedicated Administration destination with Accounts, Links and Catalogue sections.
- Expandable history filters, invitation creation and advanced prescription timing reduce the initial form density. Invalid date errors remain visible when filters collapse. Prescription choices have persistent field labels and numeric keyboards.
- Action-aware progress for authentication, refresh, invitations, prescription publication, synchronization scheduling, consent, privacy requests and administrator changes. Busy controls prevent repeated submissions. A sync request is distinguished from a server-acknowledged upload; privacy requests are not represented as fulfilled.
- Loading and failed assignment fetches do not display a false empty-program message. Errors and status notices use text and polite accessibility announcements. The 28 new messages have English and Filipino resources.

No database migration, runtime dependency, authentication provider or imported prototype asset changed. Existing clinical rules, data scoping and immutable prescriptions remain in place.

## Executed evidence

Machine-readable results: [workspace-ui-results.json](workspace-ui-results.json).

| Check | Result |
|---|---|
| JDK 17 debug build and instrumentation APK build | Passed |
| App JVM suite | 51 tests, zero failures/errors |
| Android lint | Zero errors; 88 advisory warnings remain |
| Pixel 6 AVD, Android 15/API 35 UI suite | 22 tests passed |
| Final shared-component/resource recheck | Five workspace UI tests passed |
| English/Filipino resources | 382 strings per locale; format parity passed |
| Text contrast | Seven checked foreground/background pairs meet 4.5:1 |
| Module boundaries | No platform/backend dependencies introduced into pure Kotlin modules |

The emulator suite covers authentication and recovery, administrator confirmation, history charts and invalid dates, Filipino accessibility, prescribed focus and live measurement controls. New tests cover disabled repeat submission and recovery, truthful loading/no-empty states, retry behavior, doubled-text action reachability, portal navigation and home composition. The JVM suite adds parent-route checks and verifies that administrator mutation progress lasts through the subsequent directory refresh.

Build command: `gradlew.bat -p android :app:assembleDebug :app:testDebugUnitTest :app:lintDebug :app:assembleDebugAndroidTest`. The installed application was launched successfully on the emulator after testing. Instrumentation transcripts are [the 22-test run](ui-refinement/instrumentation.txt) and [the final five-test recheck](ui-refinement/final-instrumentation.txt).

Visual inspection used synthetic Compose fixtures with the actual production composables. Screenshots contain no patient records: [landing](ui-refinement/landing.png), [patient home components](ui-refinement/patient.png), [loading](ui-refinement/loading.png), and [double-text actions and retry](ui-refinement/large-text.png). The home fixture demonstrates the shared components; it is not a screenshot of a live authenticated patient workspace. A separate installed-app launch/landing check passed.

The structural graph helped identify screen/state dependencies; three files had partial parser extraction, so source inspection and the Kotlin compiler were used to verify the implementation. Graph scratch data stays under ignored `tmp/` and does not replace `docs/PLAN.md`.

## Deferred verification

Physical phones, TalkBack behavior, representative-user task completion and therapist review of wording remain unexecuted in [POST-IMPLEMENTATION-CHECKLIST.md](POST-IMPLEMENTATION-CHECKLIST.md). Automated resource coverage and emulator layouts do not replace those checks. S5 clinical, security and release issues remain open; this UI refinement does not satisfy those release gates.
