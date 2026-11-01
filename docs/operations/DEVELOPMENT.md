# Android development setup

S4 adds the Administrator sign-in portal and server-controlled account/role/link/catalogue operations. The first administrator must be provisioned through a trusted SQL operation for a verified existing account; ordinary registration creates only a patient. Sign in through Administrator, open Administration, and confirm changes before submission. New catalogue instructions require both English and Filipino and append a version; existing prescriptions stay pinned. The app's administrative operations use the public client configuration and signed-in JWT, never a service-role key. `python scripts/test_administration.py` verifies real local Auth/PostgREST with disposable synthetic accounts and preserves existing development records.

Choose English or Filipino on the landing screen or in Profile. The non-sensitive preference survives restart. Bilingual catalogue instructions retain both authored languages in the offline cache; legacy English-only versions remain unchanged. Admins can publish new bilingual versions. Representative terminology and physical accessibility review remain deferred. `python scripts/check_resources.py` verifies resource/format parity and critical text contrast; emulator tests cover a prescribed start control at double font size.

S4 pauses on severe thermal status and displays an advisory after sustained slow processing. Neither is a clinical device-eligibility certification. Interruption invalidates a pending Start, and camera callbacks after disposal/backgrounding cannot update measurements. The checked-in synthetic prolonged-session tests cover bounded state and counts, not physical heat/battery/accuracy. See [production preparation](PRODUCTION-READINESS.md) for environment, migration, signing and distribution steps; no hosted release is created by the local checks.

Open `android/` in Android Studio. The pinned baseline is JDK 17, Gradle 8.11.1, AGP 8.9.1, Kotlin 2.1.20, KSP 2.1.20-1.0.32, Hilt 2.56.1, Compose BOM 2025.04.01, CameraX 1.4.2, MediaPipe 0.10.21, Room 2.8.5 and WorkManager 2.10.5. Versions are in the Gradle catalogue. Install Android platform 35 and build tools 35.0.0; minimum device API is 26.

Start the local stack from the repository root, then create the ignored environment file:

```powershell
npx --yes supabase@2.20.12 start
npx --yes supabase@2.20.12 migration up --local
python scripts/setup_local_env.py
```

`android/.env.example` documents the public client variables. `android/.env` is ignored and contains the local API endpoint, Android emulator endpoint (`10.0.2.2:54321`) and public anon/publishable key only. No service-role key or database password is stored there. The Gradle build reads process environment first, then `android/local.properties`, then `android/.env`; `ANDROID_SUPABASE_URL` maps the emulator endpoint to the app's Supabase URL. Do not print or commit environment contents. Use an HTTPS endpoint for a hosted environment.

Copy `android/local.properties.example` to ignored `local.properties` if an SDK path is needed; omit its sample Supabase values when using `android/.env`. Then run:

```powershell
cd android
.\gradlew.bat :app:assembleDebug :app:lintDebug :app:testDebugUnitTest :core:assessment:test
```

Linux/CI uses `bash ./gradlew` with the same tasks. The debug package is `com.motivance.debug`; the APK is `android/app/build/outputs/apk/debug/app-debug.apk`. A backend-free build can open the local skeleton feasibility screen. It cannot authenticate until configured. Do not put service-role credentials, passwords or signing keys into configuration or source control.

## App missing from the emulator after tests

Connected instrumentation tests can uninstall `com.motivance.debug` during cleanup. On 2026-11-01, the emulator had no Motivance package installed, and the connected-test `utp.0.log` recorded uninstalling both the application and test package. The launcher activity remained correctly declared. Running `:app:installDebug` succeeded, and launching `com.motivance.debug/com.motivance.MainActivity` returned `Status: ok`; the running app was also visually verified on the Pixel 6 / Android 15 emulator.

To reinstall after tests, select the **app** run configuration and the intended device in Android Studio, then click **Run**. Alternatively, from `android/`, run `.\gradlew.bat :app:installDebug`. Select the same emulator you intend to use; installation on an emulator does not install the application on a physical phone. This does not change SMTP settings.

## Backend

For persistent local development logins, run `python scripts/seed_local_accounts.py` from the repository root. It creates confirmed `therapist@motivance.test` and `patient@motivance.test` accounts, assigns their exact roles through trusted local provisioning and links the demo patient to the therapist. Generated passwords are stored only in ignored `docs/operations/local-test-accounts.json`; the script prints no passwords or privileged keys. Reruns reuse these fixture accounts/passwords and refuse to overwrite an unrelated existing account. A local database reset removes the accounts; rerun this script afterward. The original draft catalogue remains unpublished. S3 adds two usable development exercise definitions; `--with-prescription` optionally creates one demonstration elbow assignment without overwriting an existing program. This is not a clinical-approval record.

