# Android development setup

Open `android/` in Android Studio. The pinned baseline is JDK 17, Gradle 8.11.1, AGP 8.9.1, Kotlin 2.1.20, KSP 2.1.20-1.0.32, Hilt 2.56.1, Compose BOM 2025.04.01, CameraX 1.4.2 and MediaPipe 0.10.21. Versions are in the Gradle catalogue. Install Android platform 35 and build tools 35.0.0; minimum device API is 26.

Start the local stack from the repository root, then create the ignored environment file:

```powershell
npx --yes supabase@2.20.12 start
python scripts/setup_local_env.py
```

`android/.env.example` documents the public client variables. `android/.env` is ignored and contains the local API endpoint, Android emulator endpoint (`10.0.2.2:54321`) and public anon/publishable key only. No service-role key or database password is stored there. The Gradle build reads process environment first, then `android/local.properties`, then `android/.env`; `ANDROID_SUPABASE_URL` maps the emulator endpoint to the app's Supabase URL. Do not print or commit environment contents. Use an HTTPS endpoint for a hosted environment.

Copy `android/local.properties.example` to ignored `local.properties` if an SDK path is needed; omit its sample Supabase values when using `android/.env`. Then run:

```powershell
cd android
.\gradlew.bat :app:assembleDebug :app:lintDebug :app:testDebugUnitTest :core:assessment:test
```

Linux/CI uses `bash ./gradlew` with the same tasks. The debug package is `com.motivance.debug`; the APK is `android/app/build/outputs/apk/debug/app-debug.apk`. A backend-free build can open the local skeleton feasibility screen. It cannot authenticate until configured. Do not put service-role credentials, passwords or signing keys into configuration or source control.

## Backend

Use Supabase CLI 2.20.12 and a running Docker engine on the development machine. Run `supabase start`, `supabase db reset` and `supabase test db` from the repository root (or prefix with `npx --yes supabase@2.20.12`). Reset is only for the disposable local stack and removes its current records. The seed is an unpublished synthetic exercise definition only. The migration's signup trigger creates a patient profile and ignores caller-supplied role metadata. Staff roles and therapist links require trusted SQL/administrative provisioning; there is no client self-promotion endpoint.

Run `python scripts/test_local_auth.py` to exercise registration, confirmation, role isolation, recovery, refresh and logout against real local Auth/PostgREST and captured email. It refuses hosted endpoints, uses synthetic accounts and cleans up their database records. All emails stay in the local mail viewer at `http://127.0.0.1:54324`. Analytics is disabled because it is unnecessary for these checks and its vector service did not work with the default Docker Desktop socket setup; Docker TCP exposure is not required.

Patient-visible tables use RLS, including measurements through the parent session. Prescription/exercise versions and historical results are immutable. Indexes cover authorization joins and patient/time queries. Retention periods await owner approval; historical records are not silently cascade-deleted. Account disable/revocation and controlled export/deletion need the later documented trusted operations.

## Authentication contract

The S1 repository uses Supabase's GoTrue REST API through a small OkHttp adapter. This replaces the proposed Kotlin SDK for this prototype to keep explicit control over memory-only tokens and a small dependency surface; it implements the domain `AuthRepository`, so the adapter can be replaced without changing screens. Email/password login, patient registration, confirmation-code verification, recovery request, recovery-code verification/new password, refresh and logout are implemented. Local confirmation/recovery templates show the single-use `{{ .Token }}` code; link callbacks are not implemented in S1. Hosted email templates must use the same code workflow.

Debug builds permit HTTP only to localhost, 127.0.0.1 or 10.0.2.2 on port 54321 in the auth adapter; their network security configuration allows those local hosts only. Release builds retain HTTPS-only transport and do not include the debug network configuration. An Android emulator uses the generated `android/.env` as-is. For a USB-connected phone, run `adb reverse tcp:54321 tcp:54321`, override the app URL to `http://127.0.0.1:54321`, and rebuild the debug variant. Do not send patient data through the local test environment.

Tokens live only in memory and are never logged. Closing the app requires a new login. Refresh is explicit in S1; automatic expiry handling and an encrypted session store require integration testing before persistent use. Passwords are not saved in instance-state bundles. S2 persists consented aggregate sessions locally, with account isolation; no upload worker is enabled yet. Authentication against a live configured project and real email delivery must be verified before MOT-04 closes.

## Testing Sprint 2 in Android Studio

Sync/open `android/`, select the `app` debug configuration and a camera-enabled device, then Run. The app now uses Room 2.8.5 via KSP2 (`ksp.useKSP2=true` in `gradle.properties`); this also avoids a schema serializer conflict observed with the previous KSP1 execution path. From the role screen choose **Try the camera prototype**, read positioning instructions and open the camera. Choose elbow flexion (side-on) or shoulder abduction (front view), and select the anatomical left/right side. Keep the required joints and upright torso visible; mirror display does not change anatomical side. These are development demonstration rules, not a prescribed rehabilitation program.

Check the separate local-metrics consent checkbox, wait for stable tracking, then **Start measurement**. No-person, multiple-person, low-confidence or out-of-frame views keep Start disabled and display `--` for the angle. The median filter adds about one accepted frame of delay. Begin near the low threshold, reach/hold the displayed high target, and return to the low threshold for a full repetition. Camera pause/backgrounding interrupts the cycle; Resume needs fresh calibration. **Finish and save** commits totals locally and opens the summary. Local history is reachable from that summary and an authenticated Profile. **Recover interrupted session** restores the last checkpoint, never a partially completed repetition. Up to 500ms of unsaved progress can be lost on abrupt process termination.

For laptop webcam setup, edit the stopped AVD's camera settings to `webcam0`, then cold boot; a real Android phone uses its own camera. An emulator virtual room usually contains no detectable person. Use a compatible ARM phone or the supplied emulator with ARM translation; the MediaPipe runtime in this project has ARM32/ARM64 JNI only. Development demonstrations work without Supabase; clinical prescriptions require an authenticated supported assignment. Do not publish a synthetic prescription as a clinical approval.

```powershell
cd android
.\gradlew.bat :app:assembleDebug :app:lintDebug :app:testDebugUnitTest :core:assessment:test :app:connectedDebugAndroidTest
```

The connected task requires a running device and executes Room tests in UUID-named test databases. The mathematical sweep writes `core/assessment/build/reports/synthetic-assessment.json`. These results test code and persistence; physical camera/goniometer accuracy and long-duration phone performance remain separate acceptance checks in `docs/validation/SPRINT-01-PROTOCOL.md`.

## Model provenance and camera checks

The bundled model is Google's `pose_landmarker_lite/float16/1` from `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`. Its checksum is recorded in `docs/validation/pose-model.json`. Review upstream model terms before distribution; runtime/sample documentation is at https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/android.

Inference is sequential on an analyzer executor using timestamped video mode with KEEP_ONLY_LATEST backpressure. This is live camera processing, not a stored-video upload. The screen reports rolling FPS and p95 inference latency over up to 300 samples, plus Android thermal status (-1 unsupported; 0 none through 6 shutdown). Displayed latency is inference time, not an end-to-end camera latency claim. Verify front/back cameras, 0/90/180/270 rotation, large text, permission denial, background/foreground, no-person and long-duration operation on both target phones. Unit-tested geometry is not a substitute for these device checks.
