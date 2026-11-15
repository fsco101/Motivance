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

## Not run / not done (whole epic)

- Chat has not been exercised on the hosted project, and the web app has not been redeployed, so the live site has no Messages page yet.
- The Android chat screens have not been run on a device or emulator, and Android has never prepared a real photo or video.
- `202611150003_chat_media.sql` is not on the hosted project, and the cleanup is not scheduled there.
- No load check yet (#112).
