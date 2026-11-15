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

## Not run / not done (whole epic)

- Chat has not been exercised on the hosted project, and the web app has not been redeployed, so the live site has no Messages page yet.
- Android has no chat code yet (#108).
- No load check yet (#112).
