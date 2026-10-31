# Sprint 2 and Sprint 3 implementation delivery

Development delivery: Kotlin Android 0.3.0, Room schema 2, Supabase connected-workflow migration. Therapist and physical-device checks are explicitly deferred to `POST-IMPLEMENTATION-CHECKLIST.md` per the user's instruction; they are not development blockers or substituted with fabricated clinical results.

## Delivered functions

| Issue | Functions and behavior |
|---|---|
| MOT-07..12 / S2 | Existing live skeleton, 2D flexion/abduction angle/ROM, quality gates, stable calibration, repetition reasons and local recovery remain available. Start now also rejects stale calibration; downloaded versioned timing/form parameters replace the original engineering-only defaults. |
| MOT-13 | `invite_patient`, `accept_patient_invitation`, `revoke_patient_link`; patient management, matching-email invitation acceptance and scoped revocation. No therapist needs the patient's password. |
| MOT-14 | `publish_prescription` and native prescription form; supported catalogue, left/right targets/repetitions/timing/hold/lean parameters, stable request IDs and immutable version append. |
| MOT-15 | `PrescriptionCache.decode`, `CachedAssignments`, `ExerciseSessionViewModel`; instructions, download time, expiry/error states and launch of a pinned cached assignment online/offline. |
| MOT-16 | `SessionStore.save`, `SessionSync`, `SessionSyncWorker`, `SyncScheduler`, `ingest_session`; durable consent/session outbox, bounded retry, owner checks, atomic server writes and visible pending/uploaded/auth-required/rejected states. |
| MOT-17 | `recordConsent`, `record_consent`, `request_patient_data` and audit triggers; separate consent before persistence, withdrawal history, privacy-request tracking and explicit documented development retention policy. |
| MOT-18 | `test_connected_workflow.py`, `ConnectedPersistenceTest`, `ConnectedRepositoryTest`, `SyncFailuresTest`, existing engine/Room/auth tests and disposable fresh-migration replay. |

The supplied `android/app/MotivanceLogo.png` is preserved. A byte-identical copy in `res/drawable-nodpi/motivance_logo.png` is used by the shared native header, authentication header and adaptive launcher icon. `nodpi` avoids decoding the 1280px source as a much larger density-scaled bitmap. Header evidence: `ui/motivance-logo-header.png`.

## Backend and authorization

Migration `202611010001_connected_workflow.sql` adds invitation, privacy request and retention policy tables; prescription parameters; client consent IDs/times; session hash/consent/duration; and nullable ROM extrema/quality/reason totals. Direct authenticated writes to sessions, child measurements, prescriptions and consent are replaced with validated RPCs, preventing a client from bypassing ownership/consent/idempotency checks. RPC grants exclude anonymous callers; role/ownership/link checks execute inside functions with an empty search path.

An invitation is a seven-day, email-bound random token whose hash alone is stored. Its raw code is returned for manual sharing; no automatic invitation email is sent. Registering and confirming the patient's Auth account remains the patient's own workflow. Revocation disables the caller's own link and assignments and removes future therapist server access. Disconnected instructions remain usable only within their documented 24-hour cache window; later uploads for revoked assignments fail visibly.

Supported development elbow/shoulder definitions are published with `validation_status=development`, enabling implementation/testing without a therapist-approval gate. They do not assert validated clinical accuracy. Prescription edits append versions. A stable version request UUID makes an identical retry idempotent; changed data under that UUID conflicts. A new session pins a specific downloaded version and never silently merges newer settings.

Server ingestion checks authenticated patient ownership, active assignment/link, pinned definition/side/targets/form/timing rules, prior grant and subsequent withdrawal timing, finite paired ROM extrema and aggregate validity. It uses a UUID advisory lock, canonical JSON hash and one transaction for session plus measurement. Identical replay acknowledges the original record; a changed payload under the same UUID is rejected. The integration checks force a child insert failure and prove no parent is left behind.

## Android persistence and background behavior

Room v1-to-v2 migration preserves session totals/history, adds durable consent events/cache download time/outbox attempts, and marks earlier unconsented pending payloads `REVIEW_REQUIRED`. No consent is invented retroactively and no destructive fallback exists. File-backed migration/reopen tests use UUID-named test databases.

A new prescribed session first persists an explicit movement-summary grant, then pins its grant ID before checkpointing. Pause/loss/recovery discard partial cycles while preserving aggregates. The worker uploads consent events chronologically before dependent sessions, keeps the exact stored payload on retries, and marks uploaded only after a matching server acknowledgement.

Connected-network work starts at sign-in/session completion/manual Sync, with periodic 15-minute work covering a process death between Room commit and enqueue. Transient errors use 30-second exponential backoff and at most eight attempts per item. Authentication-required items wait for a valid sign-in; permanent 4xx/conflict/access failures remain rejected. Explicit Sync retries exhausted/auth-waiting work; rejected records require correcting access/configuration or recording a new valid session. Debug demonstrations remain local-only.

The Keystore vault encrypts only runtime session credentials, uses atomic writes and no-backup storage, and binds credentials to the backend URL. Authenticated 401 responses refresh once; a worker cannot upload an outbox belonging to another account. Logout clears credentials/cache and preserves owner-scoped pending results. An expired protected session requires an online sign-in/refresh; an unexpired protected session can be restored during an offline startup.

## Verification and review boundary

- `sprint-03-test-results.json`: build/lint, current JVM/instrumented counts, native packaging and clean-source checks.
- `sprint-03-backend-results.json`: real local Auth/PostgREST checks with two disposable patients and two therapists, invitation matching, direct access isolation, parameter tampering, immutable versions, atomic rollback, duplicate acknowledgement, consent/withdrawal, privacy requests, revocation and minimal audit behavior.
- `sprint-03-instrumented-results.log`: file-backed Room completion/rollback/reopen/isolation, v1 migration, offline/lost-acknowledgement/auth-required/permanent-rejection recovery, consent ordering and Keystore ciphertext/restore/clear.
- `backend-clean-build.json`: application migrations/seed and 18 SQL access tests replayed in an isolated database using Auth definitions only. Existing local/demo data are preserved.
- `clean-android-build.json`: fresh Android source copy with no local properties or Supabase configuration.

An emulator smoke test initially exposed an ambiguous PostgREST profile embedding; the query now names `patients_id_fkey`, and the real backend regression test covers that relationship. The migration test fixture was corrected to load the historical schema from the instrumentation package and handle omitted empty index lists. The final instrumented run must pass before recording delivery evidence.

Physical camera/reference performance, actual participant accuracy, final usability and hosted SMTP/distribution checks are in the follow-up checklist. Data export/deletion requests are implemented as a tracked queue; automated delivery/purge and administrator-facing fulfillment are not claimed. `docs/operations/DATA-LIFECYCLE.md` defines the trusted operator's review procedure and the explicit development retention default. GitHub/source publication and remote CI are separate from these local verification results.

## Run and configure

Use `docs/operations/ENVIRONMENT.md`. Required client configuration remains only Supabase URL, Android URL override and the public publishable/anon key in ignored `android/.env`. No service/secret key, database password, user password, runtime token or signing password belongs in the APK.

The existing local therapist/patient passwords are preserved in ignored `docs/operations/local-test-accounts.json`. `python scripts/seed_local_accounts.py --with-prescription` links the fixtures and creates one development assignment only if the demo patient has none; it does not overwrite a current program. Test scripts use separate disposable users and clean only their own records.
