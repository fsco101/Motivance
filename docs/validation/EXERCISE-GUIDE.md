# Exercise guide character

Date: 2026-11-05. Android now has a model person who demonstrates each exercise. The tests ran on an emulator. No therapist has reviewed the movements, and the guide is not clinical advice.

## How it works

The character is a rig drawn in code, not a set of drawn animations. Therapists create their own exercises, so fixed animations could not cover them. The rig needs no new library and adds no asset files.

- `core/domain/.../ExerciseGuide.kt` turns a joint angle into body positions, using the camera's angle conventions.
- `feature/exercise/ExerciseGuide.kt` draws the character and runs the animation.

Each repetition moves through the range the patient was prescribed, held within what a body can do. An arc shows that range around the working joint.

| Joint | How it is shown |
| --- | --- |
| Shoulder | Facing the camera, raising the arm out to the side |
| Elbow | Side on, bending the elbow |
| Wrist | Side on and close up, with the forearm held out |
| Hip | Side on, lifting the thigh |
| Knee | Seated, straightening the leg. Standing if the exercise's name says so |
| Ankle | Seated and close up, lifting the toes |

A therapist's exercise is shown by the joint it measures. The word "standing" or "seated" in its name, or the Filipino "tayo" or "upo", chooses the posture for the hip and knee.

The working side faces the camera, as the camera needs. A patient's left arm is on the right of the picture when they face it.

## Where it appears

| Screen | What changed |
| --- | --- |
| Prepare camera | The model person replaces the stick figure and shows the exercise to come |
| Patient exercises | An animated guide on each assigned exercise, in place of the range arc |
| Today's exercise | A small animated guide on the home card, in place of the target arc |
| Camera screen | A reminder guide before starting, hidden while measuring |
| Therapist assignment | A live preview that follows the chosen range and side |
| Exercise lists | A still of the character at the target position |

The skeleton drawn over the live camera picture stays. It shows what the camera is tracking on the real patient, so it is a measurement and not a guide.

## Accessibility

- Tapping the guide pauses it, because moving content must be possible to stop.
- With Android's animations turned off, it holds still at the target position.
- It has a spoken description naming the exercise and its range.

## Evidence

| Check | Result |
| --- | --- |
| Rig tests: each joint forms the angle the camera measures, limbs keep their length, feet stay on the floor, the working side is correct | `ExerciseGuideTest` in `core/domain` |
| On the emulator: every exercise renders, the character moves, comes back, stops when paused, and holds still with animations off | `ExerciseGuideTest` in `app/src/androidTest` |

The skill catalogue had nothing for character animation, so no skill was installed. The closest match covered general Android layout only.

## Known limits

- Only the joint and range are known for a therapist's exercise, so its guide shows that joint moving, not any extra detail in their instructions.
- The web app does not show the character yet.
