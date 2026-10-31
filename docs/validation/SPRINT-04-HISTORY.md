# Sprint 4 MOT-19: patient history and progress

Implemented the shared patient/therapist history dashboard following the S3 connected workflow. MOT-19 is available for engineering acceptance review; the rest of S4 is still planned. No sprint is marked complete and no GitHub issue is closed by this delivery.

Progress requires a single patient: the patient account is fixed to itself, while a therapist chooses a linked patient. Patient detail opens the same dashboard with that patient fixed. Filters support exercise definition version, side and optional inclusive UTC calendar dates. Server reads use the existing RLS policies, explicit composite prescription FK and every child measurement. No new schema migration is required.

History pages contain 50 visible sessions and one lookahead, ordered by start time and UUID. An older-page cursor compares both fields and remains stable when a newer session is uploaded. The chart explicitly summarizes loaded records only. Refresh, account/filter changes and failed requests clear previous displayed data. A failed older-page request requires a fresh history retry. Pending local sessions appear in Local history until synchronized.

Charts separate patient, exercise definition, side, immutable prescription, metric, model and algorithm. Each series shows its original degree/repetition targets and prescription version; editing a current assignment never changes a historical target. ROM and completed-repetition charts use separate scales, zero baselines and chronological session order. Only completed sessions with valid quality, finite paired extrema and positive valid-frame counts supply points. Missing, limited, invalid or interrupted results leave gaps. Cards retain every metric, quality/frame counts and completed/partial/interrupted/empty/invalid labels. Limited extrema remain visible in their labeled detail cards but never enter a trend. English and Filipino resources cover the new controls and result states.

## Executed verification

Final local results: 69 JVM tests (14 new history tests), 15 emulator instrumented tests (3 new dashboard tests), and 59 connected-backend checks (14 new history checks) passed. Build and lint passed with no errors; lint records 67 warnings and one informational finding. [Synthetic emulator chart screenshot](ui/sprint-04-history-chart.png) was visually inspected with the application theme. Physical-device and therapist checks remain deferred.

- `sprint-04-history-test-results.json` records the exact APK hash, JVM suites, emulator results, lint counts and supporting paths.
- Six pure Kotlin tests cover date/identifier validation, session status distinctions, invalid tracking/extrema, historical targets, provenance separation, metric retention, chronological ordering and gaps.
- Five repository tests cover encoded server filters, inclusive UTC boundaries, explicit FK selection, authenticated access, denied requests, complete metric decoding, missing exercise details and lookahead cursors.
- Three ViewModel tests cover late non-cooperative responses after account/filter changes, paging/deduplication and failure/retry clearing.
- Three Compose emulator tests verify separate prescription charts and original targets, readable result labels, and invalid-date feedback that hides previous results. The full instrumented run also executes the twelve existing persistence/synchronization tests. Screenshot evidence uses synthetic records, never patient data.
- `sprint-04-history-backend-results.json` records fourteen real local Auth/PostgREST checks, including tied-timestamp pagination with a concurrent newer insert, inclusive date boundaries, all child metrics, old targets after an edit, patient/therapist isolation and revocation. These run within `python scripts/test_connected_workflow.py`, alongside the existing 45 connected-workflow checks. Fixture inserts explicitly model older/empty/interrupted records and are removed with the four disposable users; demo accounts and programs remain intact.
- Android build, lint, native-library packaging, core-module boundaries and sprint JSON validation are run before delivery. `sprint-04-android-checks.log` records the build/instrumented run.

Reproduce from `android/` with JDK 17:

```powershell
.\gradlew.bat :app:assembleDebug :app:connectedDebugAndroidTest :app:lintDebug :app:testDebugUnitTest :core:domain:test :core:assessment:test --console=plain
```

From the repository root, with the local Supabase stack running:

```powershell
python scripts/test_connected_workflow.py
python scripts/check_module_boundaries.py
python scripts/check_apk_native_libraries.py
python scripts/sync_sprints.py --validate-only
```

## Review and follow-up boundary

This is engineering evidence using synthetic records and an emulator. Therapist terminology/chart review, actual patient comprehension, physical phone accessibility and clinical/reference accuracy remain unexecuted in [the follow-up checklist](POST-IMPLEMENTATION-CHECKLIST.md); they do not block development. Charts display estimates and do not establish clinical improvement. Basic administration, the broader bilingual usability pass, lifecycle/performance hardening, full MVP acceptance and production readiness remain MOT-20 through MOT-24.
