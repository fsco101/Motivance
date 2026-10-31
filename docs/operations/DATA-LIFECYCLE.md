# Development data lifecycle and request handling

S3 implements consent history, a privacy-request queue, access revocation and auditable prescription changes. This document defines the current development policy and the trusted operator's follow-up procedure; the application does not silently delete immutable history.

## Consent and local storage

Before creating a prescribed session checkpoint the app records an owner-scoped `movement-summary-v1` grant event in Room. Camera permission alone authorizes no persisted rehabilitation summary. The session pins that grant UUID; WorkManager uploads the event before its dependent session. Offline events retain their original timestamps and retry with the same UUID. Grant/withdrawal events append history, never rewrite it.

Withdrawal stops new collection under the prior grant. A new session needs a new explicit grant; server ingestion rejects sessions extending past a withdrawal under the old grant. Records completed before withdrawal remain available to their patient. The UI offers export/deletion requests independently of camera permission and consent withdrawal.

No app feature stores raw camera frames, video, or per-frame pose sequences. SQLite holds aggregate results, versioned targets, instructions and consent/outbox state. Device backup/transfer is excluded. Sign-out deletes the encrypted token file and prescription cache, interrupts drafts and retains owner-scoped results/outbox so an unsent result is not silently lost. A different account cannot upload those records. Keystore protects tokens; Room aggregate data is app-private but not encrypted by Room.

## Retention policy

`public.retention_policy` contains the explicit engineering default `development-v1`: **automatic deletion disabled, review after 365 days**. It is a review interval, not a claim of an approved clinical/legal retention period or an automatic purge job. No production policy is inferred from a user's device clock. Local unsynchronized results are retained until reviewed; resetting/uninstalling the development app or deleting its data removes its local database.

Before pilot data collection, the deployment owner must set actual live/local retention, request response time, account deletion, encryption and backup expiry in the deployment policy. This follow-up is recorded in `docs/validation/POST-IMPLEMENTATION-CHECKLIST.md`; it does not block implementing or testing the development workflow.

## Export or deletion request workflow

1. The signed-in patient submits `request_patient_data` with a stable request UUID and `export` or `delete`. RLS exposes only the patient's own requests and trusted administrators' permitted view. Repeating an identical UUID is idempotent.
2. The app displays **recorded; awaiting administrator review**. It never reports that an export exists or that records/backups were erased simply because the request was queued.
3. A trusted operator reviews the queue in the protected Supabase administrative environment, verifies the requester and confirms scope, retention obligations and identity-handling requirements. Therapist access alone does not authorize fulfilling privacy requests.
4. For export, gather the verified patient's profile, relevant prescription versions, sessions/measurements and consent history through a trusted controlled export. Deliver it through the deployment owner's approved channel. The app does not email exports or attach credentials to a request.
5. For deletion, assess active prescriptions, immutable references, audit/identity records and backup expiry together. An audited production purge/account-deletion procedure must be reviewed during release preparation. Do not disable historical-integrity triggers ad hoc on live data; the disposable integration-test cleanup is not a production deletion implementation.
6. Only after fulfillment or a documented decision should the trusted operator set the request to `fulfilled` or `declined`, with `resolved_at`. The audit trigger records the status change. Keep sensitive justification in the protected operational case system, not a public issue or raw app logs.

Automated export delivery, an automatic historical purge and administrator-facing request fulfillment are outside S3's patient request queue; release operations must complete them according to the selected policy. They are not presented as implemented background deletions.

## Access and audit

Invitation codes expire after seven days and are hashed in the database; only a matching authenticated email can redeem one. A therapist revokes only their own link. Revocation disables that therapist's assignments and future server reads; existing offline instructions cannot be remotely removed while disconnected, but expire after 24 hours. New uploads for an inactive assignment fail visibly rather than being silently accepted.

Audit events contain actor, action, table/target identifier and server time for invitations, links, roles, prescriptions and privacy requests. Raw tokens, passwords, invitation codes, video and pose traces are excluded. Use synthetic records for automated tests and exclude private screenshots from the repository.
