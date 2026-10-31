# Sprint 1 exercise and validation protocol

Status: draft awaiting a licensed therapist and project-owner review. This file does not authorize unsupervised patient exercise. No participant results or device measurements have been collected.

## Candidate scope

| Candidate | View and landmarks | Initial measurable quantity | Exclusions pending review |
|---|---|---|---|
| Seated elbow flexion/extension | Side-on view of shoulder, elbow and wrist on the prescribed side | Included 2D elbow angle; therapist defines the conversion to anatomical flexion and ROM | Occlusion, out-of-plane motion, support hiding joints, compensation rules not observable from this view |
| Shoulder abduction | Front view of hip, shoulder and elbow | Included 2D angle between torso and upper arm; therapist defines reference zero | Rotation, trunk compensation beyond a validated rule, seated/standing restrictions not agreed |

The shipped catalogue is inactive and unpublished. Sprint 1 only detects landmarks; it does not assess these movements, set clinical thresholds or count repetitions. The approved exercise set may be reduced after feasibility testing.

## Proposed evaluation for approval before data collection

- Reference: therapist-operated goniometer, with anatomical landmarks, positioning and neutral-angle convention documented for each exercise. Compare matched stationary holds before dynamic traces. Document observer disagreement separately from model error.
- Proposed pilot: 10 consenting eligible participants, 5 repetitions per approved exercise and side, 3 stationary reference positions per exercise, two repeated runs. A therapist must approve suitability, recruitment, rest intervals and exclusion/stop criteria before this proposal is finalized.
- Proposed engineering gates for therapist review: mean absolute angle error <=10 degrees, repeated-hold mean absolute difference <=5 degrees, repetition count agreement >=95%, and valid tracking during >=90% of the approved camera sequence. These are provisional project gates, not established clinical accuracy claims.
- Proposed performance gates: median inference latency <=150ms and p95 <=250ms over an agreed 15-minute test; report actual frame rate, memory, battery change and thermal status. The therapist/project owner must accept or revise these gates before collecting evaluative data.
- Report errors per exercise, device, side and position; do not pool away failing subgroups. Retain invalid/missing tracking in the denominator and label it rather than replacing it with zero angle.
- Predeclare exclusions: consent withdrawn, reference alignment unavailable or unsupported movement geometry. Record exclusion counts/reasons. Do not exclude bad model results after observing the error.

## Device matrix to populate

Minimum proposed API: Android 8/API 26; initial target/compile SDK 35. Both a lower-spec and a mid-range physical phone are required. Record manufacturer/model, OS/API, RAM, camera, distance, view, lighting, lens, app/model version and 15-minute thermal behavior. Neither device is currently supplied/connected, so feasibility gates remain open. An emulator or unit test cannot replace physical tracking evidence.

## Consent and handling

Project owner and therapist must approve recruitment, participant information, withdrawal and stop procedures. Separate permission to access the camera from consent to collect rehabilitation records. The S1 camera prototype stores no images, video, pose traces or clinical sessions. Any later evaluation capture needs explicit consent, an approved retention period and de-identified storage. Reports use participant codes; the identity key remains under the client's approved access control. Withdrawal handling must identify records to remove and explain backup retention before recruitment.

## Required approval record

Therapist name/date, approved exercises/sides, positioning, reference zero, threshold changes, stop criteria, protocol version, actual device inventory, recruitment owner and data-handling owner are pending. Freeze these fields before evaluation. Track acceptance in MOT-01; do not mark it complete based on this draft alone.
