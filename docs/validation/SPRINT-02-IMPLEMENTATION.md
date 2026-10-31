# Sprint 2 implementation and acceptance evidence

Current delivery update: the user's subsequent instruction defers therapist/physical checks to `POST-IMPLEMENTATION-CHECKLIST.md` rather than blocking implementation. S3 now supplies the connected catalogue/prescription/consent/upload flow, protected sign-in and Room v2; see `SPRINT-03-IMPLEMENTATION.md`. The remaining text preserves the original S2 evidence and historical boundary, not current implementation blockers.

Date: 2026-10-31. Engineering implementation is available for development testing in the local working tree. The debug APK is installed on the emulator; local verification is not a GitHub CI run or a source push. Sprint acceptance remains open: S1 therapist approval, actual phone inventory and reference protocol approvals have not been supplied. No patient accuracy or production readiness is claimed.

## Implemented paths

| Issue | Implementation |
|---|---|
| MOT-07 | `MovementAssessment.process`: selected-side joint gates, finite/confident/in-frame geometry, upright torso, stable-frame calibration, explicit no/multiple-person and loss states |
| MOT-08 | `JointAngles.included` and filtered session extrema in `core/assessment`; left/right elbow flexion and shoulder abduction |
| MOT-09 | Neutral -> rest -> moving -> held target -> return state machine; hysteresis, minimum/maximum cycle time, incomplete reasons and pause/loss reset |
| MOT-10 | Stitch-based `CameraPrototype`, `ExerciseSessionViewModel`, translated feedback, consent, start/pause/resume/finish-save and local history |
| MOT-11 | `SessionDatabase`, `SessionStore`, `ExerciseJson`, `PrescriptionCache`; downloaded prescription cache, transactional completion/outbox, owner filtering and interrupted recovery |
| MOT-12 | `SyntheticEvaluationTest` mathematical sweep, existing diagnostic FPS/p95 reporting and this evidence/remaining physical-validation record |

Source paths are rooted at `android/app/src/main/java/com/motivance/` except pure logic in `android/core/domain/` and `android/core/assessment/`. Frontend screens are in `feature/` and `navigation/`; client repositories/Room are in `data/`. The shared backend remains `supabase/`. Environment configuration stays in ignored `android/.env`.

## Geometry and quality contract

All S2 angles are image-plane **2D estimates**, in degrees. Multiply normalized x/y by the upright inference bitmap's width/height before vector calculations; this prevents aspect-ratio distortion. Elbow flexion is `180 - included(shoulder, elbow, wrist)`, with a straight arm at zero. Shoulder abduction is `included(hip, shoulder, elbow)`, with upper arm parallel to the downward torso at zero. The same definitions apply to anatomical left and right. Front-camera mirroring affects drawing only. No model-estimated depth is treated as a reference measurement.

Elbow setup needs visible shoulder/elbow/wrist/hip, side-on view and an upright torso. Shoulder setup needs hip/shoulder/elbow in a front view. Confidence is the minimum of model presence and visibility. Default development rules require confidence >=0.7, joints inside a 2% border, vectors >=5 pixels, hip below shoulder, torso lean <=20 degrees and five consecutive acceptable frames. This is positioning verification, not optical calibration, proof of the patient's identity, verification of side-view alignment, or detection of every unsafe movement. Out-of-plane motion, occlusion and perspective remain limitations.

A causal median of the latest three valid angles suppresses isolated spikes, adding approximately one accepted frame of delay (frame rate varies). Raw jumps above 600 degrees/second invalidate a frame before filtering. Invalid frames clear filter/calibration/partial cycles, leave ROM extrema and counts unchanged, and require fresh stable tracking. Gaps over one second also reset partial cycles. Only running, ready frames update extrema; ROM is maximum minus minimum. Unknown angle/ROM is nullable and displayed as `--`, never fabricated as zero. Active duration includes time spent reacquiring tracking while running, excludes explicit pause, and uses a monotonic clock; persisted start/end use UTC epoch milliseconds.

Default **debug demonstration** targets are low 20 degrees, high 90 degrees, five repetitions, 600ms minimum cycle, 30s maximum cycle and 100ms target hold. They are engineering fixtures, not therapy advice. A repetition starts only after neutral, leaves low by >5 degrees, holds high, then returns low. Incomplete range, too-fast and timed-out cycles have deterministic feedback and persisted reason totals. Target repetitions are a displayed goal; they do not claim safety or automatically prescribe stopping. Pause/loss/recovery discard a partial cycle without counting it.

Supported downloaded prescriptions must carry algorithm `elbow-flexion-v1` or `shoulder-abduction-v1`, matching `measurement_convention` (`2d_flexion_degrees` or `2d_abduction_degrees`), a left/right side, valid pinned degree/repetition targets and English instructions (`instructions_en` or `instructions.en`). Optional `max_trunk_lean_degrees` defines that observable form gate; missing clinical lean defaults to 90 degrees (disabled). Other timing/confidence parameters remain explicitly pinned engineering defaults in `ExerciseRules`, awaiting exercise-specific therapist review. Bilateral and unknown algorithms/conventions are skipped. The seeded catalogue remains unpublished; no synthetic approval was introduced.

