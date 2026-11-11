# Both-sides exercise sets with a time per side

Date: 2026-11-11. Status: design approved in conversation, awaiting written-spec review.

## Goal

A therapist can prescribe one exercise for **both sides**: the patient does the left side, then the right side, in one sitting. The therapist can also set a **time per side**. While time remains, the patient keeps exercising even after reaching the target repetitions, because the extra repetitions are progress. When the time runs out, the phone announces the next side by voice and moves on.

## What the owner decided

| Question | Decision |
| --- | --- |
| What a "set" holds | Both sides of one exercise. Lists of different exercises are out of scope. |
| Time setting | One optional "time per side". Empty means today's behaviour, unchanged. |
| Reaching the target before the time is up | Keep measuring. Every extra repetition counts. |
| Moving to the next side | A voice announcement, then a 5-second countdown that starts the next side by itself. A Pause button holds the countdown until the patient presses Start. |
| How results are stored | Approach A: one prescription, one recorded session per side. |

## Assumptions the owner accepted

- When the time runs out before the target is reached, the set still moves on. The results show repetitions against the target.
- Pressing Finish during a set ends the whole set. The current side is saved and the remaining side does not start.
- After the app is killed mid-set, recovery resumes the interrupted side. If that was the left side, the set continues to the right side afterwards.
- The timer is the existing active measuring clock (`AssessmentSnapshot.durationMs`). It stops while the patient pauses. It keeps running through a brief tracking loss, as the clock does today.

## Behaviour

### Therapist (Android and web, same change)

- Side choice: **Left, Right, Both**. "Both" always runs left first, then right.
- In the Targets step, a switch **Set a time** reveals a stepper next to the repetitions stepper. It moves in 15-second steps from 0:15 to 30:00 and starts at 1:00. The label reads "Time" for one side and "Time per side" for Both. With the switch off, no time is stored.
- The review panel and the patient's plan line show the side and the time, for example "Both sides · 2:00 per side" or "Left · 1:30".
- Editing a prescription still publishes a new immutable version. Switching between one side and Both, or adding or removing the time, is an ordinary edit.

### Patient (Android only; the web app keeps sending patients to the phone)

The exercise list and the web patient pages show "Both sides" and the time.

A **side** is one measured run on one side. A **set** is the ordered sides of one prescription: `[LEFT, RIGHT]` for Both, or the single prescribed side.

1. The patient gives consent and presses Start, as today. The first side begins. With a time set, the session screen shows the time left (for example "1:42") next to the repetition count.
2. **Target reached with time left:** the voice says once per side "Target reached. Keep going until the time is up." Measuring continues.
3. **Side ends** when its time runs out. With no time set, the left side of a Both set ends when it reaches the target. The side is saved as a completed session and queued for upload, with no toast.
4. **Switching**, when another side follows:
   - The voice says "Left side done. Next: right side, *exercise name*."
   - After the announcement finishes (straight away if the voice is off or unavailable, and after at most 6 seconds if the speech engine never reports it finished), a 5-second countdown runs on screen and is spoken: "5, 4, 3, 2, 1, start".
   - The screen shows "Next: Right side", the countdown, and **Pause**. Pause stops the countdown and replaces it with **Start**.
   - At zero, measuring starts on the next side. If tracking is not ready, the screen asks the patient to step into view and starts as soon as tracking is ready, unless the patient paused.
   - Leaving the app during the countdown pauses it.
5. **Last side ends** when its time runs out. The session saves and the voice says "Exercise complete." The completion screen lists each side done in this run: repetitions against target, range of motion, active time.
6. **No time set on the last side:** nothing new happens. The patient presses Finish, as today. This covers the right side of an untimed Both set and every untimed single-side prescription.
7. **Finish** at any point saves the current side and ends the set.

Voice lines follow the existing voice switch on the session screen. When the switch is on but the phone has no usable voice, the announcement and the countdown play a tone instead, as repetition results already do. Set announcements are queued after a phrase already playing; they do not cut off the final repetition's result. Every line exists in English and Filipino.

## Data

No new tables. The database already allows `prescription_versions.side` and `session_measurements.side` to be `bilateral`.

### Prescription

- `publish_prescription` accepts `p_side = 'bilateral'`.
- New optional key `side_seconds` in `p_parameters`: an integer from 15 to 1800. It applies to each side. It is added to the allowed parameter keys, and its absence means no time.
- The function signature is unchanged, so neither app needs a new RPC shape.

### Recorded rules (phone payload)

`ExerciseRules` gains two fields, serialised by `ExerciseJson` and kept in the prescription cache:

- `bilateral: Boolean` (default `false`): this side belongs to a Both prescription.
- `sideSeconds: Int?` (default `null`): the time per side.

`side` stays `LEFT` or `RIGHT`: the side actually measured. Keys are omitted when they are not used, because `ingest_session` rejects `null` values. Payloads from older app versions therefore still validate.

### Session ingestion (`ingest_session`)

- For a `bilateral` prescription, recorded `side` must be `LEFT` or `RIGHT`, and recorded `bilateral` must be `true`. For a single-side prescription, the existing exact side match stays, and `bilateral` must be absent or `false`.
- Recorded `sideSeconds` must equal `side_seconds` (both absent, or equal).
- `session_measurements.side` stores the measured side (`left` or `right`), never `bilateral`. Each side's history and progress therefore stay separate.
- The duration is not checked against `side_seconds`. A paused and restored side can legitimately differ by a few frames, and the existing duration check still applies.

