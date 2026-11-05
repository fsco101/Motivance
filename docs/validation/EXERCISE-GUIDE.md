# Exercise guide character

Date: 2026-11-05, redrawn 2026-11-06. Android now has a model person who demonstrates each exercise. The tests ran on an emulator. No therapist has reviewed the movements, and the guide is not clinical advice.

## How it works

The character is a rig drawn in code, not a set of drawn animations. Therapists create their own exercises, so fixed animations could not cover them. The rig needs no new library and adds no asset files.

- `core/domain/.../ExerciseGuide.kt` turns a joint angle into body positions, using the camera's angle conventions.
- `feature/exercise/ExerciseGuide.kt` draws the character and runs the animation.
- `feature/exercise/GuideOutline.kt` holds the body's outlines.

Each repetition moves through the range the patient was prescribed, held within what a body can do. An arc shows that range around the working joint.

| Joint | How it is shown |
| --- | --- |
| Shoulder | Facing the camera, raising the arm out to the side |
| Elbow | Side on, bending the elbow |
| Wrist | Side on and close up, with the forearm held out |
| Hip | Side on, lifting the thigh. Seated if the exercise's name says so, lifting it from the chair |
| Knee | Seated, straightening the leg. Standing if the exercise's name says so |
| Ankle | Seated and close up, lifting the toes |

A therapist's exercise is shown by the joint it measures. The word "standing" or "seated" in its name, or the Filipino "tayo" or "upo", chooses the posture for the hip and knee.

The working side faces the camera, as the camera needs. A patient's left arm is on the right of the picture when they face it.

A seated hip is limited to 90 to 120 degrees. The camera measures the hip between the shoulder, hip and knee, so someone sitting upright already reads 90 degrees and the thigh can only go up from there. The thigh rests on the chair at 90 degrees, and the shin stays upright so the foot starts flat. A prescribed range that reaches below 90 degrees starts at the chair instead. A range wholly below 90 degrees shows the usual lift, 90 to 115 degrees.

## The drawing

The character is the same person as the web sign-in figure. The first version was built from rounded capsules, which the owner found too much like a toy, so the body is now drawn from curved outlines with the same curve maths as `web/src/auth/FormFigure.tsx`.

- The front view reuses the web outlines. The web figure's single leg is split at the knee so the rig can bend it.
- The side view is new, because the web figure only faces forward. It adds a profile head, torso, pelvis, thigh, shank, hand and shoe at the same proportions.
- Each part is laid along its bone, so it turns and stretches with the rig. The rig and its tests did not change, so the character still forms the angles the camera measures.
- On a dark stage the colours match the web figure. On a light stage the skin and shirt are deeper and the shorts are dark, so the body stands out against the pale background.
- The rig turns a foot around the ankle, which would push the heel through the floor, so the shoe is lifted back to the floor. Only the drawing moves, by about one unit at the top of the ankle movement.

| View | Evidence |
| --- | --- |
| Every movement at its start | [every-movement-start.png](exercise-guide/every-movement-start.png) |
| Every movement at its target | [every-movement-target.png](exercise-guide/every-movement-target.png) |
| Dark and light stages, large | [dark-and-light-stage.png](exercise-guide/dark-and-light-stage.png) |
| Prepare camera scene | [prepare-camera.png](exercise-guide/prepare-camera.png) |
| List stills | [list-stills.png](exercise-guide/list-stills.png) |

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
| On the emulator: every exercise renders, a body is drawn at both ends of each movement, the character moves, comes back, stops when paused, and holds still with animations off | `ExerciseGuideTest` in `app/src/androidTest`, 7 of 7 passed on the Pixel 6 emulator, Android 15, 2026-11-06 |

The skill catalogue had nothing for character animation, so no skill was installed. The closest match covered general Android layout only.

## Known limits

- Only the joint and range are known for a therapist's exercise, so its guide shows that joint moving, not any extra detail in their instructions.
- The web app shows this person on sign-in, but does not demonstrate exercises yet.
- A seated hip exercise prescribed wholly below 90 degrees cannot be reached by a seated patient, because the camera reads at least 90 degrees while they sit upright. The guide shows the usual seated lift, but the session still uses the prescribed range. Nothing warns the therapist when they assign it.
