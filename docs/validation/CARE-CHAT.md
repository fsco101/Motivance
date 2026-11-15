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

## Not run / not done (whole epic)

- Chat has not been exercised on the hosted project, and the web app has not been redeployed, so the live site has no Messages page yet.
- The Android chat screens have not been run on a device or emulator.
- No load check yet (#112).