Use Supabase CLI 2.20.12 and a running Docker engine on the development machine. Run `supabase start`, `supabase db reset` and `supabase test db` from the repository root (or prefix with `npx --yes supabase@2.20.12`). Reset is only for the disposable local stack and removes its current records. The original seed is an unpublished draft; S3 adds supported published development definitions in its migration. The migration's signup trigger creates a patient profile and ignores caller-supplied role metadata. Staff roles and therapist links require trusted SQL/administrative provisioning; there is no client self-promotion endpoint.

Run `python scripts/test_local_auth.py` to exercise registration, confirmation, role isolation, recovery, refresh and logout against real local Auth/PostgREST and captured email. It refuses hosted endpoints, uses synthetic accounts and cleans up their database records. All emails stay in the local mail viewer at `http://127.0.0.1:54324`. Analytics is disabled because it is unnecessary for these checks and its vector service did not work with the default Docker Desktop socket setup; Docker TCP exposure is not required.

Patient-visible tables use RLS, including measurements through the parent session. Prescription/exercise versions and historical results are immutable. Indexes cover authorization joins and patient/time queries. Retention periods await owner approval; historical records are not silently cascade-deleted. Account disable/revocation and controlled export/deletion need the later documented trusted operations.

## Authentication contract

The repository uses Supabase GoTrue and PostgREST/RPC through one OkHttp adapter behind `AuthRepository` and `RehabilitationRepository`. S3 persists access/refresh tokens in an Android Keystore AES/GCM vault, refreshes once on authenticated HTTP 401 and restores a protected session at startup. Email/password login, patient registration, confirmation-code verification, recovery request, recovery-code verification/new password, refresh and logout are implemented. Local confirmation/recovery templates show the single-use `{{ .Token }}` code; link callbacks are not implemented in S1. Hosted email templates must use the same code workflow.

Debug builds permit HTTP only to localhost, 127.0.0.1 or 10.0.2.2 on port 54321 in the auth adapter; their network security configuration allows those local hosts only. Release builds retain HTTPS-only transport and do not include the debug network configuration. An Android emulator uses the generated `android/.env` as-is. For a USB-connected phone, run `adb reverse tcp:54321 tcp:54321`, override the app URL to `http://127.0.0.1:54321`, and rebuild the debug variant. Do not send patient data through the local test environment.

Tokens are encrypted in a backend-scoped, atomic, backup-excluded file and are never logged. Passwords are not saved in instance-state bundles or persisted by the app. Logout clears the vault and instruction cache while retaining owner-scoped pending results. An authenticated 401 triggers one refresh; invalid refresh credentials require sign-in. Offline startup can restore only an unexpired protected session; an expired token requires connectivity. WorkManager uses the same protected account and checks the owner before any upload. Hosted email and actual-device checks are recorded for later execution in `docs/validation/POST-IMPLEMENTATION-CHECKLIST.md`.

## Testing Sprint 2 in Android Studio

Sync/open `android/`, select the `app` debug configuration and a camera-enabled device, then Run. The app now uses Room 2.8.5 via KSP2 (`ksp.useKSP2=true` in `gradle.properties`); this also avoids a schema serializer conflict observed with the previous KSP1 execution path. From the role screen choose **Try the camera prototype**, read positioning instructions and open the camera. Choose elbow flexion (side-on) or shoulder abduction (front view), and select the anatomical left/right side. Keep the required joints and upright torso visible; mirror display does not change anatomical side. These are development demonstration rules, not a prescribed rehabilitation program.

Check the separate local-metrics consent checkbox, wait for stable tracking, then **Start measurement**. No-person, multiple-person, low-confidence or out-of-frame views keep Start disabled and display `--` for the angle. The median filter adds about one accepted frame of delay. Begin near the low threshold, reach/hold the displayed high target, and return to the low threshold for a full repetition. Camera pause/backgrounding interrupts the cycle; Resume needs fresh calibration. **Finish and save** commits totals locally and opens the summary. Local history is reachable from that summary and an authenticated Profile. **Recover interrupted session** restores the last checkpoint, never a partially completed repetition. Up to 500ms of unsaved progress can be lost on abrupt process termination.

For laptop webcam setup, edit the stopped AVD's camera settings to `webcam0`, then cold boot; a real Android phone uses its own camera. An emulator virtual room usually contains no detectable person. Use a compatible ARM phone or the supplied emulator with ARM translation; the MediaPipe runtime in this project has ARM32/ARM64 JNI only. Development demonstrations work without Supabase; clinical prescriptions require an authenticated supported assignment. Do not publish a synthetic prescription as a clinical approval.

