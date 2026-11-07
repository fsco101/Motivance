# Post-implementation checks for Sprints 1 through 4

The user explicitly deferred therapist and physical-device checks until after implementation. These checks are **follow-up verification, not development blockers**. Leave unexecuted checks unchecked and record actual results; implementation does not itself establish clinical accuracy. The supported development catalogue is usable without therapist sign-off.

Solved implementation issues and implemented sprint milestones may close while these checks remain unexecuted, per the user's standing instruction. Preserve their original false acceptance records and explicit deferrals in sprint JSON. A closed implementation issue never represents therapist approval or a physical/clinical test pass. Confirm the S1 protocol approval owner, actual two-phone inventory, wireframe review and exercise feasibility decisions during the corresponding checks below.

## Installation and logo

- [ ] Open `android/`, sync Gradle with JDK 17, and run the debug `app` on the intended phone.
- [ ] Confirm the supplied Motivance logo appears on the launcher and landing/auth/dashboard headers; check a circular and a rounded-square launcher mask.
- [ ] Check readable contrast, 48dp touch targets, English/Filipino copy, large fonts and TalkBack. Check form validation and scrolling with the keyboard visible.
- [ ] Review the refined patient/therapist home cards, parent-screen Back controls, administrator sections, expandable filters/timing fields, and operation-specific loading/error announcements on physical phones with representative users in both languages. Emulator evidence is recorded in `WORKSPACE-UI-REFINEMENT.md`; therapist wording, TalkBack and physical-device usability remain unexecuted.
- [ ] Review the refined loading/login/signup/recovery screens on physical phones: TalkBack password visibility labels and loading/error announcements, keyboard Next/Done, rotation with credentials cleared, and patient/therapist wording. Emulator screenshots and synthetic flow tests are recorded in `AUTH-UI-REFINEMENT.md`; these physical and human checks remain unexecuted.
- [ ] Verify emulator/USB-phone/hosted URL selection using `docs/operations/ENVIRONMENT.md`. Test the two local accounts; no privileged key should exist in the APK.

## Therapist-to-patient workflow

- [ ] Review the detailed signup/privacy agreement and profile editing with representative users in both languages: age derived from birthdate, immutable email, profile photo upload, current-password verification and connected-therapist demographic visibility. Review privacy wording, consent comprehension and any minor/guardian procedures with the deployment owner before live enrollment. These human/physical checks remain unexecuted; automated profile checks are separate engineering evidence.
- [ ] Configure a real Cloudinary account with `scripts/configure_cloudinary.py --check --apply`. Then, on a physical phone, upload, replace and remove a profile photo. Confirm a linked therapist and an administrator see it, an unrelated account does not, and an administrator can remove it. Run `scripts/cleanup_profile_photos.py --apply` and confirm the retired asset is gone from the Cloudinary Media Library. Engineering tests used simulated Cloudinary responses only (`PROFILE-PHOTOS.md`).
- [ ] Have the deployment owner review whether the `system-purpose-v1` privacy agreement needs a new version that names profile photos and Cloudinary as an image processor. The app currently shows a just-in-time notice on the photo card and leaves the agreement text unchanged.
- [ ] With representative patients on physical phones, in both languages, review the 4-step signup flow from `SIGNUP-STEPPED-FLOW.md`:
  - The step progress is understood, and Back/Edit return to the right place without losing entries.
  - The errors shown after Continue are clear.
  - The password checklist is understood.
  - The privacy key points are read before consent, and "Read the full agreement" is found.
  - TalkBack announces the step header, requirement states, avatar radio tiles and errors.
  - The keyboard Next/Done order works.
  - A fluent reviewer checks the new Filipino strings, and the deployment owner confirms the privacy key points match the full agreement.

- [ ] Therapist creates an invitation for an email without entering a patient password. Patient registers/confirms that email, accepts the shared code and appears in the therapist's list. A mismatched email and expired invitation must fail.
- [ ] Create left/right elbow-flexion and shoulder-abduction prescriptions, including low/high targets, repetitions, cycle timing, hold and visible trunk-lean threshold.
- [ ] Edit a prescription and confirm a new version is appended. A session already started retains its original version/targets.
- [ ] Patient refreshes Exercises, sees instructions, version and last download time, and starts the selected assignment. Confirm invalid fields are disabled/rejected and an expired cache has a refresh action.
- [ ] Revoke the link. Confirm future therapist reads fail immediately and new queued uploads for revoked assignments are rejected. A disconnected phone can retain downloaded instructions for up to 24 hours; it cannot discover revocation while offline.

