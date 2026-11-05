# Therapist custom exercises

Date: 2026-11-05. Emulator and local-backend engineering evidence only. No physical-device, therapist or patient check was executed, and no custom measurement is clinically validated; those checks are listed in `POST-IMPLEMENTATION-CHECKLIST.md`.

## What was added

A therapist can add an exercise while assigning one: Patient, Assign exercise, Step 1, Add custom exercise. They give a name, the joint the camera measures (shoulder, elbow, wrist, hip, knee or ankle), instructions, and optional Filipino instructions. The new exercise is selected automatically, and targets, side and timing are set per assignment as usual.

Elbow and shoulder were already special cases of the same three-landmark joint chain, so all custom exercises share one algorithm, `joint-angle-v1`, and the existing repetition rules. Built-in exercises keep their exact landmarks, covered by `builtInExercisesKeepTheirOriginalLandmarks`.

## Access rules

These are enforced on the server by migration `202611050001_custom_exercises.sql`.

| Rule | Reason |
| --- | --- |
| Only the therapist who wrote an exercise can see it in their list or prescribe it. | Instructions are free text and could describe a patient. |
| A patient can read it once it is assigned, as can accounts with access to that patient's records. | They need it to run the exercise and read the history. |
| Removing it stops new assignments only. | Existing assignments, uploads and history keep working. |
| An upload must match the prescribed joint, kind and focus. | Results stay tied to what was prescribed. |
| Administrators can correct or deactivate custom exercises with the existing catalogue tools. | Clinical oversight. |

## Known limits

- **Direction of movement.** The engine counts from the low angle up to the high angle and applies the hold at the high end. For a movement that works toward straight, such as seated knee extension, repetitions still count, but the hold and the "reach" guidance fall at the bent end. A per-exercise direction setting would fix this; it does not exist yet.
- **Upright only.** The trunk checks need the shoulder above the hip, so lying-down exercises read as invalid. Raising the trunk-lean limit helps with leaning movements such as squats, not lying down.
- **One joint angle.** Movements with no single joint angle, such as balance, walking or breathing, cannot be measured.
- **Ankle starting angle.** The ankle reads about 90° with the foot flat, so the default 20°-90° targets do not suit it. The form states this and the therapist must change them.
- **No editing.** A therapist corrects a mistake by removing the exercise and adding it again. An administrator can publish a corrected version.
- **Accuracy.** Wrist and ankle use the index finger and foot landmarks, which have had no real-person check.

## Deployment order

Apply the migration before releasing this app version: its exercise list reads `exercises.owner_id`, so against the old schema the workspace load fails. Older app versions keep working on the new schema and do not show custom exercises to therapists. A patient on an older version sees "assignment unavailable" for a custom exercise.

## Evidence

| Check | Result |
| --- | --- |
| `scripts/test_custom_exercises.py`, real local Auth and PostgREST | 35 checks passed, covering access, ownership, retries, upload integrity and removal. |
| `LiveCustomExerciseTest`, app repository, cache and upload code against the local backend | Passed: therapist creates and prescribes, patient downloads, session uploads, therapist history shows the name, removal leaves the assignment in place. It uses a synthetic session, not camera frames. |
| `CustomJointMeasurementTest` | Passed: all six joints on both sides measure the angle and count a repetition with synthetic landmarks, and the overlay matches the engine. |
| Instrumented suite, Pixel 6 AVD | 79 tests OK. `CameraLifecycleTest` was excluded because it needs a signed-out app. |
| JVM suites | 261 results, 0 failures, 0 errors. |
| `test_connected_workflow.py`, `test_administration.py`, `test_assignment_delivery.py` | Passed against the new migration. |
| `verify_backend_migrations.py` | Fresh replay and 18 SQL tests passed. |
| English/Filipino resources | 752 strings per locale, format parity passed. |

Screens, with fixture data: [exercise list](custom-exercises/exercise-list.png), [new exercise form](custom-exercises/new-exercise-form.png).

The migration was applied to the local stack only. No hosted environment was changed.
