# Emulator camera crash and Stitch UI correction

The crash was reproduced from the emulator's AndroidRuntime log: `UnsatisfiedLinkError` when loading `libmediapipe_tasks_vision_jni.so`. MediaPipe 0.10.21 supplies ARM64, ARM32 and x86 JNI libraries but no x86_64 JNI. Other packaged dependencies supplied x86_64 libraries, so Android selected an x86_64 process and could not load the pose runtime. Catching only `Exception` did not contain this `LinkageError`.

## Fix and regression guard

The app now packages ARM64/ARM32 consistently. This emulator advertises ARM64 support through `libndk_translation.so`; after reinstall it selects `primaryCpuAbi=arm64-v8a`. The same runtime is appropriate for supported ARM phones. An emulator without ARM translation cannot install this build; use a supported ARM device/image. Runtime linkage failures are caught on the analyzer, stop further analysis and display a localized explanation rather than killing the app.

`scripts/check_apk_native_libraries.py` checks that every ABI selectable from the APK has the vision JNI library. Android CI runs this check after assembling the APK. It guards against reintroducing the mixed-native-library packaging failure.

## Observed on emulator-5554

- APK installation succeeds; the app process remains alive on opening the camera.
- Native loader reports the ARM64 vision JNI library loaded successfully; TensorFlow Lite initializes and creates its CPU delegate.
- Live frames render at 480x640. A spot check reported approximately 8.4 FPS, 118ms inference latency and 142ms rolling p95 latency, thermal status 0.
- Pause and resume update their controls and keep the app alive.
- The source is the emulator's virtual room, with no person. This validates camera/inference execution, not body landmark accuracy, clinical ROM or physical-phone performance.

## UI correction

The previous app used the reference palette with generic auth forms. The replacement implements native role cards, clinical header/cards, dashboard/list/profile/progress navigation, camera setup/preview/completion and authorized overview reads. Screens depending on unfinished workflows use explicit empty/disabled states. Camera frames, test screenshots and diagnostics are not uploaded to any service. Temporary screenshot inspection caught system-bar overlap; safe drawing insets and light system-bar styling correct it in the final build.

See `docs/architecture/UI-UX.md` for screen mapping and remaining backend integrations. Two physical devices and therapist approval remain separate sprint gates.