## Camera, ROM and repetitions

- [ ] Test front/back camera, portrait/landscape, 0/90/180/270 orientation, denied/revoked permission, background/return and process termination. Resume requires fresh tracking and does not count a partial cycle twice.
- [ ] Verify correct anatomical side, camera plane and required visible joints. Elbow uses a side-on view; shoulder abduction uses a front view. Verify overlay alignment for mirroring and letterboxing.
- [ ] On physical phones with real pose output, check the calculation overlay from `SKELETON-CALCULATION-OVERLAY.md`:
  - The protractor stays on the measured joint, front and back camera, in portrait.
  - The 0° reference, the low/high ticks and the live arc match a goniometer reading at the therapist thresholds.
  - The step cards and hold bar follow real repetitions.
  - The gauge and step announcements work with TalkBack.
  - Therapists review the rule sentence and source line, and a fluent reviewer checks the new Filipino strings.
- [x] Rerun `CameraLifecycleTest` on an emulator. It first failed on 2026-11-04 on the Pixel_6 AVD because its host-webcam camera never opened (CameraX stuck in `PENDING_OPEN`). The same day, after a cold boot (`-no-snapshot-load`), the full instrumented suite passed 48/48, including this test. This is an emulator engineering check only; the physical-phone camera checks above remain unexecuted.
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
- [ ] On physical phones in both languages, review the redesigned administrator workspace (2026-11-04): overview counts and attention items, directory search and filters, account ID copy, role switches, link pickers (including pasted IDs), catalogue editor counters and the activity feed. Have a Filipino speaker review the new administrator wording, and check TalkBack on the role switches, chips and confirmation dialogs. Emulator evidence only is recorded in `ADMIN-WORKSPACE-REDESIGN.md`.
- [ ] Review all English/Filipino terminology with the therapist and representative phone users. Automated resource/format parity, contrast calculations and a double-font emulator test do not establish human comprehension or TalkBack usability.
- [ ] Measure task completion, setup mistakes and feedback comprehension for assigned exercise start/finish, history review and recovery. Record participants, protocol and observed difficulties without identifying patient images.
- [ ] Exercise severe-heat pause/cooling/retry and longer sessions on both physical device classes. Bounded synthetic 30-minute diagnostics and simulated movement tests do not measure phone memory, camera accuracy, battery or thermal performance.
- [ ] Complete the owner-dependent items in `docs/operations/PRODUCTION-READINESS.md`: account verification/testing schedule, signing custody, actual retention/backup expiry, privacy notice/deletion URL, model distribution terms and production support ownership.
- [ ] Before Play release, upgrade the tested target/compile SDK tuple for current API-36 submission requirements and verify native 16 KB page compatibility. Preparation documentation does not satisfy these S5 release checks.

## Motion arc redesign follow-up (2026-11-05)

- [ ] On both physical phone classes, check that repetition, start, copy and save haptics are noticeable but not startling, and that a counted repetition is felt during movement. Emulator runs cannot exercise vibration.
- [ ] Have therapists drag the prescription range arc with real fingers: 5° snapping, 15° minimum span, accidental page scrolling, and parity with the typed angle fields. Check the arc and typed fields with TalkBack.
- [ ] Confirm that patients and therapists discover pull-to-refresh, or use the Refresh button, on Home, Exercises, Patients, Progress and Profile. Check that the dark session stage and its light status-bar icons restore correctly after leaving the camera.
- [ ] Have a Filipino speaker review the new copy (greeting, Today card, weekly strip, copy code, show/hide details, drag help, counting heading). Have a therapist confirm the Today card and "of 7 days" weekly wording do not imply adherence targets. Evidence so far is emulator-only: `MOTION-ARC-REDESIGN.md`.

## Assignment delivery and action toasts follow-up (2026-11-05)