## Persistence and recovery

Room 2.8.5 with KSP2 uses a new v1 database with exported schema. A fresh source build initially exposed an `AbstractMethodError` reading the existing schema under KSP1; explicit `ksp.useKSP2=true` isolates processor execution and preserves schema export. See [KSP2 execution model](https://github.com/google/ksp/blob/main/docs/ksp2.md) and [Room setup](https://developer.android.com/jetpack/androidx/releases/room). There is no destructive migration fallback.

Consent to aggregate storage is separate from camera permission. Session configuration freezes at start; UUIDs remain stable across checkpoints/retries. Checkpoint interval is 500ms plus explicit pause/background/exit handling. A kill can lose progress since the last successful checkpoint. Reopening a file-backed database marks drafts interrupted; explicit restore retains totals/extrema/reasons and requires calibration/neutral again. Finish waits for one session/outbox transaction; save errors remain retryable on screen. A repeated finish cannot duplicate the outbox entry. No raw camera image/video/landmark sequence is stored by the app.

Owner-filtered history and cache are separate for each signed-in account and local demonstration mode. Sign-out clears cached instructions and interrupts drafts, retaining that owner's aggregate results and pending outbox. Cached supported prescriptions expire after 24 hours; start/resume checks freshness. Failed network refresh preserves a previous cache. Auth tokens remain memory-only: a running authenticated process can use cached instructions offline, but a cold restart needs online sign-in to unlock clinical account data. This limitation is not a completed persistent-auth feature.

Demo outbox entries are `LOCAL_ONLY` and debug-only measurement cannot start in release. Prescribed entries are `PENDING`. S3 owns authenticated idempotent server ingestion, worker retry/acknowledgement and connected history. Room is app-private, backup excluded, and unencrypted; approved retention/purge and encryption policy remain pilot prerequisites. See `docs/architecture/DATABASE.md`.

## Verification

Machine-readable evidence: `sprint-02-test-results.json`, `sprint-02-synthetic-results.json`, `local-auth-results.json` and `clean-android-build.json` in this folder. Unit sources are `MovementAssessmentTest`, `SyntheticEvaluationTest` and `PrescriptionCacheTest`; six file-backed Android tests are in `SessionStoreTest`.

The mathematical evaluation sweeps 18 known angles (0..170 degrees), two exercises, both sides and three bitmap shapes: **216 cases**, with a 0.001-degree numerical tolerance. It also replays **120 full repetitions**. This tests coordinate/state-machine correctness without MediaPipe or human reference measurements. Repeatability is deterministic replay, not human test/retest accuracy. The invalid-input tests cover missing/low-confidence/nonfinite/out-of-bounds/degenerate joints, multiple bodies, inverted torso, lean, excessive speed, stale frames, incomplete/fast/timed-out cycles, jitter, pause, reacquisition and restored totals.

Room tests prove completion/outbox atomicity (including injected SQL failure rollback), stable-UUID duplicate completion, owner isolation/collision rejection, file close/reopen interrupted recovery, persistent cached instructions/sign-out behavior and immutable draft rules. Local Auth/PostgREST tests include the actual nested prescription-download query against the RLS-protected local backend; current assignments are empty. Nonempty supported prescription decoding/cache behavior uses synthetic fixtures, not approved clinical assignments.

Emulator smoke checks used Pixel_6/API 35 with ARM translation and the configured laptop webcam viewing an empty room. No-person UI displayed `--`, zero reps and disabled Start; camera pause displayed a readable paused state; background/return resumed detection without fabricating data. A short diagnostic spot check observed roughly 3.6-3.8 FPS, p95 inference 634ms, thermal status 0, while Android builds also occupied the host. This is slower than the proposed 250ms p95 phone gate and is retained as a performance concern in MOT-12/#13. It is not a controlled 15-minute test, end-to-end latency result, or physical-device gate. No private camera screenshot is included in public evidence.

## Remaining acceptance work

- MOT-01/S1: licensed therapist review of exercise suitability, exact views/zero/thresholds, consent/stop protocol, actual owners and two target phones.
- MOT-08: first matched goniometer/approved reference comparison on actual subjects; mathematical accuracy does not satisfy this criterion.
- MOT-09/MOT-10: approved prescribed exercise demonstration with a patient/therapist, including visual skeleton/measurement alignment during motion and lifecycle/accessibility/device checks.
- MOT-12: approved reference angle error, human repeatability, repetition agreement and valid/invalid tracking denominators by exercise/side/device; controlled lighting/view and 15-minute latency/thermal/stability evaluation. Correct or remove unreliable exercises with therapist approval before a pilot.
- Physical results, reviewer names, participant counts and approvals remain absent. Issues/milestones must remain open until those requirements and their dependencies are accepted.
