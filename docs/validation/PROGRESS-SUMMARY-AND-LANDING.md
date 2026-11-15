# Progress summary and landing page (2026-11-15)

Engineering evidence for the progress improvements on Android and the web, and the landing page rework. Nothing here is clinical validation. Therapist and device checks are deferred in [POST-IMPLEMENTATION-CHECKLIST.md](POST-IMPLEMENTATION-CHECKLIST.md).

## What changed

**Shared rules, written once per app and tested to match** (`web/src/data/history.ts`, `android/core/domain/.../History.kt`):

| Rule | Meaning |
|---|---|
| Activity summary | Completed sessions by calendar day over the last 28 days: sessions in the last 7 days and the 7 before, active days, days in a row, and days since the last session. Interrupted sessions are not counted. A streak that ran through yesterday is not broken by a today that has not happened yet. |
| Series outcome | For one series: latest, best and change since the first measured session. A change needs two measured sessions and never crosses a prescription version, model or algorithm, because a series never does. |
| Tracking concern | Raised when 3 or more of the newest 10 sessions (interrupted ones aside) gave no usable measurement. |

**Data.** The summary reads its own small query (`started_at,status` for one patient since 27 days before today), so it never depends on which page of history is loaded or which filters are set. It uses the existing `sessions` table and its row-level security. There is no schema change and no migration. If the summary cannot be read, the history still shows.

**Per role.**

- **Patient** (both apps): "Your last 4 weeks" with sessions, active days and days in a row; each plan's latest, best and change; a plain prompt about camera setup when sessions keep failing to measure. On Android the session cards no longer show metric keys, tracking-frame counts or ID fragments in the exercise filter.
- **Therapist** (both apps): "Last 4 weeks" with sessions, active days and how long ago the last session was, and a caution after 7 quiet days; the same outcome figures; a prompt that the patient may need help with the camera. Android keeps the minimum, maximum, quality and frame counts for therapists.
- **Administrator and Scheduler:** no change. Neither role reads clinical progress, so `ADMIN-PARITY.md` is untouched.

**Android now agrees with the web on time.** Session times and date filters used UTC; they now use the phone's time zone, as the web uses the browser's, so a session shows and filters on the day it was done.

**Android charts** now label the axis, the first and last dates and the newest value, and mark the newest point.

**Landing page.** Section links in the header (desktop) and footer; three plain facts under the hero; a new "See how you are doing" section that shows the real summary and chart components on sample numbers, labelled as a sample; the care-team section as three columns with a staff sign-in link; a closing call to book; the prototype disclaimer in the footer. No statistics, logos or quotes were added.

## Tests run on 2026-11-15

| Check | Result |
|---|---|
| `npm run typecheck`, `npm run lint` (web) | Pass |
| `npm test` (web unit, 20 files) | 283 passed |
| `npx playwright test landing design` (Chromium) | 84 passed, 83 skipped (the skips are the suite's own, unchanged) |
| `gradlew :core:domain:test :app:testDebugUnitTest` | 319 passed, 0 failed |
| `gradlew :app:compileDebugAndroidTestKotlin` | Compiles |

New or changed tests: `history.test.ts` (outcome, tracking concern, activity summary), `HistoryTest.kt` (the same three, with the same numbers), `HistoryRepositoryTest.kt` (local-day filter boundaries, the activity request), `HistoryViewModelTest.kt` (the summary arrives with the first page, survives older pages and never blocks history), `landing.spec.ts` and `design.spec.ts` (new sections, role wording, axe at four widths).

## Not run

- **Web contract and signed-in browser tests:** not run on the day of the change because Docker was stopped. Run later the same day, with the care chat migration also applied: `npm run test:contract` 184 passed in 17 files, including the activity query; `therapist.spec.ts`, `therapist-caseload.spec.ts` and `patient.spec.ts` 48 passed with one worker.
- **Android connected tests** (`ResultsDashboardTest` and the rest): no emulator or phone was attached. The redesigned Android progress screen compiles and its logic is unit-tested, but it has not been seen on a device.
- GitHub Actions remains unavailable, so nothing ran in CI.
