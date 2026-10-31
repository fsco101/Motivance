# Native UI and UX specification

Use `stitch_galawgo_rehabilitation_system_prototype/` as the design basis, including `kinetic_clinical_precision/DESIGN.md`, role selection, camera positioning and real-time assessment. Preserve imported files unchanged. Use Motivance branding in Kotlin Compose; do not package HTML/Tailwind or sample patient data into the application.

S1 translates the navy (#002042), teal (#006A61), pale blue surfaces (#F8F9FF), readable type hierarchy and generous spacing into a native theme. Primary controls are at least 56dp high; large font settings must not clip labels. Cards should use 16-24dp radii and inputs 8dp. Typography currently uses Android's accessible system fallback; bundling Plus Jakarta Sans needs its licence and font files reviewed first. Do not fetch fonts at runtime to start an exercise.

The native implementation now includes the reference's role-selection composition (branded header, introduction, stacked clinician/patient cards and portal actions), card-based patient/therapist home screens, bottom navigation, patient list, exercise list, progress and profile layouts, prescription form layout, camera positioning checklist, live preview controls and camera-check completion. Header/system bars respect safe drawing insets. The shared body color and pale-blue surfaces follow the clinical design tokens.

Dashboard names, patient lists, recent sessions (up to 20) and active assignment counts are loaded through authenticated Supabase requests and RLS. Loading, error and empty states are distinct. Logout discards overview data and late responses cannot repopulate it for a signed-out user. Role cards select a login portal, never grant staff privileges. Backend prescription writes, prescription-detail/guided sessions and ROM chart data integration remain scheduled work: the assignment form is visibly unavailable, ROM charts show an empty state, and ending the camera check never claims to save a rehabilitation session. Prototype patient names, numeric outcomes, accuracy/certification badges and institution claims are not copied into live records.

## Flow mapping

| Reference | Native flow | Sprint |
|---|---|---|
| Role selection | Sign-in and server-authorized role routing; role cards never grant privileges | S1 auth shell; full role flows S3-S4 |
| Patient home, exercise guide | Downloaded assignments -> instructions -> camera setup -> session | S3 |
| Camera positioning, real-time CV | Phone placement -> permission -> landmarks -> readable tracking state | S1 prototype; S2 assessment |
| Movement correction, completion | Feedback -> finish -> saved/pending-sync summary | S2-S3 |
| Therapist dashboard, patient management | Assigned patient list -> permitted patient detail | S3 |
| Exercise assignment, ROM thresholds | Versioned prescription form with validation | S3 |
| Patient progress, therapist monitoring | Exercise/side-specific comparable trends and quality indicators | S4 |

## Screen and state contract

Login provides loading, neutral recovery acknowledgement, confirmation-required and failed-request states. Passwords and OTP codes are not saved with Compose saved state. S1 uses memory-only tokens and requires sign-in after app restart. A user with multiple trusted roles will choose a workspace only from roles returned by the server. A missing backend configuration produces an actionable error; the camera feasibility screen is independent of authentication because it records/uploads no data.

The implemented auth flow now shows one form at a time: Sign in -> Register -> Confirm email, or Sign in -> Request recovery -> Verify recovery/new password. A back-to-sign-in action is available from secondary forms. Registration/recovery acknowledgements move to their corresponding code-entry forms. Client validation rejects missing email/password/code before contacting the server. Busy state disables repeated actions, including while logout cleans up remotely. Failed refresh clears the visible session and uses a localized session-expired notice. Backend error payloads are not displayed verbatim. The authenticated shell displays only server-returned roles; complete workspaces remain scheduled for later sprints.

Camera setup explains secure phone placement and visible joints before requesting camera permission. Denied permission leaves a retry/back path; permanently denied users can enable the permission through Android settings. Camera absence or model failure has readable text and an exit. Backgrounding releases the camera and discards the rendered frame. S1 provides no fabricated angle, repetition count or target-success indicator.

The camera screen includes an app-settings shortcut when permission is denied and rechecks permission on resume. System Back returns from the camera to the auth shell. Camera errors and diagnostic labels use English/Filipino resources. A zero-size camera canvas does not construct an invalid coordinate transform, which protects transitions and large-text layouts from a geometry crash. Physical accessibility validation is still required.

The skeleton prototype displays the same rotated bitmap used for inference, centered with letterboxing; mirrored front-camera landmarks use the same geometry. Tracking lost is communicated in text as well as marker visibility. In S2, the agreed clinical quality gate must be stricter and joint-specific. Place future Start/Pause/Finish controls within comfortable reach and keep the joint view unobstructed, following the reference camera HUD.

Patient screens must specify empty assignment, expired assignment, offline cached, missing instructions/model, tracking lost, interrupted and pending/rejected upload states. Therapist screens need empty list, loading, access revoked, invalid targets and prescription-version change states. Sample values and disabled future features must never appear as real patient progress.

## Accessibility and consent review

Use English/Filipino resources for patient-critical text; review clinical wording with the therapist. Do not convey progress solely by color or icons. Support large font and screen-reader labels. Avoid flashing tracking feedback. Camera permission and patient data consent must be separate actions. The S1 screen is a local camera prototype and explicitly states it does not collect rehabilitation records.

Pending evidence: therapist wireframe review, representative patient comprehension testing, screen-reader/device checks and large-font screenshots. This specification plus the theme is implementation input, not a claim that user review occurred.

## Sprint 2 implementation update

The camera flow now follows the Stitch assessment pattern with a live skeleton, readable quality banner, measured angle, prescribed/demo thresholds, rep target, ROM, incomplete count, active duration and text feedback. All critical new copy has English/Filipino resources. The preview uses a fixed-height letterboxed surface inside a scrolling screen so controls remain accessible on smaller displays. Current frame geometry and assessment timestamp come from the same inference result; filtered angle deliberately lags raw skeleton movement by approximately one valid frame.

Development exercise/side chips are available before demo session creation; assigned prescription sides/targets cannot be changed through those chips. Supported downloaded patient prescriptions have a distinct selection and show their cached instructions. Rules freeze when a session starts. Start is gated by fresh stable visible joints and separate consent to store aggregate metrics. Pause, finish/save retry, explicit interrupted recovery, saved summary and owner-filtered history are implemented. A local save is distinguished from an acknowledged upload. Demo controls cannot start measurement in release builds. S1 statements above describe its historical boundary; current recording stores aggregate results after consent, while continuing to store no images/video/pose traces.

## Sprint 3 and supplied logo

The supplied Motivance PNG appears without tint in landing/auth/dashboard headers, the live-assessment title and the adaptive launcher icon. Its original source is preserved; the Android copy uses `drawable-nodpi` to avoid density upscaling. Stitch spacing, navy/teal cards and native flows remain the design basis.

Therapists can create email-bound invitation codes, inspect linked patients/results, revoke access and publish/edit immutable prescription versions in a validated native form. Patients can accept an invitation using their confirmed email, refresh their assignment list, read cached instructions/targets/download time/version and start an unexpired assignment. Unsupported or expired data have readable refresh/contact messages.

Profile exposes owner-scoped pending/uploaded/auth-required/failed/rejected/legacy-review states, explicit Sync, consent withdrawal and export/deletion request status. Passwords are never requested by a therapist. Runtime tokens use Keystore protection and restore after restart; uploaded is displayed only after server acknowledgement. Privacy request submission displays awaiting-review status, not a completed export or erasure claim.

The user's therapist/physical-device review is deferred to `docs/validation/POST-IMPLEMENTATION-CHECKLIST.md` and does not block these development flows. Emulator evidence includes the supplied header logo, both role logins, protected restart, linked patient/prescription detail and patient cached-assignment display. Broader accessibility, patient comprehension and physical camera/reference checks remain explicitly listed follow-up tasks.

## Authentication design refinement

Loading, login, patient signup, email confirmation and password recovery share a pale mint/blue background, supplied Motivance logo, navy headings, teal portal label and white 24dp-radius form surface. Forms cap their width at 480dp, scroll on compact displays and account for the keyboard. Primary buttons remain at least 56dp high; the camera setup is a secondary action. Login copy distinguishes patient and therapist workspaces, and the therapist portal does not offer patient signup.

Startup displays an indeterminate branded loading screen only while checking the stored session, with no artificial delay or percentage. Failed/empty restoration returns to the unauthenticated flow. Form submission shows an action-specific loading label and disables repeat submissions/navigation. Notices use readable text and a polite accessibility live region. Email keyboards, Next/Done actions, show/hide password and separate new-password/code labels support the forms. Switching forms clears passwords, codes, visibility and stale notices; passwords and codes are never stored in saved instance state. Email and the current form survive configuration recreation. New copy has English and Filipino resources.

This refines the existing email/password flow without adding Gmail authentication, media sharing or a new sprint. Evidence is recorded in [AUTH-UI-REFINEMENT.md](../validation/AUTH-UI-REFINEMENT.md). Physical-device, TalkBack and therapist wording reviews remain deferred in the post-implementation checklist.

## Sprint 4 history and progress

Progress and therapist patient detail now share native history filters and Canvas charts. Therapists first choose one linked patient; patients are fixed to their own account. Filters select an exercise definition version, anatomical side and optional inclusive UTC calendar dates. Invalid or reversed dates show a correction message and hide earlier results. Loading, no matching uploads, failed access/network, refresh and older-page states are explicit. Pending offline records remain in Local history until uploaded.

Each chart identifies its immutable prescription version, original degree/repetition targets, metric, model and algorithm. Different prescriptions, exercise versions, sides and provenance never share a line. ROM and completed repetitions have separate labeled scales; the horizontal axis is chronological session order. Limited, invalid, interrupted or missing metrics leave gaps. Detailed cards retain all child metrics, extrema/ROM units, counts, tracking quality/frame totals and completed/partial/interrupted/empty/invalid status. Charts summarize the loaded pages only and make no clinical-improvement claim. New copy has English and Filipino resources; terminology and physical accessibility review remain deferred.