```powershell
cd android
.\gradlew.bat :app:assembleDebug :app:lintDebug :app:testDebugUnitTest :core:assessment:test :app:connectedDebugAndroidTest
```

The connected task requires a running device and executes Room tests in UUID-named test databases. The mathematical sweep writes `core/assessment/build/reports/synthetic-assessment.json`. These results test code and persistence; physical camera/goniometer accuracy and long-duration phone performance are deferred follow-up checks in `docs/validation/POST-IMPLEMENTATION-CHECKLIST.md`, not implementation blockers.

## Testing Sprint 4 history

Open Progress as a patient, or choose one linked patient in therapist Progress/Patients. Filter by exercise definition version, side and optional UTC dates (`YYYY-MM-DD`, inclusive). The dashboard loads 50 sessions at a time; use Load older sessions for more history. Each immutable prescription/provenance has separate ROM/repetition charts with original targets. Limited/invalid/interrupted records remain in detailed history and leave chart gaps. An offline pending result stays in Local history until it uploads. Failed server reads clear earlier displayed history; use Refresh history / retry after checking network/access.

Run the normal Android checks with `:core:domain:test` as well as `:core:assessment:test`. `:app:connectedDebugAndroidTest` now includes three synthetic Compose history tests alongside the twelve existing persistence/sync checks. Compose UI test libraries use the existing BOM and are test/debug dependencies only. `python scripts/test_connected_workflow.py` additionally exercises the actual history embedding, pagination, filters and access boundaries, recording `docs/validation/sprint-04-history-backend-results.json`. See [MOT-19 evidence](../validation/SPRINT-04-HISTORY.md) and keep physical/therapist follow-up separate from engineering test results.

## Model provenance and camera checks

The bundled model is Google's `pose_landmarker_lite/float16/1` from `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`. Its checksum is recorded in `docs/validation/pose-model.json`. Review upstream model terms before distribution; runtime/sample documentation is at https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/android.

Inference is sequential on an analyzer executor using timestamped video mode with KEEP_ONLY_LATEST backpressure. This is live camera processing, not a stored-video upload. The screen reports rolling FPS and p95 inference latency over up to 300 samples, plus Android thermal status (-1 unsupported; 0 none through 6 shutdown). Displayed latency is inference time, not an end-to-end camera latency claim. Verify front/back cameras, 0/90/180/270 rotation, large text, permission denial, background/foreground, no-person and long-duration operation on both target phones. Unit-tested geometry is not a substitute for these device checks.

## Testing Sprint 3

Use `docs/operations/ENVIRONMENT.md` for the exact three client configuration values. Run `python scripts/seed_local_accounts.py --with-prescription` to keep the two local logins and add one supported development assignment if the demo patient has none. Passwords remain in ignored `docs/operations/local-test-accounts.json`.

Therapist: open Patients, create/share an invitation, select a linked patient, publish a supported prescription and edit it as a new immutable version. Patient: sign in with the invited email, accept the code in Exercises, refresh, read the cached instructions and start the assigned session. The original registration/confirmation flow remains the patient's own action. No invitation email is sent automatically.

Grant the separate movement-summary consent before recording. Complete a session offline; reconnect and use Profile -> Sync now. History distinguishes pending, uploaded, auth-required, permanently rejected and legacy-review-required results. Demo-only sessions never upload. A transient item has at most eight automatic attempts with exponential backoff; explicit Sync retries exhausted/auth-waiting items. Server rejection requires correcting access/configuration or recording a new valid session, not overwriting the old payload.

Profile also records consent withdrawal and export/deletion requests; request status is visible and fulfillment requires a trusted operator. See `docs/operations/DATA-LIFECYCLE.md`. Therapist and physical reference checks are documented for after implementation.

```powershell
python scripts/test_connected_workflow.py
npx --yes supabase@2.20.12 test db
```

The first command uses four disposable local users and cleans only those fixtures; the existing demo accounts/program are preserved. Android instrumented tests add file-backed migration, lost-acknowledgement/offline sync, owner isolation and Keystore checks. All generated reports belong in `docs/validation/`.

For the optional native `CameraLifecycleTest`, use a camera source that actually supplies frames. On the headless test host the saved webcam0 setting supplied none; cold-booting the AVD with `-camera-back emulated -camera-front emulated -no-snapshot-load` passes the native smoke test without changing its saved camera preferences. Synthetic emulator imagery does not test patient tracking accuracy.
