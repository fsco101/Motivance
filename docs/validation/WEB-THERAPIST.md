# Therapist web workspace

Date: 2026-11-05. Local engineering evidence for S7 (MOT-37 to MOT-42): a development machine, a headless browser and the local Supabase stack. No therapist or patient has used these screens, nothing ran on a physical phone, and none of this is clinical validation.

## What exists

| Issue | Delivered |
| --- | --- |
| MOT-37 | Home page: counts, the latest movement of up to six patients, and recent patients |
| MOT-38 | Patient list with search and sort, invitations with a copyable code, and link revocation |
| MOT-39 | Patient record: profile, plans, and the series the patient worked on last |
| MOT-40 | Assignment editor: new plans and new versions, retry-safe publishing, and limits that match the server |
| MOT-41 | Custom exercises from the editor, and a My exercises page |
| MOT-42 | Progress: one patient at a time, server-side filters, charts and paged history |

Each page loads as its own download. The screens are the same views the owner reviewed at `/design`, now reading live data.

## Results

| Check | Result |
| --- | --- |
| Type check and lint | Clean |
| Unit tests | 90 passed |
| Contract tests on the local Supabase stack | 16 passed |
| Browser tests | 99 passed, 77 skipped |
| Android decoder test for web-published prescriptions | 4 passed |
| Design captures | 76 passed, 13 screens at 3 widths in [web-design](web-design/), plus state captures |
| Initial JavaScript | 286 KB compressed, budget 300 KB |

The skipped browser tests are the on-demand screenshot captures and the frame-rate measurement. The captures ran separately, as shown above.

