# Care chat (started 2026-11-15)

Engineering evidence for the care chat epic (#113), added to as each issue is built. Nothing here is clinical validation. Therapist and device checks are deferred in [POST-IMPLEMENTATION-CHECKLIST.md](POST-IMPLEMENTATION-CHECKLIST.md).

## #105 Conversations, messages and live delivery on the server

**Built.** Migration `supabase/migrations/202611150001_care_chat.sql` and the web data layer `web/src/data/chat.ts`. The tables, rules and functions are described in [DATABASE.md](../architecture/DATABASE.md#care-chat). No screen exists yet in either app.

**Owner decisions applied.** Still open in #113 when this was built, so the safer reading was taken and can be changed in one function:

- After a link ends, the patient keeps reading the conversation and the therapist does not, matching how a therapist loses a patient's records. The epic had proposed read-only for both.
- A sender can take a message back for 15 minutes; there is no editing.
- Either person can write first.

**Tests run on 2026-11-15, local backend**

| Check | Result |
|---|---|
| `tests/contract/chat.test.ts` | 10 passed, run twice |
| `npm run test:contract` (all 17 files) | 184 passed |
| `therapist.spec.ts`, `therapist-caseload.spec.ts`, `patient.spec.ts`, one worker | 48 passed |
| `scripts/test_connected_workflow.py` | Passed |
| `npm run typecheck`, `npm run lint` | Pass |

| Acceptance criterion | Evidence in `chat.test.ts` |
|---|---|
| Only the two people on an active link read or send; another therapist, a Scheduler and an administrator read nothing | "gives a linked pair one conversation…", "keeps outsiders out of the messages, by function and by table" |
| Ending the link stops sending and live delivery at once | "closes the conversation when the link ends…" The therapist fails the row rule that live delivery uses, and nobody can send |
| A message reaches the other person's open connection without a refresh | "delivers a message, a read mark and a deletion live, and only to the two people" |
| The same client ID twice stores one message | "sends once however often the same message is retried…" |
| Unread counts are correct after reading | Same test |
| Sending is rate-limited and over-long text refused | "limits how fast one person can send", "refuses empty, over-long and borrowed messages" |
| `DATABASE.md` and `PLAN.md` describe it | Both updated |

**Found while building.** Realtime reports a channel as joined before it is listening to the database, so a message sent in that gap is not delivered live. `subscribeToChat` therefore reports the connection as live only on Realtime's own "listening" notice, and both apps must fetch again after any drop.

**Hosted.** On the owner's instruction on 2026-11-15, `202611150001_care_chat.sql` was applied to the hosted project with `supabase db push` after a dry run that listed only this migration, and read back with `migration list --linked`. No chat test has been run against the hosted project, and live delivery there has not been observed.

**Not run / not done**

## #107 The conversation on the web

**Built.** `web/src/features/chat/` (`MessagesView.tsx`, `pages.tsx`, `thread.ts`), routes `/therapist/messages` and `/patient/messages`, a Messages entry in both sidebars, a Messages icon with an unread count beside the bell, and a Message button on the patient record. English and Filipino. Design gallery: `/design/therapist/messages`, `/design/patient/messages` (`?waiting`, `?live=off`, `?state=`).

**How it behaves**

- One live connection per workspace keeps every loaded conversation and the unread count current. The page says "Reconnecting" when the browser loses its network or the server stops sending rows, and reads everything again when either returns, when the tab comes back to the front, and once a minute as a safety net.
- A message shows at once as "Sending", then with its time. A failed send stays in the thread as "Not sent" with Try again and Discard. Trying again reuses the message's ID, so it cannot arrive twice.
- "Seen" sits under the reader's newest message once the other person has read that far.
- A sender can delete their own message for 15 minutes, after a two-step confirm. It leaves "Message deleted" for both.
- A closed conversation stays readable to the patient, without a composer.
- Under every conversation the patient reads that messages are not read around the clock and what to do if something is urgent. The wording is not yet reviewed by a therapist (#111).

**Not in this issue.** Photos and video (#106), shared progress and exercise cards and system notes (#109: the screen already draws a system line and says so when it meets a kind it cannot show), and new-message notifications (#110).

**Tests run on 2026-11-15, local backend**

| Check | Result |
|---|---|
| `tests/e2e/chat.spec.ts`, two signed-in browsers, one worker | 9 passed, run three times |
| `design.spec.ts`, `landing.spec.ts`, `chat.spec.ts` together | 98 passed, 83 skipped (the suite's own skips) |
| `therapist.spec.ts`, `therapist-caseload.spec.ts`, `patient.spec.ts`, `notifications`, `dashboard` | 59 passed |
| `npm test` (unit, 21 files) | 288 passed |
| `npm run test:contract` | 184 passed |
| `npm run typecheck`, `npm run lint` | Pass |

| Acceptance criterion | Evidence in `chat.spec.ts` unless named |
|---|---|
| A message appears for the other person without a refresh | "a message appears for the other person without a refresh, and is marked seen" |
| The unread count clears when read | "unread messages are counted beside the bell and in the list, and clear when read". Matching Android waits for #108 |
| A dropped connection is shown, and what was sent meanwhile arrives once | "what was said while the connection was down arrives when it returns, once" |
| A failed send stays marked as not sent, with a retry | "a send that fails stays in the thread as not sent, and goes once when tried again" |
| Keyboard, screen-reader announcements and axe | Enter sends in the live test; the thread is a polite live log; axe passes on the live pages at desktop and 360 px, and on five gallery states |
| Gallery routes and `WEB-DESIGN.md` | Added |

**Found while building**

- Playwright's offline mode does not close an open websocket, and a real socket can stay silent for most of a minute after the network goes. The page therefore also listens to the browser's own online and offline events.
- The failed-send bubble was first dimmed, which broke text contrast; it is now outlined instead.

**Limits to know**

- A message still "Sending" or "Not sent" is held in the page only. Leaving the Messages page drops it.
- The dropped-connection test proves catch-up and no duplicates. It cannot prove the socket itself was down, for the reason above.

## #108 The conversation on Android

**Built.**

- `core/domain/.../Chat.kt`: the models, `ChatRepository`, and the rules both apps share (thread order, day lines in the reader's calendar, "Seen", the 15-minute delete window, send order). `ChatTest.kt` uses the same cases as the web's `thread.test.ts`.
- `data/remote/ChatJson.kt` reads the server functions and live rows. The chat calls are in `SupabaseAuthRepository`, which now also passes `chat_*` refusals through by name.
- `data/remote/LiveChat.kt` is the Realtime client on OkHttp's websocket. It joins with a token checked just before, so an expired one is renewed first; it reports the connection live only once Realtime says it is listening; it sends a heartbeat every 25 seconds, and OkHttp pings every 20; after any drop it waits 1, 2, 4, 8, 16, then 30 seconds and tries again.
- `data/local`: a `chat_outbox` table in Room (database version 3, migration `FROM_2_TO_3`), cleared for that account at sign-out.
- `feature/chat/ChatViewModel.kt` and `ChatScreens.kt`, routes `MESSAGES` and `CONVERSATION`, the icon beside the bell, and Message on the patient's page. English and Filipino strings, including two plurals.

**How sending works.** A message goes into the outbox first, then is sent one at a time in the order written, each with the ID it was given when written. A lost connection stops the run and leaves the message waiting; the next live connection sends it. A refusal (a closed conversation, too many messages) marks only that message for the person, and the rest carry on. A retry uses the same ID, so the server stores it once whatever happened before.

**Not in this issue.** Attaching photos and video waits for the storage rules in #106, so the camera and gallery permissions are not asked for yet. Shared progress and system notes are #109, and push for new messages is #110.

**Tests run on 2026-11-15**

| Check | Result |
|---|---|
| `LiveChatStackTest`: the real repository and websocket client against the local backend, with a therapist, a patient and an outsider | 1 passed, run four times. Its accounts are removed afterwards (0 left) |
| `ChatViewModelTest` | 12 passed |
| `ChatJsonTest`, `RealtimeFramesTest` | 9 passed |
| `ChatTest` (shared rules) | 9 passed |
| All Android unit tests (`:core:domain:test`, `:app:testDebugUnitTest`) | 350 passed, 0 failed; the live test is skipped when the stack's keys are not given |
| `:app:compileDebugAndroidTestKotlin`, `:app:assembleDebug` | Pass |
| Room's generated schema for `chat_outbox` | Matches the migration's SQL exactly |

| Acceptance criterion | Evidence |
|---|---|
| A message sent from the web appears on Android without a refresh, and the other way round | `LiveChatStackTest`: a message sent through the server functions reaches the other account's websocket within 15 seconds, both ways. The web side of the same functions is `chat.spec.ts` |
| A message written in airplane mode sends once when the connection returns | `ChatViewModelTest`: "a message written offline waits and sends once when the connection returns", and "messages go in the order written and survive the app closing" |
| Unread counts match the web | `LiveChatStackTest` reads `my_conversations`, the function the web reads: 1 before reading, 0 after |
| Leaving and returning reconnects and catches up without duplicates | `ChatViewModelTest`: "what was said while disconnected is read again when the connection returns"; the live connection is held only while the app is started |
| Signing out clears cached messages | The outbox is deleted in `clearCacheOnLogout`; the screen's state is dropped with the account (`ChatViewModelTest`: "nothing is sent for an account that signed out") |
| Unit tests cover the send queue and reconnect logic; a connected test covers the screen | Above. `ConversationScreenTest` (3 tests) compiles and has **not been run**, because no emulator or phone was attached |

**Found while building.** In the test library, work in the background scope is not run by "advance until idle", so the view model tests run it explicitly. This affected the tests only.

**Not run on Android**

- The screens have not been seen on a device or emulator, and `ConversationScreenTest` has not run.
- The live test ran on the computer's JVM, not on a phone, so a phone's network changes (sleep, airplane mode, switching networks) are covered only by the unit tests.

## #111 Privacy, safety and administrator rules

**Built.**

- Migration `202611150002_chat_consent.sql`: the `care-chat-v1` agreement and its rules, and the operator's export and erase functions. Described in [DATABASE.md](../architecture/DATABASE.md#care-chat) and [DATA-LIFECYCLE.md](../operations/DATA-LIFECYCLE.md#care-chat).
- Web: the agreement above a patient's conversations until they turn messages on (`features/chat/ChatAgreement.tsx`), "has not turned on messages yet" for the therapist, and a Messages panel on the patient's Profile to turn them off or on, with a confirm for off.
- Android: the same agreement on Messages and inside a conversation, the same therapist notice, and a Messages card on the patient's Profile.
- The landing page's privacy line now says what is stored: movement summaries from sessions, no camera images, video or landmarks, and messages once turned on. The Android exercise-camera wording is about sessions and is still true; #114 changes it.

**Calls made while building, for the owner to check**

- A therapist agrees to nothing in the app; only the patient does. Staff duties belong to the center's own policies.
- Turning messages off leaves what was said readable to both, rather than hiding it from the therapist, because it is part of the care record. The agreement says so.
- The agreement covers words only. Photos and video will need `care-chat-v2`, accepted before sending media.
- Erasing removes both people's words in the patient's conversations.
- Muting one conversation moves to #110, because there are no chat notifications to mute yet.

**Tests run on 2026-11-15, local backend**

| Check | Result |
|---|---|
| `tests/contract/chat.test.ts` | 14 passed |
| `npm run test:contract` | 188 passed in 17 files |
| `chat.spec.ts` (two browsers) | 10 passed, run twice |
| `patient.spec.ts`, `profile.spec.ts`, `landing.spec.ts`, `chat.spec.ts`, `therapist.spec.ts`, one worker | 64 passed |
| Design gallery axe checks for the new states (`?agreement`, `messages/c4`, `profile?state=empty`) | Passed |
| `npm test`, typecheck, lint | 288 passed; pass |
| Android unit tests | 354 passed, 0 failed |
| `LiveChatStackTest` with the agreement | Passed twice; accounts removed |
| `:app:assembleDebug`, `:app:compileDebugAndroidTestKotlin` | Pass |
| `scripts/check_admin_parity.py` | Pass: no administrator function was added |

| Acceptance criterion | Evidence |
|---|---|
| The privacy agreement, `DATA-LIFECYCLE.md` and the consent version are updated, and chat is unavailable until the new version is accepted | `care-chat-v1`; "lets nobody write until the patient turns messages on, and records the answer once" (contract), the first chat browser test, and `LiveChatStackTest` |
| An administrator and a Scheduler cannot read messages | "keeps outsiders out of the messages, by function and by table" (contract). Attachments do not exist yet; #106 must add the same test for them |
| A data export includes the patient's messages; a deletion removes them | "gives the trusted operator, and nobody else, an export…" and "erases the patient's messages only for an open deletion request…" (contract). Attachments follow in #106 |
| The emergency line in English and Filipino, reviewed by a therapist | In the agreement and under every conversation on both apps. The therapist review is **not done**; it is in the checklist |
| `scripts/check_admin_parity.py` passes | Pass |

**Hosted.** On the owner's instruction on 2026-11-15, `202611150002_chat_consent.sql` was applied to the hosted project after a dry run that listed only it, and read back with `migration list --linked`. Not exercised there.

**Not run.** The Android screens have still not been seen on a device.

## #106 Photos and video

**Built.**

- Server: migration `202611150003_chat_media.sql` (described in [DATABASE.md](../architecture/DATABASE.md#care-chat)), and `scripts/cleanup_chat_media.py`.
- Web: `features/chat/media.ts` shrinks a photo to 1600 px JPEG and re-encodes a video to 480p at about 1 Mbps, first 30 seconds, with the browser's canvas and `MediaRecorder` (WebM in Chrome and Firefox, MP4 in Safari); `MediaBubble.tsx` shows previews, opens files and says when one has expired. The attach button, the preparing state and the media agreement are in `MessagesView.tsx`.
- Android: `data/local/ChatMediaFiles.kt` shrinks photos with `BitmapFactory` and re-encodes video with Media3 Transformer 1.5.1 to 480p H.264; `feature/chat/ChatMedia.kt` has the attach menu (gallery, take photo, record video), previews and the full-screen viewer. A waiting photo or video is kept in the outbox (Room version 4). The phone keeps a copy of each file it shows or sends, until sign-out.
- The agreement is now `care-chat-v2`, adding point 5 about media; patients who agreed to v1 keep sending words, and see a short panel to allow photos and videos.

**Calls made while building**

- The 15-day removal has two parts. On day 15 the server stops issuing links, which is exact and tested. The file itself is removed by the cleanup script, because only Storage's API can remove files; the owner must schedule it. Storage's newer bucket lifecycle rules were not used, because they could not be confirmed on the hosted project.
- Video on the web re-encodes in real time, so a 30-second clip takes about 30 seconds to prepare. A browser that will not play sound without a tap sends the video without sound rather than failing.
- Phone copies stay in the app's own storage, not the gallery, and go at sign-out.
- A sent photo or video has no caption box in the apps yet, though the server accepts one.

**Tests run on 2026-11-15**

| Check | Result |
|---|---|
| `tests/contract/chat-media.test.ts` | 10 passed, run twice |
| `npm run test:contract` | 198 passed in 18 files |
| `chat.spec.ts` (two browsers, a real 3000 x 2000 photo and a real 720p clip made in the browser) | 12 passed, run twice |
| Web unit tests (including the size rules) | 292 passed |
| Android unit tests | 363 passed, 0 failed |
| `LiveChatStackTest` with a real photo upload | Passed twice |
| `:app:assembleDebug`, `check_apk_native_libraries.py`, `check_resources.py`, `check_module_boundaries.py` | Pass. The APK grew from 45.2 MB to 46.4 MB |
| Room schema version 4 | The new column matches its migration |
| Leftover rows and files after all of the above | None |
| Wide browser run (`chat`, `patient`, `profile`, `landing`, `therapist`, `design`), one worker | 149 passed, 83 skipped (the suite's own); the admin profile axe check failed once in the 13-minute run and passed alone, the known low-memory pattern on this machine |

| Acceptance criterion | Evidence |
|---|---|
| A photo and a video each upload, appear for the other person and play or open, on Android and on the web | Web: `chat.spec.ts`, both ways, with the stored photo at 1600 x 1066 and the video at 852 x 480 opening and playing. Android: `LiveChatStackTest` sends a real photo with the app's repository and the other account fetches the same bytes; `ChatViewModelTest` covers the three-step send. Android video has **not** been re-encoded on a device |
| Someone outside the conversation cannot fetch the file, even with its path | `chat-media.test.ts`: another therapist, a Scheduler and an administrator cannot sign, download or list it, and the public address returns nothing; `LiveChatStackTest` likewise |
| A large photo and a long video are resized on the device before upload, and the stored files are within the limits | Web: `chat.spec.ts` with a 3000 x 2000 photo over 1 MB and a 720p clip; the size rules are unit-tested on both apps with the same cases, including trimming to 30 seconds. Android's photo and video code is compiled but has **not** run on a device |
| A file of the wrong type or over the limit is refused by the server with a clear message | `chat-media.test.ts`: wrong type, too many pixels, too long, over 1 MB after upload, stored type different from the one agreed, a type the bucket refuses, files missing |
| A file is gone from storage 15 days after sending, its message says it expired, and an Android phone that had downloaded it still shows it | Server and web: "closes a file on day 15, and the cleanup removes it from Storage", and the browser test "a photo past its 15 days says so". Android keeps its copy by design (`ChatMediaFiles.copy`), **not** shown on a device |
| A signed link stops working after it expires | `chat-media.test.ts`, with a 1-second link |
| Deleting a patient's data removes their attachments from storage | `chat-media.test.ts`: the export lists the file; after erasure and the cleanup, no file of that conversation is left |
| The privacy agreement and the landing page's line are reworded | `care-chat-v2` point 5 in both apps and both languages; the landing page now says photos and videos are removed after 15 days. Exercise-camera wording is unchanged and still true; #114 changes it |

**Found while building**

- A browser-recorded video does not say how long it is until it has been read to the end, so the web seeks to the end once before preparing it.
- The test clean-up deletes rows with triggers off, which also stops the database's own cascades. It had left 1,199 chat messages and 16 attachments from earlier test runs in the local database; none belonged to a real account. They are removed, both clean-ups now remove chat rows explicitly, and the cleanup now also catches any file no row names.
- Gradle's offline mode had not downloaded Media3's library files, and my first "compiled" checks had hidden that failure. The Android results above are from builds that did download them.

## #110 New-message notifications

**Built.** Migration `202611150004_chat_notifications.sql`: the `chat_message` kind in the group `messages`, a trigger on new messages, reading a conversation reads its notices, the Messages switch, and per-person muting in `chat_mutes`. `_shared/push.ts` and `_shared/push_text.ts` add the words and `conversation_id`. Web: the bell writes and opens the new kind, and the conversation header has Mute. Android: the kind, the switch on Profile, its own `messages` channel, no push for the conversation on screen (`ChatPresence`), one notification per conversation that later messages replace, a tap that opens the conversation, and Mute in the header. Words and rules are in [NOTIFICATIONS.md](../operations/NOTIFICATIONS.md#what-is-sent).

**Calls made while building**

- A burst is everything until the person reads, or for 10 minutes, whichever is first. Someone who read the conversation in the last 2 minutes is treated as reading along and gets nothing.
- Either person can mute, not only the therapist, because the rule is the same for both and costs nothing.
- The push names who wrote but never what they said. The lock screen shows only "You have an update".

**Tests run on 2026-11-15, local backend**

| Check | Result |
|---|---|
| `tests/contract/chat-notifications.test.ts` | 5 passed |
| `tests/contract/push.test.ts` (words, no message text, `conversation_id`) | Passed |
| `npm run test:contract` | 204 passed in 19 files |
| Web unit tests | 293 passed |
| `notifications.spec.ts` and `chat.spec.ts`, one worker | 19 passed; the gallery's bell and Messages pages pass axe |
| Android unit tests | 366 passed |
| `LiveChatStackTest`, `assembleDebug`, resource and native-library checks | Pass |

| Acceptance criterion | Evidence |
|---|---|
| A message to someone with the app closed produces one push and one bell entry; opening it lands in that conversation | Contract: one notice with a pending push and no email. Web: `notificationTarget` opens the conversation. Android: `NotificationsTest` (destination) and `PushRulesTest`; the tap-to-open path compiles and has **not** run on a device |
| A burst of messages produces one push | Contract: "makes a burst one notification while the last is unread"; on the phone, later pushes in a burst replace the same notification |
| No push arrives for a conversation that is open on that device | `PushRulesTest`; on the server, nothing is made while the person reads along. **Not** seen on a device |
| The switch stops push but not the bell or the unread count | Contract: queued as `skipped`, `Turned off`, the bell row is there; an older app cannot turn it back on |
| `NOTIFICATIONS.md` documents the kind, its channel and its text in both languages | Done |
| Mute, carried over from #111 | Contract: `Muted`, private to the person, refused for an outsider; `ChatViewModelTest` |

**Not run.** No push has been delivered: there is no Firebase project yet, and `notification-dispatch` is not redeployed with the new words. The migration was applied to the hosted project on 2026-11-15 on the owner's instruction and read back.

## #109 Cards, lines and scheduled messages

**Built.** Migration `202611150005_chat_cards.sql` (described in [DATABASE.md](../architecture/DATABASE.md#care-chat)). Web: `features/chat/ChatCards.tsx` draws progress and exercise cards and the quiet lines; `ShareDialog.tsx` shares from Progress; Send in chat on a patient's plans; scheduling and the waiting list in the conversation. Android: `feature/chat/ChatCards.kt` with the same cards, lines, a share dialog, and a date and time picker for scheduling; Share in chat in the results dashboard and Send in chat under each plan.

**Calls made while building**

- A progress card is the snapshot the app shows, checked by the server for shape and bounds and stamped with the moment; it is not recomputed by the server. An exercise card is written by the server from the plan.
- Lines are facts, so each reader sees them in their own language. They are not unread, notify nobody and are never the list's last line.
- The reminder line goes to each therapist with an active plan for the patient; the finished-session line to the plan's therapist.
- Only therapists schedule, from 1 minute to 60 days ahead, at most 50 waiting. Nothing is sent into a conversation that has closed by then.

**Tests run on 2026-11-15, local backend**

| Check | Result |
|---|---|
| `tests/contract/chat-cards.test.ts` | 6 passed |
| `npm run test:contract` | 210 passed in 20 files |
| Web unit tests, typecheck, lint | 293 passed; pass |
| `chat-cards.spec.ts` (two browsers) | 5 passed in 3 of 4 runs; the other timed out loading a record on this slow machine, and the time limit was raised to 60 seconds |
| Wide browser run: `chat-cards`, `chat`, `therapist`, `therapist-caseload`, `patient`, `notifications`, `design`, one worker | 156 passed, none failed or flaky; the rest of the 239 are the suites' own skips |
| Android unit tests | 372 passed |
| `assembleDebug`, `check_resources.py`, `check_admin_parity.py` | Pass |

| Acceptance criterion | Evidence |
|---|---|
| A shared progress card shows the same numbers as the Progress page when it was sent, on both apps | `chat-cards.spec.ts` reads the Latest figure off the patient's Progress page and finds it on the therapist's card; Android builds the card with the same `seriesOutcome` rules (`ChatTest`) |
| A card never shows data to someone who could not open the page it links to | A conversation is only ever between a patient and their linked therapist, both of whom can open that patient's Progress and plans; exercise cards for another patient are refused (contract) |
| A daily reminder and a finished session each appear once in the right conversation, in the reader's language | Contract: one line for a repeated reminder, one for a finished session; browser: the line in Filipino and English |
| A scheduled message is delivered once at its time, and can be cancelled before it | Contract and browser |
| Turning the reminder off on Profile also stops its line | The line is made only from a reminder notification, which is made only for a chosen reminder time (`enqueue_practice_reminders`) |

**Hosted.** `202611150005_chat_cards.sql` was applied on 2026-11-15 on the owner's instruction and read back; the `send-scheduled-messages` job is created by it. Nothing has been sent on hosted.

**Not run.** The Android cards, sharing and scheduling have not been seen on a device.

## #114 Session video in the phone's gallery

**Built.** Android only, as exercises run only there. `feature/exercise/SessionVideo.kt`:
- `SessionRecorder` encodes H.264 MP4 with `MediaCodec` and `MediaMuxer` on its own thread, from the same upright frame the screen shows.
- `VideoOverlay` draws the skeleton, the focus joint and the protractor with its angle, mirrored for the front camera as on screen, plus a caption of exercise, angle and count.
- `GalleryVideos` saves into `Movies/Motivance` through MediaStore, and `SessionVideoStore` keeps the agreement and which sessions each video shows.

`CameraPrototype.kt` adds the Record this session switch, the agreement dialog and a Recording pill. `SessionVideoCard.kt` shows the video on the result with Watch, Send in chat and Delete. Send goes through the chat attach path, so it is resized and removed from the server after 15 days. The privacy wording is changed on Android (camera, both consent lines and the sign-up agreement) and on the web landing page (privacy line and agreement point 4), in English and Filipino.

**Calls made while building**

- Each frame is handed over only after the screen has shown it, because shown frames are never recycled. If the encoder is still busy, the frame is skipped, so tracking and counting never wait.
- Recording starts with the session, not when the screen opens. Both sides of a set go into one video, which is finished when the set is saved, the screen is left, or New session is pressed.
- The agreement is local, versioned `session-video-v1`, because the video never leaves the phone by itself.
- A video the app no longer owns, as after a reinstall, is deleted through the phone's own confirmation (`createDeleteRequest`, Android 11 and later).

**Tests run on 2026-11-15**

| Check | Result |
|---|---|
| `SessionVideoTest` (JVM): size, bitrate, name, the stored list | 4 passed |
| `SessionRecorderTest` on the Pixel 6 emulator, API 35, software graphics | 4 passed: frames become a playable MP4 with the overlay's colours in a decoded frame; handing a frame over takes under 5 ms however busy the encoder is; no frames writes no file; the video lands in `Movies/Motivance/` and deleting removes it; the agreement and the list are kept per person. The emulator encoded about 11 frames a second and skipped the rest, as designed |
| Android unit tests (app, domain, assessment) | 430 passed, 1 skipped (the live-stack test without its variables) |
| Every Android device test on the emulator | 134 of 135 passed. `CameraLifecycleTest` waits 30 s for live inference and fails the same way with this change removed (`git stash`), because the headless emulator gives no camera frames; it is an emulator limit, not this change |
| Web unit tests; `landing` and `design` browser tests | 293 passed; 94 passed |

| Acceptance criterion | Evidence |
|---|---|
| With recording off, behaviour is as today and no file is written | No recorder exists unless the switch is on and a session has started (`CameraPrototype.kt`); a recorder given no frames writes nothing (device test) |
| With recording on and consent given, one playable video per session is saved and listed with that session's result | Device test for the file; the result card reads it from the session's state. The on-screen flow is not yet run on a phone |
| Not uploaded unless the patient sends it in chat | Nothing in the recording path calls the network; Send in chat hands it to the existing chat attach |
| Deleting it from the result removes the file | Device test for `GalleryVideos.delete` |
| Counting and frame rate stay within the performance policy while recording | The hand-over is measured under 5 ms and never blocks; the camera thread itself on a phone is not yet measured |
| The video includes the overlay and appears in a Motivance album | Device test: overlay colours in a decoded frame, `RELATIVE_PATH` `Movies/Motivance/` |
| Signing out leaves gallery videos; documented and in the agreement | `DATA-LIFECYCLE.md` Session videos; agreement point 5 |
| Reworded privacy text in English and Filipino | Android `camera_privacy`, `local_metrics_consent`, `sync_metrics_consent`, `signup_privacy_point_4`; web `landing.privacyDetail` and agreement `point4` |

**Not run.** A real session recorded on a phone with its camera, frame rate and counting measured while recording; playing, sending and deleting from the result on a phone; Android 9 and older with the storage permission.

## #112 Regression, cross-app check, load check and rollout

**Built.**
- `tests/contract/chat-cross-app.test.ts` (web) and `CrossAppTest.kt` (Android) check payloads both ways:
  - The web writes one of each message kind: text, photo, video, both progress cards, an exercise card, a reminder line and a scheduled message.
  - It keeps the server's exact reply, with IDs and times made stable, in `android/app/src/test/resources/cross-app/`, and Android parses that.
  - The other way, the web sends the progress facts Android writes, from `android-progress.json`, and reads them as its own.
  - A change in shape fails one side. `MOTIVANCE_UPDATE_FIXTURES=1` accepts it.
- `tests/contract/chat-load.test.ts` runs on demand with `MOTIVANCE_LOAD=1`. It sets up one therapist with 150 conversations and one conversation of 5,020 messages.
- The load check found the conversation list slow, fixed by `202611150006_chat_list_speed.sql` (see [DATABASE.md](../architecture/DATABASE.md)).
- Rollout notes: [CARE-CHAT-ROLLOUT.md](../operations/CARE-CHAT-ROLLOUT.md).

**Load check, local stack, 2026-11-15**

| Call | Before the fix | After |
|---|---|---|
| `my_conversations`, 150 conversations (median of 7) | 569 ms (`chat_can_read` and `chat_can_send` about 200 ms each) | 28 ms |
| First page of the 5,020-message conversation | 10 ms | 10 ms |
| A page 20 pages back in the history | 10 ms | 10 ms; the plan uses `chat_messages_page` (index-only scan) |
| `send_message` into that conversation | 8 ms | 8 ms |
| `mark_conversation_read` | 8 ms | 7 ms |

The list and the original checks agree for every one of the 150 conversations. After one link is closed and one agreement withdrawn, exactly those rows change, and they change the same way in both.

**Regression run on 2026-11-15**

| Suite | Result |
|---|---|
| Web typecheck and lint | Pass |
| Web unit tests | 293 passed |
| Web contract tests, one file at a time | 212 passed in 21 files; the 3 load tests skipped as designed, and passed in their own run with `MOTIVANCE_LOAD=1` |
| Cross-app: `chat-cross-app.test.ts` (twice, the fixture stable between runs) and `CrossAppTest` | 2 and 3 passed |
| Android `LiveChatStackTest` against the local stack | Passed |
| Android unit tests (app, domain, assessment) | 433 passed, 1 skipped (the live-stack test, run on its own above) |
| Android device tests on the Pixel 6 emulator (at #114, no Android app code changed since) | 134 of 135; `CameraLifecycleTest` needs camera frames the headless emulator does not give, and fails the same way without chat |
| Every web browser test, one worker | **Not completed.** Claude Code stopped it for low memory while it ran. Earlier on 2026-11-15 the chat, cards, therapist, patient, notifications and design suites passed together (156), and the landing and design suites passed (94) |

**Not run.**
- The full browser suite in one run.
- Anything on the hosted project, which needs the owner's approval.
- `202611150006` on hosted.
- A load check on hosted hardware.
- Two real phones on a real network.

## Not run / not done (whole epic)

- Chat has not been exercised on the hosted project, and the web app has not been redeployed, so the live site has no Messages page yet.
- The Android chat screens have not been run on a device or emulator, and Android has never prepared a real photo or video.
- `202611150003_chat_media.sql` is on the hosted project (applied 2026-11-15 on the owner's instruction, read back with `migration list --linked`), but the cleanup is not scheduled there and no file has been sent on hosted.
- The load check ran on the local stack only (#112).
