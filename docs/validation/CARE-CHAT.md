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

**Not run / not done**

- The migration is applied to the local database only. The hosted project is unchanged and needs the owner's approval.
- Android has no chat code yet, so nothing was run there.
- No load check yet (#112).
