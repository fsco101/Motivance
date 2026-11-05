# Web foundation

Date: 2026-11-05. Local engineering evidence for S6 (MOT-31 to MOT-36): a development machine, a headless browser and the local Supabase stack. No therapist, administrator or real-device check was executed; those are listed in `POST-IMPLEMENTATION-CHECKLIST.md`. The web CI workflow has not run yet, because this work has not been pushed.

## What exists

| Issue | Delivered |
| --- | --- |
| MOT-31 | `web/`: React, TypeScript in strict mode, Vite, lint, tests, `web-ci.yml`, and a bundle and secret check |
| MOT-32 | Art direction in [WEB-DESIGN.md](../architecture/WEB-DESIGN.md), and 12 screens at 3 widths in [web-design](web-design/). The project owner told the team to proceed on 2026-11-05 after asking for a landing page and a better sign-in page, and both were added. |
| MOT-33 | Design tokens, component library and the `/design/components` gallery |
| MOT-34 | Motion tokens, interactive and expandable cards, page transitions, MotionArc, RangeArc, RangeDial |
| MOT-35 | One sign-in with a dial that answers the form, role routing, password recovery, idle sign-out, sign-out across tabs |
| MOT-36 | Generated database types, typed queries, the app shell, English and Filipino |
| Added on request | A public landing page with a live skeleton demo |

The therapist and administrator screens are presentational views on sample data. They are designs that S7 and S8 wire to live data, not finished features: the real workspace routes still show a placeholder.

## Evidence

All checks ran on the final code.

| Check | Result |
| --- | --- |
| Clean install from source only: `npm ci`, type check, lint, tests, build | Passed |
| Unit tests | 61 passed |
| Contract tests: real queries and row-level security on local Supabase | 8 passed |
| Browser tests: real app, local backend, disposable accounts | 51 passed |
| Accessibility: axe, WCAG 2.1 A and AA, on all 13 design pages | 0 violations |
| No sideways page scroll at 768, 1024, 1440 and 1920 px, and at 360 px on the two public pages | Passed on every page |
| Card smoothness, 55 cards, pointer sweeping across them | 60.0 frames per second, 95th percentile frame 16.7 ms |
| Shared transition | Measured: the avatar passes through intermediate sizes between 44 and 88 px |
| Initial JavaScript | 271 KB compressed, budget 300 KB |
| Design gallery and sample data in the production build | Absent |
| Secrets in the production build | None |
| Disposable test accounts left behind | 0 |
| `npm audit` | Production dependencies: 0. Development tools: 10 moderate, from `minimatch` |

Browser tests cover each role, blocked addresses, a disabled account, wrong passwords, recovery, correcting a rejected password without a new code, the idle warning and limit, idle expiry across a closed browser, sign-out across tabs, no session left in storage, a failed role lookup, a token refresh during start-up, and a tab refocus on a bad connection.

## Problems found and fixed

Automated tests did not find most of these. They came from reviewing the rendered screens, re-reading the logic, and an independent code review.

| Problem | Effect | Fix |
| --- | --- | --- |
| Prescribed band drawn behind range of motion | A chart implied a comparison the numbers do not support | Band removed, matching Android |
| Failed tracking showed a real-looking angle in the session table | A clinician could read a failed measurement as genuine | Ported Android's `usable` rule |
| Link picker resolved people by name | Two patients with one name could link a therapist to the wrong person's records | Picks by name and email, and never by a bare name |
| Superseded exercise versions were selectable | A patient could receive old instructions | Only the newest version can be chosen; older ones stay named on plans |
| A token refresh during start-up discarded the role lookup | The app could stay on the loading screen forever | Token events no longer count as a new session |
| A failed role lookup signed the person out | A brief network failure ended the session | A retry screen keeps the session |
| Returning to a tab re-checked roles | A bad connection could wipe a half-finished form | Repeat sign-in events for the same account are ignored |
| Idle sign-out relied on browser storage | No sign-out in a browser that refuses storage | The time is also kept in memory |
| A recovery code was verified on every attempt | A rejected password could not be corrected | The verified session is kept across attempts |
| Verifying a recovery code signed the person in at once | A rejected password failed with no message | A separate unsaved session until the password is accepted |
| Progress filters ran on loaded rows, used UTC days and survived a patient change | Older sessions were unreachable, some landed on the wrong day, and a patient could look empty | Filters belong to the query, use local days, and reset per patient |
| A failed invitation never ended | The button stayed busy with no message | The failure is shown |
| Filter tabs announced panels that do not exist; rows opened by mouse only; initials overrode button names; low contrast on green pills | Screen reader and keyboard barriers | Toggle buttons, a real button in each row, initials drawn by CSS, a deeper text token |

## Open

- MOT-31 and MOT-36 each have one acceptance item that needs the first CI run.
- Initial JavaScript is mostly libraries, so S7 must load feature screens by route to stay in budget.
- New Filipino text has had no native review.