### History and progress

- The history side filter in both apps currently filters `prescription.side`. It changes to the measured side, `session_measurements.side`, so a Both prescription's left sessions appear under "Left". With no filter, both sides appear.
- Progress series already split by prescription, metric and measured side, so a Both prescription draws a left line and a right line without change. Labels read "Both sides" where they show the prescription's side.

## Components

| Unit | Where | Responsibility |
| --- | --- | --- |
| `SideSet` (new, pure Kotlin) | `android/core/domain` | Given the rules and the latest snapshot, decides the set's state and emits events: `TargetReached`, `SideEnded`, `SetComplete`. Holds the side order and which side is current. No Android, timer or speech dependencies, so it is unit-tested with plain snapshots. |
| `ExerciseSessionViewModel` | `feature/exercise` | Runs `SideSet`, saves each side as its own session, drives the countdown (one coroutine, pausable, cancelled by `interrupt`), reuses the consent grant for the next side, starts the next engine, and keeps per-side results for the completion screen. |
| `RepCuePlayer` / `RepCueScript` | `feature/exercise` | New set phrases: target reached, side done with next side, countdown numbers, start, exercise complete. Set phrases queue; repetition results keep flushing. |
| Session screen and completion screen | `navigation/MotivanceApp.kt`, `feature/exercise` | Time left, the switching card with countdown and Pause/Start, and per-side results. |
| Therapist editor | Android `ConnectedScreens.kt`, web `AssignmentEditorView.tsx` | Both choice, time switch and stepper, review line. |
| Plan and patient labels | Android `ConnectedScreens.kt`; web `PatientRecordView.tsx`, `PatientExercisesView.tsx`, `data/workspace.ts`, `data/therapist.ts` | Show "Both sides" and the time. |
| Prescription cache decode | `data/remote/PrescriptionCache.kt` | Reads `bilateral` as a LEFT-first set with `bilateral=true`, and reads `side_seconds`. |
| History filter | Android `HistoryJson.kt`, web `data/history.ts` | Filter on the measured side. |
| Migration | `supabase/migrations/202611110001_bilateral_sets.sql` | Replaces `publish_prescription` and `ingest_session` with the rules above. |

## Errors and edge cases

- A `side_seconds` outside 15–1800, or a non-integer, is rejected by the server and blocked by both editors.
- Consent withdrawn between sides: the next side does not start. It needs a fresh grant at Start, as any new session does.
- The assignment is revoked mid-set: sides already saved fail upload with the existing "Assignment access revoked" handling, as a single session does today.
- The app is killed during the countdown: the finished side is already saved and nothing else is in progress, so the set ends there. Starting the exercise again begins a new set from the left side. This is a known limitation of a 5-second window, chosen over storing extra "next side pending" state.
- Rotation or recomposition does not repeat voice lines. One event per announcement, with no replay, as repetition results already work.
- Older installed Android builds skip `bilateral` prescriptions, because their decoder accepts only `left` and `right`. Those patients must update the app before they can see a Both prescription. This is recorded in the rollout notes.

## Testing

Executed in this change:

- **Database** (`scripts/test_*.py` against the local stack, plus `supabase/tests`): publish Both with and without `side_seconds`; reject a bad `side_seconds` and unknown keys; ingest a left and a right session against one Both prescription and confirm each measurement stores its measured side; reject a recorded side of `BILATERAL`; reject a `sideSeconds` mismatch; reject `bilateral=true` on a single-side prescription; legacy single-side payloads still ingest.
- **Android unit**: `SideSet` transitions (timed and untimed, target reached once per side, time-up before the target, Finish early, restoring mid-set); `ExerciseJson` round trip with and without the new fields; `PrescriptionCache` decoding of `bilateral` and `side_seconds`; the cross-app fixture `web-published-prescriptions.json` gains a Both prescription published by the web app.
- **Android ViewModel**: a fake clock and snapshots drive left → countdown → right → complete; Pause holds the countdown; `interrupt` during the countdown pauses it; two sessions are saved with the same prescription and consent.
- **Web**: unit tests for the draft and time validation; e2e for a therapist publishing Both with a time and seeing it on the patient record and the patient's exercise page; the contract test for the history side filter.

Deferred to `docs/validation/POST-IMPLEMENTATION-CHECKLIST.md`, not claimed as passed:

- Physical-phone check of the voice timing, countdown, auto-start and repositioning between sides, in English and Filipino.
- Therapist review of the flow, the default time and whether right-side framing needs guidance.

## Rollout

- Apply the migration to the local stack (back up owner accounts first, per the local-database rule), then to hosted Supabase. Redeploy the web app. Build a new Android release. The hosted steps are outward-facing and need the owner's go-ahead at that point.
- Update `docs/architecture/DATABASE.md` (the side and parameter rules) and the `prescription_versions` row in `docs/PLAN.md`. Add a validation record under `docs/validation/`.
- Track the work as a GitHub issue and close it with evidence, following `docs/SPRINTS.md`.

## Out of scope

- Sets of different exercises, custom side order (right first), and a rest period other than the 5-second countdown.
- Skipping a side, or a "next side" button.
- Measuring both sides at the same time.
