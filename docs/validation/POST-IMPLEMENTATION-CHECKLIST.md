# Post-implementation checks for Sprints 1 through 4

The user explicitly deferred therapist and physical-device checks until after implementation. These checks are **follow-up verification, not development blockers**. Leave unexecuted checks unchecked and record actual results; implementation does not itself establish clinical accuracy. The supported development catalogue is usable without therapist sign-off.

Solved implementation issues and implemented sprint milestones may close while these checks remain unexecuted, per the user's standing instruction. Preserve their original false acceptance records and explicit deferrals in sprint JSON. A closed implementation issue never represents therapist approval or a physical/clinical test pass. Confirm the S1 protocol approval owner, actual two-phone inventory, wireframe review and exercise feasibility decisions during the corresponding checks below.

## Installation and logo

- [ ] Open `android/`, sync Gradle with JDK 17, and run the debug `app` on the intended phone.
- [ ] Confirm the supplied Motivance logo appears on the launcher and landing/auth/dashboard headers; check a circular and a rounded-square launcher mask.
- [ ] Check readable contrast, 48dp touch targets, English/Filipino copy, large fonts and TalkBack. Check form validation and scrolling with the keyboard visible.
- [ ] Review the refined loading/login/signup/recovery screens on physical phones: TalkBack password visibility labels and loading/error announcements, keyboard Next/Done, rotation with credentials cleared, and patient/therapist wording. Emulator screenshots and synthetic flow tests are recorded in `AUTH-UI-REFINEMENT.md`; these physical and human checks remain unexecuted.
- [ ] Verify emulator/USB-phone/hosted URL selection using `docs/operations/ENVIRONMENT.md`. Test the two local accounts; no privileged key should exist in the APK.

## Therapist-to-patient workflow

- [ ] Therapist creates an invitation for an email without entering a patient password. Patient registers/confirms that email, accepts the shared code and appears in the therapist's list. A mismatched email and expired invitation must fail.
- [ ] Create left/right elbow-flexion and shoulder-abduction prescriptions, including low/high targets, repetitions, cycle timing, hold and visible trunk-lean threshold.
- [ ] Edit a prescription and confirm a new version is appended. A session already started retains its original version/targets.
- [ ] Patient refreshes Exercises, sees instructions, version and last download time, and starts the selected assignment. Confirm invalid fields are disabled/rejected and an expired cache has a refresh action.
- [ ] Revoke the link. Confirm future therapist reads fail immediately and new queued uploads for revoked assignments are rejected. A disconnected phone can retain downloaded instructions for up to 24 hours; it cannot discover revocation while offline.

## Camera, ROM and repetitions

- [ ] Test front/back camera, portrait/landscape, 0/90/180/270 orientation, denied/revoked permission, background/return and process termination. Resume requires fresh tracking and does not count a partial cycle twice.
- [ ] Verify correct anatomical side, camera plane and required visible joints. Elbow uses a side-on view; shoulder abduction uses a front view. Verify overlay alignment for mirroring and letterboxing.
- [ ] Check no person, two people, occlusion, confidence loss, out-of-frame joints, large position jumps and trunk lean. Invalid frames must show an unavailable angle and preserve valid ROM extrema/counts.
- [ ] Replay full, incomplete, jittering, excessively fast and timed-out cycles. Check feedback and persisted completed/incomplete reason totals.
- [ ] With a qualified therapist, determine positioning, eligibility, comfortable movement limits, exclusions and stop criteria. Compare stationary holds against a documented goniometer/reference convention; do not treat model-estimated depth as reference truth.
- [ ] Record error, human repeatability, repetition agreement and valid/invalid tracking rates per exercise/side/device, including failed samples in denominators. The mathematical sweep in `sprint-02-synthetic-results.json` is code verification only.
- [ ] Review the proposed gates in `SPRINT-01-PROTOCOL.md` before collecting evaluation data: angle MAE <=10 degrees, repeated-hold difference <=5 degrees, count agreement >=95%, tracking coverage >=90%. Record accepted/revised thresholds before observing outcomes; these are provisional engineering gates.

## Offline, consent and uploads

- [ ] Grant movement-summary consent separately from camera permission. Confirm a consent event is stored before the first prescribed session checkpoint, even offline.
- [ ] Complete a cached assignment in airplane mode; restart the app, reconnect and verify exactly one server session plus one measurement record. Check pending/uploaded/failed/auth-required text.
- [ ] Simulate a dropped response after the server commits. The same stored UUID/payload must retry once logically; a changed payload with the same UUID must be rejected.
- [ ] Interrupt during a draft, database write and upload. Drafts restore as interrupted; saved totals remain; upload resumes from the durable outbox.
- [ ] Force expiry/revocation of the refresh token, sign in again, and retry. Confirm another account cannot drain the previous account's outbox. Logout removes tokens and cached prescriptions while retaining owner-scoped pending results.
- [ ] Withdraw consent. New recording requires a new explicit grant; later sessions using the old grant must fail server validation. Earlier completed records remain until the deletion process is reviewed.
- [ ] Submit export/delete requests. Confirm a request ID/status is recorded and shown; the UI must not claim that data/backups have already been erased or exported.
- [ ] Verify a v1-to-v2 Room upgrade preserves existing records. Legacy pending payloads without persisted consent are retained as review-required and are not uploaded retroactively.

