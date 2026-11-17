# Celebrating a finished exercise

Issue #130, 2026-11-17. Emulator and unit evidence only. Nobody has listened to the tune or the voice on a real phone yet, and nothing here is a clinical validation. Deferred checks are in [POST-IMPLEMENTATION-CHECKLIST.md](POST-IMPLEMENTATION-CHECKLIST.md).

## What changed (Android)

Before, the camera screen closed as soon as a session was saved and went straight to the result page, with no sound. Now:

- **A moment to celebrate.** Once the session is saved, the camera screen shows "Finished!" with the repetitions against the target and the best range, for about 3.5 seconds. It then moves to the results on its own, and a tap goes straight on. The session is saved before this starts, so closing the app during it loses nothing.
- **Kind when short.** Below the target, the title is "Good effort!" and the voice says "Good effort today: 8 of 10." It never scolds.
- **The day's last exercise.** When nothing else is due today (#127), the screen and the voice add "That was today's last exercise."
- **Sound.** A short rising tune, then the line in the app's language (English or Filipino), at media volume like the spoken cues. With the finish sound on, the line replaces the older "Exercise complete." at the end of a timed set, so it is not said twice.
- **Switch.** "Finish sound" sits beside the voice switch on the session screen and is remembered on the phone. With it off, nothing plays.
- **Still when asked.** With the phone's animations turned off, the icon does not bounce.

## Where the sound comes from

The tune is made in code (`FinishChime` in `feature/exercise/FinishCelebration.kt`): C5, E5 and G5 for 110 ms each, then C6 for 340 ms, as sine waves with a soft attack and a bell-like decay. It is original to this app. There is no sound file, no third-party asset and no licence to record. Speech uses the phone's own text-to-speech, as the repetition cues do (#96).

## Executed checks

| Check | Command | Result |
| --- | --- | --- |
| Lines and tune | `.\gradlew.bat :app:testDebugUnitTest` (`FinishCelebrationTest`) | 5 of 5: target, short and last-of-day lines; under a second; peak between 15% and 50% of full scale; every note starts and ends near silence; notes rise |
| Celebration screen (emulator, Pixel 6, API 35) | `FinishCelebrationScreenTest` | 3 of 3: what was done, the kind title when short, last of the day, a tap goes on once, TalkBack's tap label |
| Exercise package regression (emulator) | `connectedDebugAndroidTest` for `com.motivance.feature.exercise` | 47 of 48. The failure is `CameraLifecycleTest`, which fails the same way without this change because a headless emulator has no camera frames (recorded in #114) |
| Android unit | `.\gradlew.bat :core:domain:test :app:testDebugUnitTest` | 123 and 296 tests, 0 failures |
| Android lint and resources | `.\gradlew.bat :app:lintDebug`, `python scripts/check_resources.py` | 0 errors, 147 warnings as before; 1336 strings per language with format parity |

**Not done:** hearing the tune and the voice on real phones at different volumes and in silent mode, and asking patients whether the moment feels encouraging rather than in the way. Both are in the checklist.