**CI has not run this work.** GitHub Actions cannot start jobs while the account is locked over billing. See [web foundation](WEB-FOUNDATION.md#continuous-integration).

## Acceptance evidence

`therapist.spec.ts` is one therapist's whole journey. `therapist-caseload.spec.ts` covers a full caseload: several patients, one shared with a colleague, and the ways a page can fail.

| Criterion | Proven by |
| --- | --- |
| MOT-37-AC1 | `home counts come from the server…`, `a new therapist is told what to do first`, `…tells loading, failure and an empty list apart` |
| MOT-37-AC2 | `home counts come from the server…`. Patient cards use the shared interactive card. Metrics are plain linked readouts, the design the owner approved in S6, so the criterion's wording was updated |
| MOT-37-AC3 | `home counts…invent no score` |
| MOT-37-AC4 | `the whole page works by keyboard, and a refresh keeps the list on screen` |
| MOT-38-AC1 | `the list shows linked patients only, and can be searched and sorted` |
| MOT-38-AC2 | Contract: `keeps one therapist's patients and custom exercises from another`, `shows someone who is also an administrator only the patients linked to them`. Browser: `a patient who is not linked cannot be reached through the address bar` |
| MOT-38-AC3 | `an invitation code copies, and the button says so in place` |
| MOT-38-AC4 | `revoking needs a confirmation that names the patient, and ends access` |
| MOT-38-AC5 | `the whole page works by keyboard…`, `each card is one link and one menu in the tab order`, `the patient actions menu opens with Enter, Space and ArrowDown` |
| MOT-39-AC1 | `the record puts everything side by side on wide screens and stacks it on narrow ones` |
| MOT-39-AC2 | `each plan card shows its details, and only the therapist who assigned it can edit` |
| MOT-39-AC3 | `a removed exercise leaves the list but stays named on the plan` |
| MOT-39-AC4 | `opening another patient never shows the previous one, even for a moment`, `…tells loading, failure and an empty list apart`, `a record that cannot load offers a retry…` |
| MOT-40-AC1 | `a published prescription lands with the chosen values` |
| MOT-40-AC2 | `dragging the range arc snaps to 5 degrees`, `the range arc works by keyboard…`, and the geometry unit tests |
| MOT-40-AC3 | `prescription limits match publish_prescription`, `blank or impossible timing stops publishing…`, `a range the server would refuse stops publishing` |
| MOT-40-AC4 | Contract: `makes a retried publish safe`. Browser: `editing makes a new version of the same plan`, `a second exercise is its own plan and never replaces the first` |
| MOT-40-AC5 | `publishing needs an exercise, and offers each exercise once`, `a plan pinned to an older exercise version can still be edited` |
| MOT-40-AC6 | `crossApp.test.ts` and `WebPublishedPrescriptionTest` |
| MOT-41-AC1 | `custom exercise limits match Android`, `a custom exercise is created in the editor…` |
| MOT-41-AC2 | Contract: `makes a retried custom exercise safe`. Browser: `a custom exercise is created in the editor, selected, and published` |
| MOT-41-AC3 | `a removed exercise leaves the list but stays named on the plan` |
| MOT-41-AC4 | `another therapist cannot see that custom exercise` |
| MOT-41-AC5 | **Deferred.** `crossApp.test.ts` and `WebPublishedPrescriptionTest` prove Android decodes the exercise with its name and joint. Running it on a phone is in the [follow-up checklist](POST-IMPLEMENTATION-CHECKLIST.md) |
| MOT-42-AC1 | Contract: `pages past the first 50 sessions without gaps or repeats`, `accepts the keyset cursor and every filter`. Browser: `progress filters run on the server`, `typing a date keeps focus…` |
| MOT-42-AC2 | `charts answer the keyboard and the pointer, and offer a table`, `a chart line draws in…`, `a chart line appears at once…` |
| MOT-42-AC3 | `starts a new series when the prescription changes…`, `never merges different model versions`, `each session keeps the targets prescribed at the time, in its own series` |
| MOT-42-AC4 | `each session keeps the targets…`, `a custom exercise shows the therapist's name for it in the history` |
| MOT-42-AC5 | `failed tracking never shows as a measurement`, `a measured session reaches the home fan…` |

## How a prescription reaches Android

`crossApp.test.ts` publishes through the web code, then reads the result with Android's exact query and compares it with `android/app/src/test/resources/web-published-prescriptions.json`. `WebPublishedPrescriptionTest` feeds that same file to Android's real decoder. If either app changes what it writes or reads, one of the two tests fails. After an intended change, run `UPDATE_ANDROID_FIXTURE=1 npm run test:contract`.

## What review and testing found

A code review of this work, then the new tests, found these problems. All are fixed and each has a test.

| Problem | Effect | Fix |
| --- | --- | --- |
| Enter opened and closed the patient actions menu at once | Keyboard users could not reach Revoke with Enter | Motion turns Enter into a pointer press, so the menu trigger turns that off |
| Every card had an empty tab stop | An extra Tab press per card, with nothing to announce | The card surface is no longer focusable |
| Closing a dialog lost keyboard focus | Keyboard users restarted from the top of the page | Dialogs return focus to where they opened from |
| Dialog descriptions were not linked to the dialog | Screen readers skipped them | Linked |
| A failed read took about 24 seconds to show | 12 requests, because two retry layers multiplied | The Supabase client's retries are now the only ones, so a failure shows in about 7 seconds |
| The filter bar was rebuilt on every change | Typing a date lost focus after one digit | Filters stay on screen while results load |
| A failed Load older replaced the page with an error | Loaded sessions disappeared | They stay, and a message offers another try |
| The record chart put every exercise on one line | Looked like large swings in one measure | It shows one named series, built the same way as Progress |
| A failed workspace read left the record loading for ever | No way forward but reloading | It offers Try again |
| A plan on a removed exercise could not publish, with no reason given | A generic failure after filling in the form | It names the problem and asks for another exercise |
| Edit was offered on a colleague's plan | The server refused after the form was filled in | Edit shows only on the therapist's own plans |
| Blank timing fields were sent as 0, and decimals reached the server | A patient could get a hold of 0 without anyone choosing it | Blanks and decimals are refused, as on Android |
| Someone with both staff roles saw every patient as a therapist | Unlinked patients on the therapist pages | Therapist pages read linked patients only |
| A run of failed sessions hid an older real result | The card wrongly said there were no sessions | The query asks for usable sessions only |
| Saving a recovered password twice was refused | The password had changed, but the page said it had not | A retry goes straight to sign-in |
| Birthdates showed a day early west of Greenwich | The wrong date on the record | A birthdate is treated as a calendar day |
| A swipe on the landing demo did not scroll the phone page | The page felt stuck over the demo | Vertical swipes scroll, and only a sideways drag moves the arm |

## Known limits

- A chart opened directly appears complete. It draws in only when arriving from another page, because the page transition skips its first render.
- Changing the exercise while editing a plan makes a new version of that plan, as on Android. It does not create a second plan. **Assign exercise** always creates a new one.
- The home count is "up to the latest 20" sessions, not a total.
- New Filipino text has not had a native review.