## Performance and deployment follow-up

- [ ] On at least a lower-spec and a mid-range physical phone, record model/app/OS/camera, image dimensions, lighting, distance and view. Run a controlled 15-minute test without concurrent host builds.
- [ ] Record processed FPS, median/p95 inference latency, total feedback latency, memory, battery and thermal state. Compare with the provisional median <=150ms / p95 <=250ms gate. The earlier emulator/laptop-webcam p95 of 634ms is a profiling concern, not a measured phone limit.
- [ ] Confirm quality gates, overlay alignment and repetition timing still work after any GPU/resolution/preview optimization.
- [ ] Review the development retention policy: automatic deletion is disabled, records are reviewed after 365 days, and deletion/export requests require a trusted operator. Set actual retention, request turnaround, account deletion and backup expiry in the deployment runbook before collecting pilot data.
- [x] Apply the Gmail sender to local Docker Auth and verify TLS authentication and runtime settings. See `docs/validation/smtp-connection-results.json`. No inbox delivery is claimed; hosted setup is separate.
- [ ] Verify signup delivery to an authorized Gmail inbox, confirmation/resend, unconfirmed sign-in rejection, reset/resend, invalid/expired-code handling, throttling, old-password rejection and new-password sign-in. See `docs/operations/AUTH-EMAIL.md`; local capture, SMTP login and emulator tests do not establish inbox deliverability.
- [ ] Exercise hosted email delivery, production RLS/RPC permissions, protected token restore, signed-release installation, backup restore and incident ownership. Do not copy local fixtures or local passwords into production.

## History and progress follow-up

- [ ] Therapist and patient review Progress in both languages, including exercise-version/side/date filters and patient selection. Check UTC date wording and clinical terminology comprehension.
- [ ] Review separate prescription charts against de-identified reference records. Check original targets, limited/invalid/interrupted gaps, tracking quality and units, and verify that estimates are not interpreted as clinical improvement.
- [ ] Check chart descriptions, filter labels, session cards, large fonts and load-older controls with TalkBack on the supported physical phones. Automated emulator rendering does not establish physical accessibility or clinical usefulness.

## Sprint 4 follow-up

- [ ] Reproduce the reported non-incrementing repetitions on the user's actual phone: record APK/build, selected exercise/side, preview versus Recording status, consent/Start action, tracking message, observed angle sequence and targets. Automated synthetic tests do not establish the specific cause of this physical-device report. Use `docs/operations/LIVE-ASSESSMENT-TROUBLESHOOTING.md` and keep the result unexecuted until observed.

- [ ] On physical phones, verify therapist-selected shoulder/elbow/wrist/hip/knee/ankle rings on each prescribed side, including mirror/rotation, low confidence and occlusion. Confirm users understand the distinction between the visual focus and the exercise joint actually measured. These focus options do not establish additional supported exercise algorithms.

- [ ] Review the administrator workspace on physical phones: account enable/disable, grant/revoke staff, link/revoke and catalogue version publication. Confirm identity/custody for the initial trusted admin; never create admin access through signup metadata.
- [ ] Review all English/Filipino terminology with the therapist and representative phone users. Automated resource/format parity, contrast calculations and a double-font emulator test do not establish human comprehension or TalkBack usability.
- [ ] Measure task completion, setup mistakes and feedback comprehension for assigned exercise start/finish, history review and recovery. Record participants, protocol and observed difficulties without identifying patient images.
- [ ] Exercise severe-heat pause/cooling/retry and longer sessions on both physical device classes. Bounded synthetic 30-minute diagnostics and simulated movement tests do not measure phone memory, camera accuracy, battery or thermal performance.
- [ ] Complete the owner-dependent items in `docs/operations/PRODUCTION-READINESS.md`: account verification/testing schedule, signing custody, actual retention/backup expiry, privacy notice/deletion URL, model distribution terms and production support ownership.
- [ ] Before Play release, upgrade the tested target/compile SDK tuple for current API-36 submission requirements and verify native 16 KB page compatibility. Preparation documentation does not satisfy these S5 release checks.

## Recording results

For each check record tester/date, app commit/version, device/OS, setup, expected/actual result and de-identified evidence. Store reports in `docs/validation/`. Keep private camera/participant images out of the public repository. Open corrective issues for failures and update sprint JSON with executed evidence; do not mark a deferred physical check as passed by substituting a unit test.
