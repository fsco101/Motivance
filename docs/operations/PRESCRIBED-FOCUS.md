# Therapist-selected skeleton focus

In Patients, open a patient and create or edit a prescription. Select the supported exercise and anatomical left/right side, then choose **Skeleton focus body part**. Available parts are shoulder, elbow, wrist, hip, knee and ankle. **Exercise joint (automatic)** retains the exercise's original elbow/shoulder focus. Publish a new prescription version; editing never changes a patient's session already in progress.

The patient refreshes Exercises, sees the assigned focus alongside downloaded instructions, and starts that assignment. The ring and highlighted chain follow the therapist's selected part on the prescribed anatomical side, including in mirrored front-camera views. Patients have no focus-editing control for assigned exercises. If that part is not visible with sufficient confidence, the ring is omitted and the UI asks the patient to reposition.

This is visual guidance, not a new measurement algorithm. Supported ROM/repetition algorithms remain elbow flexion and shoulder abduction. If, for example, an elbow exercise highlights the right knee as a visual cue, the screen explicitly labels the measurement as an elbow angle. New knee/hip/ankle/wrist exercise assessment needs a separately implemented and validated algorithm.

## Data and compatibility

Apply `supabase/migrations/202611010004_prescribed_focus.sql` after the earlier migrations and before distributing this app update. The server stores the optional uppercase `parameters.focus_joint` in the immutable prescription version and rejects unknown/non-string values. It checks the session's `rules.focusJoint` against that exact prescription during ingestion. A patient cannot change it through a new prescription or session upload.

The Android cache and Room session rules retain the selection and side offline. The Room schema stays at v2 because focus is inside existing JSON fields. Old downloaded rules/drafts without `focusJoint` default to the original algorithm joint. Draft continuation compares decoded immutable rules so the added optional field does not invalidate an otherwise unchanged legacy draft. Completed outbox payloads are never rewritten; older payloads without focus remain acceptable for older default-focus prescriptions. Omitting focus cannot bypass a prescription that explicitly selected a different body part.

A session pins its prescription and focus at start. A later therapist focus change creates a new version; finishing/retrying the old session continues to use its original target and payload. No camera frames or per-frame landmarks are persisted by this feature. No extra service, model, credential or Android dependency is required.

Therapist wording, physical overlay alignment and reference/device checks remain unexecuted in `docs/validation/POST-IMPLEMENTATION-CHECKLIST.md`. Development and synthetic verification do not establish clinical accuracy.
