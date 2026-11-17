# Session videos shared with the therapist

Issue #129, 2026-11-18. Local-stack, browser and emulator evidence only. No real recording has been shared from a physical phone, and nothing here is a clinical validation. Deferred checks are in [POST-IMPLEMENTATION-CHECKLIST.md](POST-IMPLEMENTATION-CHECKLIST.md).

## What the owner decided (2026-11-17)

1. A video becomes visible to the therapist only with the patient's permission.
2. The server keeps it for 15 days. The phone's copy is not affected.
3. Videos are also shown on the web, in the patient's history and the therapist's progress.

Built as the proposal in #129: the patient chooses for each video, from that session's result or their history. It is off until they do. Whether to add a standing "share every video" setting instead is still the owner's to decide.

## What was added

- **Server.** Migration `202611170007_session_videos.sql`: the private bucket `session-videos` and `session_videos`, with the two-step share, stop sharing, 15-day expiry and cleanup functions. Only the patient and the therapist whose exercise it was can read a video. See [DATABASE.md](../architecture/DATABASE.md#session-videos-shared-with-the-therapist) and [DATA-LIFECYCLE.md](../operations/DATA-LIFECYCLE.md).
- **Cleanup.** `scripts/cleanup_chat_media.py` now removes due files from both buckets through the Storage API and marks them, still a dry run unless `--apply`.
- **Android.** On a session's result, and in the patient's history, "Let my therapist see it" explains what happens and asks before anything is sent. The phone then makes a smaller copy (480p, about 500 kbps, the first five minutes) with the chat video encoder, uploads it and its still, and shares it, showing how far it has got. Once shared, it says until when and offers "Stop sharing". History plays the phone's copy when there is one, otherwise the shared copy. The therapist's progress shows "Watch video" on that session and plays it in the app from a five-minute link.
- **Web.** Progress shows "Watch video" on sessions with a shared video, for the therapist and in the patient's own history. A patient can stop sharing from the player.
- **Privacy text.** The recording agreement, the movement-summary consent, the sign-up privacy point and the landing page no longer say the video is never uploaded. They now say it reaches the therapist only if the patient shares it, and that the shared copy is deleted after 15 days, in English and Filipino.

## Acceptance criteria

| Criterion | Evidence |
| --- | --- |
| Without the patient's permission, nothing is uploaded and the therapist sees none | `session-videos.test.ts` "shows nothing to the therapist until the patient shares it"; uploading to a place the server never issued is refused; Android `VideoShareControlsTest` (nothing is sent until the explanation is confirmed) |
| With permission, it uploads and the linked therapist can play it from progress on the web and Android | `session-videos.test.ts` "shares a video for 15 days…"; `tests/e2e/session-videos.spec.ts`; Android `SessionVideoSharingTest`, `SessionVideoPrepareTest` |
| The patient sees their videos in history on the web and Android | `session-videos.spec.ts` "the patient sees it in their history…"; Android history rows (phone copy first, then the shared copy) |
| Another therapist, a Scheduler and an administrator cannot read it; unlinking removes access | `session-videos.test.ts` (another linked therapist, an unlinked therapist, an administrator and another patient get neither rows nor links; "ends the therapist's access when their link ends") |
| Withdrawing permission stops uploads and deletes the server copies | "stops sharing at once…" (hidden, no link, files queued); web "can stop sharing it"; Android `stoppingRemovesItFromWhatIsShown` |
| Server copies are deleted 15 days after upload; the phone's copy is untouched | "hides a video once its 15 days are over, and the cleanup removes it from Storage" (runs the script) |
| The reworded consent and privacy text is in English and Filipino | `strings.xml` in both languages, `landing.en.json` / `landing.fil.json`; `check_resources.py`, `locales.test.ts` |

## Executed checks

| Check | Command | Result |
| --- | --- | --- |
| Session video contract | `npx vitest run --project contract --no-file-parallelism tests/contract/session-videos.test.ts tests/contract/chat-media.test.ts` | 18 passed (8 new, chat media unchanged) |
| Web browser | `npx playwright test tests/e2e/session-videos.spec.ts --workers=1` | 3 passed, with axe on the player |
| Web unit, types, lint | `npm test`, `npm run typecheck`, `npm run lint` | 316 passed; clean |
| Android unit | `.\gradlew.bat :core:domain:test :app:testDebugUnitTest` | 123 and 303 tests, 0 failures (includes `SessionVideoSharingTest` 7) |
| Android lint and resources | `.\gradlew.bat :app:lintDebug`, `python scripts/check_resources.py` | 0 errors, 147 warnings as before; 1357 strings per language |
| Android device (emulator, Pixel 6, API 35) | `VideoShareControlsTest`, `SessionVideoPrepareTest` | 3 and 1 passed. A real recording is made smaller within the server's limits, with a still |
| Android feature regression (emulator) | `connectedDebugAndroidTest` for `com.motivance.feature` | 115 of 117. `CameraLifecycleTest` fails as before on a headless emulator. `AdministrationScreenTest.overviewSurfacesAttentionItemsAndOpensTheirSection` fails because it cannot find "Link therapist and patient" after the tap. No admin code changed in this work (`git diff 8c3c597 -- feature/admin` is empty), so it is an earlier failure, left open |

**Rollout.** Apply `202611170007_session_videos.sql` to the hosted project with the schedule migrations, redeploy the web app, ship the Android build, and schedule `python scripts/cleanup_chat_media.py --target hosted --apply` daily.