- [ ] On two physical phones, keep a patient signed in on Home or Exercises while a therapist publishes. Confirm the exercise and its toast arrive within about 30 seconds, and again after leaving and reopening the app. Repeat on mobile data and with the network off then on. Emulator evidence only: `ASSIGNMENT-DELIVERY-AND-TOASTS.md`.
- [ ] Check that all toasts stay readable for their full 5 seconds with representative users, including the two-line messages at large font sizes, and that TalkBack announces them. Check that TalkBack reaches the close button and that users understand the time bar. Decide with those users whether 5 seconds is long enough for people who read slowly, because a toast cannot be paused.
- [ ] Have a Filipino speaker review the new `toast_*` strings and the revised `ui_prescription_published` text.
- [ ] Exercise the session start, pause, save and upload toasts on a physical phone with a real person in frame, and confirm they do not obscure guidance during movement. Automated checks used synthetic landmarks.

## Assigned camera rules follow-up (2026-11-05)

- [ ] On a physical phone with a real person in frame, run an assigned exercise through Start, finish, "Check camera again" and "New session", and confirm the camera shows Prescribed throughout and the results reach the therapist. Automated checks used synthetic landmarks. Evidence scope: [assigned camera rules](ASSIGNED-CAMERA-RULES.md).
- [ ] Have a therapist confirm that Camera check opening on the assignment is acceptable, since consent and Start there record a real assigned session.
- [ ] Have a Filipino speaker review the revised `use_cached_prescription` text.

## Custom exercises follow-up (2026-11-05)

- [ ] On a physical phone with a real person in frame, run a custom exercise for each of the six joints and compare the angle with a goniometer. Wrist and ankle use finger and foot landmarks that have had no real-person check. Evidence scope: [custom exercises](CUSTOM-EXERCISES.md).
- [ ] Have a therapist try the form and confirm the joint choices, the angle starting points and the upright-only limit are understood.
- [ ] Have a therapist decide whether movements that work toward straight, such as seated knee extension, need a direction setting. Today the hold and guidance fall at the bent end.
- [ ] Decide whether therapist-written exercises need review before patient use. They currently reach a patient without one.
- [ ] Have a Filipino speaker review the new `custom_*` and `toast_exercise_*` strings.

## One sign-in page follow-up (2026-11-05)

- [ ] On a physical phone, sign in as a patient, a therapist and an administrator and confirm each reaches the right workspace. Evidence scope: [one sign-in](ONE-SIGN-IN.md).
- [ ] Run `CameraLifecycleTest` on a device with a working camera. It cannot pass on the current emulator, which reports no cameras.
- [ ] Have a Filipino speaker review the revised `auth_sign_in_description` text.

## Web foundation follow-up (2026-11-05)

- [ ] Have the project owner review the web designs at `/design` and approve them, or list changes, before S7 feature screens start. Evidence scope: [web foundation](WEB-FOUNDATION.md).
- [ ] Have a therapist and an administrator try the prototype and confirm the screens match how they work. Have a therapist confirm the home fan reads clearly and implies no score.
- [ ] Have a Filipino speaker review the web text in `web/src/locales/fil.json`. Most of it comes from Android, but the sign-in, idle, home and assignment text is new.
- [ ] Check the motion on a typical clinic computer. The 60 frames per second result came from a development machine.

## Therapist web workspace follow-up (2026-11-05)

- [ ] In the browser, invite a patient, create a custom exercise and assign it. On a physical phone, run it as that patient, then review the result and its charts in the browser. The automated check stops at Android's decoder. Evidence scope: [therapist web workspace](WEB-THERAPIST.md).
- [ ] Have a therapist work through a normal day in the web workspace and confirm it fits how they work, including the editor's steps and the wording on the patient cards.
- [ ] Have a Filipino speaker review the new web text in `web/src/locales/fil.json`, including the custom exercise, version and removed exercise messages.
- [ ] Try the patient list and assignment editor with a screen reader. The automated checks cover keyboard use and the axe rules, not a person listening to the pages.

## Administrator workspace and staff profile follow-up (2026-11-05)

- [ ] Perform every administrator task side by side in Android and the browser, and compare the results and audit records. Evidence scope: [administrator workspace](WEB-ADMIN-PROFILE.md).
- [ ] With a real Cloudinary account configured, upload a staff photo from a browser and confirm it appears across the app. The automated test stands in for Cloudinary's endpoint.
- [ ] Have an administrator try the workspace and confirm it fits how they work.
- [ ] Have a Filipino speaker review the new administrator and profile text in `web/src/locales/fil.json`.

