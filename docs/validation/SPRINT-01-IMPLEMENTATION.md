# Sprint 1 implementation and verification

The engineering implementation is available and verified locally, including the running Docker/Supabase backend and ignored environment configuration. Current closure review: S1 remains in progress because MOT-02 has a real remote Android CI setup failure; its configuration fix awaits publication and a passing rerun. Therapist and two-device checks are explicitly deferred and do not block engineering closure. The sections below preserve historical S1 evidence. See [closure review](IMPLEMENTATION-CLOSURE.md); software checks are not clinical approval or physical-device validation.

## Delivered

- Kotlin/Compose app with three modules, Hilt, pinned toolchain, wrapper, build variants, English/Filipino resources and a Stitch-derived theme.
- CameraX/MediaPipe skeleton prototype with rotation/mirror geometry, latest-frame backpressure, lifecycle cleanup, app-settings permission recovery, system-back navigation and bounded FPS/p95-latency/thermal diagnostics. Images and landmarks stay on-device. Clinical ROM and repetition assessment remain Sprint 2 work.
- Separate registration, email-code confirmation, sign-in and recovery forms, plus refresh/logout. Client validation and duplicate-submit guards cover all requests; failed refresh removes the session. Notices use English/Filipino resources without raw backend errors. Roles come from protected server records; tokens remain memory-only.
- Twelve PostgreSQL application tables, signup provisioning, RLS, immutable history/version records, ownership constraints, indexes, synthetic seed and executable access/auth checks.
- Local confirmation/recovery templates and captured email; unnecessary analytics/vector is disabled without exposing the Docker daemon over TCP.
- Ignored android/.env with local endpoint/public key, safe android/.env.example and setup script. No service-role key is added to the app. Debug local HTTP has explicit host/port restrictions; release stays HTTPS-only.
- Android/database CI definitions and a clean-source verification command. Remote GitHub Actions execution remains pending commit/push.
- Draft therapist protocol, native UX specification and database/retention decisions under docs/.

## Verified results

| Check | Result and evidence |
|---|---|
| Earlier S1 clean-source baseline | PASS; current UI/runtime change is verified by wrapper build, lint, unit tests and emulator checks |
| Android unit tests | 23 pass: 9 auth/API transport, 8 auth/dashboard state, 3 geometry, 3 diagnostics; android-test-results.json |
| Android lint | Zero errors; pinned dependency upgrade/style warnings remain |
| Schema and synthetic seed | Fresh startup and local reset execute successfully |
| PostgreSQL access/integrity tests | All 18 pgTAP assertions pass; database-test-results.log |
| Real local Auth/API/email | All 23 checks pass; local-auth-results.json |
| Core module imports | scripts/check_module_boundaries.py passes |
| Sprint records | scripts/sync_sprints.py --validate-only passes |

The local auth run also verifies four authorized dashboard reads. It covers two registrations and confirmations, pre-confirmation rejection, forged signup-role rejection, API patient isolation, self-promotion denial, password login, refresh, captured recovery code, password replacement, old-password rejection, logout and revoked/invalid refresh rejection. It uses real local GoTrue/PostgREST and captured email, not hosted SMTP or physical-device transport. Synthetic accounts are removed after testing.

The SQL suite covers immutable prescriptions, nonnegative counts, cross-patient foreign keys, patient A/B isolation, protected fields, role tampering, assigned/unassigned therapists, administrators, anonymous denial, child measurements and revocation. Fixtures are rolled back.

The first startup exposed an optional vector/analytics health failure; disabling analytics resolved it. An early test before migration application was not a valid acceptance run. The recorded passing suite follows successful schema application. Docker runtime validation is no longer blocked.

## Remaining acceptance evidence

| Issue | Remaining work |
|---|---|
| MOT-01 | Licensed therapist approves exercises, conventions, protocol and data handling; populate actual two-phone inventory |
| MOT-02 | Review clean-source/workflow evidence; execute remote CI after commit/push |
| MOT-03 | Schema, seed, constraints, indexes/ERD and retention boundary implemented and locally verified |
| MOT-04 | Local server and adapter checks pass; dependent foundation review and on-device/hosted email checks remain identified |
| MOT-05 | Two physical device classes: camera alignment, rotation, frame rate, latency, thermal behavior and exercise go/no-go |
| MOT-06 | Therapist wireframe review, patient comprehension, large text/screen-reader and terminology review |

No physical Android phone was connected. No therapist approval or participant measurements have been fabricated. Model provenance is in pose-model.json; distribution terms need review before release. The debug APK is android/app/build/outputs/apk/debug/app-debug.apk. See docs/operations/DEVELOPMENT.md for setup and verification commands.


## Emulator and native UI correction

The x86_64 JNI load crash is fixed through consistent ARM packaging, verified on emulator-5554 using ARM translation. Live camera frames process without closing the app, including pause/resume. Native Stitch-based role cards, dashboards, list/progress/profile navigation and camera flow now replace the earlier palette-only adaptation. Dashboard reads use authenticated backend data; prescription saving, guided exercise recording and ROM chart integration remain incomplete. See EMULATOR-CAMERA-FIX.md and docs/architecture/UI-UX.md.
