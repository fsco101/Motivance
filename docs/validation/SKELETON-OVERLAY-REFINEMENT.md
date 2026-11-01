# Skeleton overlay design refinement

Reviewed by Codex on 2026-11-01. This is a presentation update to MOT-10, using the supplied Kinetic Clinical Precision camera reference. Imported prototype assets are unchanged. No accuracy, clinical approval or improved inference-FPS claim is made.

`feature/exercise/SkeletonPreview.kt` replaces the green-line/yellow-dot Canvas embedded in CameraPrototype. The navy panel has an anatomical side/joint heading, a taller portrait viewport, subtle corner brackets, rounded bones with dark contrast outlines, muted body landmarks, and a mint selected-limb chain. A double ring identifies the elbow or shoulder used by the exercise. Visible torso joints receive a restrained fill. The renderer uses only finite in-frame landmarks meeting the prescription confidence threshold, with no interpolated/made-up joints, pose smoothing or additional model. Torso-lean feedback uses amber on the focus chain and explicit status text; a highlight indicates selected joints, not correctness.

The original FIT_CENTER PreviewMapping and front-camera mirror transform are shared by bitmap and landmarks. Multiple-person, no-person and paused states suppress the skeleton; unreliable tracking does not display an angle. The footer separates actual joint-angle/repetition values and provides a text legend and politely announced tracking status. The camera permission/consent, session controls, prescriptions, angle/repetition engine, persistence and bundled MediaPipe Lite model are unchanged. Technical inference/FPS diagnostics remain in debug builds; the slow-processing advisory remains available in release builds.

New panel text has English/Filipino resources and a labeled camera viewport. Large text wraps and the existing screen scrolls instead of fixing a clipped-height card. The design does not add a dependency, bitmap model, API call or frame history. Physical overlay alignment, readability, TalkBack and long-session performance remain in POST-IMPLEMENTATION-CHECKLIST.md.

## Executed checks

- `:app:assembleDebug`, `:app:assembleDebugAndroidTest` and `:app:lintDebug` passed. Existing lint warnings remain; no lint-error claim is hidden.
- `python scripts/check_resources.py`: 326 strings per language, format parity and five existing critical theme contrast pairs passed. This is not an exhaustive dynamic-camera contrast/translation review.
- `python scripts/check_apk_native_libraries.py`: ARM32/ARM64 MediaPipe JNI packaging passed.
- On the API35 emulator with software camera input, manual instrumentation ran SkeletonPreviewTest and CameraLifecycleTest: **3 tests passed**. Coverage includes focus/metrics, hiding an angle on ambiguous tracking, a mirrored shoulder panel at 200% Filipino font scale, live inference, background/resume/rebind and no recording without explicit Start/consent. This was a scoped UI/runtime check, not a rerun of every prior sprint test.
- `git diff --check` passed.

## Visual evidence

Codex inspected all three images. Renderer images use synthetic landmarks and a gradient fixture bitmap, not real patient/model output. The large-font image is a scrolled viewport; content below remains accessible through scrolling.

- [Selected elbow and readable metrics](ui/skeleton-focused-elbow.png)
- [Ambiguous tracking hides skeleton/angle](ui/skeleton-ambiguous-tracking.png)
- [Mirrored shoulder with large Filipino text](ui/skeleton-shoulder-large-fil.png)

The changes are locally built and tested. A remote CI run or physical/clinical verification of this refinement is not claimed.