## Continuous integration follow-up (2026-11-05)

- [ ] If GitHub Actions becomes available, confirm that Web checks, Android checks and Database checks pass in full, including `scripts/check_admin_parity.py` and the longer limit in `no sideways page scroll`. Until then these run locally only. The owner deferred this because the account is on GitHub's free tier.

## Exercise guide follow-up (2026-11-05)

- [ ] Have a therapist watch the guide for every joint, seated and standing, and confirm each movement is safe and correct to show patients. Evidence scope: [exercise guide](EXERCISE-GUIDE.md).
- [ ] On a physical phone with animations on, confirm the guide moves smoothly on the patient exercise list, where several can play at once.
- [ ] Try the guide with TalkBack, and have a Filipino speaker review its spoken description.

## Booking and scheduling follow-up (2026-11-06)

Evidence scope: [booking implementation](BOOKING-IMPLEMENTATION.md).

- [x] On a spare emulator, run `scripts/test_role_routing.py` and confirm a Scheduler sees the note that scheduling is on the web, with no clinical tabs. Passed on 2026-11-06 on an API 35 emulator, 3 runs of 3 on the final build. It clears app data, so do not use a working emulator.
- [ ] On a physical phone, book, follow and cancel a session at large text sizes and with TalkBack. Check the date cells, which are narrower than 48 dp on a small screen.
- [ ] On a physical phone, run the S9 demo in one sitting: grant the Scheduler role, request a session on the web and on Android, confirm one request and reject another in the Scheduler table, and show two requests racing for the last place. Each step has passed in automated runs, but not as one sitting on a phone.
- [ ] On a physical phone, read My Schedule as a patient and as a therapist at large text sizes and with TalkBack. Check that a date reads its session count, and that an unlinked patient's card offers no record.
- [ ] On a physical phone, read notifications at large text sizes and with TalkBack, including that an unread one is announced as unread.
- [ ] On a physical phone's browser, walk through the patient workspace: home, exercises, progress, profile, and the suggestion to use the app.
- [ ] Once the app has a public address, set `VITE_ANDROID_APP_URL` and confirm the store link and QR code open it on a phone.
- [ ] On a phone with a working camera, withdraw consent on the web, then record a session: confirm it asks again and the session uploads. `SessionStoreTest` covers the storage step and passes on an emulator, but the whole journey has not been run.
- [ ] On a hosted project, follow `docs/operations/NOTIFICATIONS.md` and confirm a real email reaches an inbox through Gmail on port 465. Local runs resolve the mail server by address, so this also proves the mail library can look up `smtp.gmail.com` from a hosted Edge Function.
- [ ] Add a session to a real calendar from an email, reschedule it, and confirm the calendar updates the same entry. Google Calendar and Apple Calendar treat downloaded files differently, so check both.
- [ ] Have a Filipino speaker review the booking and scheduling text in `web/src/locales/fil.json`, `android/app/src/main/res/values-fil/strings.xml` and `supabase/functions/_shared/email.ts`.
- [ ] On a physical phone, join a waitlist for a full time, watch the place open from a second account, and book it from My bookings. It passed on an emulator against the local backend; a real phone and a real network have not been tried.
- [ ] On a physical phone, move a session from My bookings, and check that a date with no free time still reads clearly at large text sizes and with TalkBack.
- [ ] On a physical phone, mark a session attended, correct it to a no-show, and check the two marks read clearly at large text sizes and with TalkBack. It passed on an emulator against the local backend.
- [ ] Sign up on the web with a real inbox, on a hosted project, and confirm the code arrives and works. Browser tests hold back the send, because local Auth sends through a real mail account.
- [ ] Have a Filipino speaker review `web/src/locales/landing.fil.json`.
- [ ] With the owner's Firebase project and credentials, follow `docs/operations/NOTIFICATIONS.md`, and confirm a real push reaches a real phone, that tapping it opens Notifications, and that a lock screen hides its text. Tests so far use a stub FCM server, and no real token has ever been issued.

## Recording results

For each check record tester/date, app commit/version, device/OS, setup, expected/actual result and de-identified evidence. Store reports in `docs/validation/`. Keep private camera/participant images out of the public repository. Open corrective issues for failures and update sprint JSON with executed evidence; do not mark a deferred physical check as passed by substituting a unit test.
