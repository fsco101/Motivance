# Patient signup, editable profiles and therapist profiling

Implemented 2026-11-01. Engineering review by Codex; physical-device, human privacy-wording and therapist review remain deferred.

## Behavior

Patient signup collects full name, username, gender, birthdate, address and contact number, with selectable person/star/heart avatars. Age is derived from birthdate, including whether this year's birthday has occurred. Users can select prefer-not-to-say for gender. A final explicit checkbox confirms the displayed `system-purpose-v1` data privacy agreement. The agreement describes system account/rehabilitation purposes, linked-therapist demographic access, profile editing, reviewed export/deletion requests and the separate movement-summary consent. Submission requires valid fields, a password of at least eight characters and consent.

Profile displays username, avatar, demographics and a fixed sign-in email. All demographic fields and the avatar can be edited. Changing birthdate updates displayed age. Change password requires the current password, a different new password and matching confirmation. The adapter verifies the current password with Auth before changing it; passwords are transient and clear on submission. Profile state is owner-scoped and resets on sign-out/account change.

The connected-patient directory shows username, avatar, name and age. Patient detail adds gender, address, contact and birthdate. These values come from authenticated server reads, not prototype data. Failed workspace refreshes clear earlier workspace records. No photograph upload is implemented; avatar selection uses bundled illustrations.

## Data and access

`202611010005_patient_profiles.sql` adds the demographic table and validated self-profile RPC. Usernames are unique without regard to case. The internal writer is inaccessible to app roles. The public RPC takes no owner identifier, ignores attempted email/identity changes, validates dates/demographics and consent, updates the existing display name, and preserves the original server-controlled consent version/timestamp on edits. Audit entries identify the action and owner without copying demographic values.

RLS permits owner reads, active linked-therapist reads and trusted administrator reads. Anonymous users, unrelated patients and unassigned/revoked therapists cannot read this table. Clients have no direct write grants. Legacy/basic service-provisioned accounts may lack demographic records; the Profile form requires an explicit agreement before adding those details. No consent is inferred for those accounts. The original basic-auth repository entry point remains for existing provisioning/tests; the production signup screen uses the detailed registration entry point.

Demographics are not added to Room, prescription caches or token storage. Their export/deletion handling is part of the existing trusted review procedure in [DATA-LIFECYCLE.md](../operations/DATA-LIFECYCLE.md). Policy wording/version changes must be reviewed together; changing the text does not retroactively change an existing consent record.

## Verification

- Real local Auth/PostgREST: 20 checks passed, covering signup-trigger persistence, consent, uniqueness, owner-only writes, forged owner/email/version rejection, linked/unlinked/revoked access and old/new password behavior. See [backend results](patient-profile-backend-results.json). The test uses local synthetic accounts and sends no emails.
- Fresh schema: all migrations replayed successfully with the existing 18 SQL foundation checks, without resetting the main local database. See [migration replay](backend-clean-build.json).
- Android: debug app and instrumentation APK builds, app/domain unit suites and lint are recorded in [patient-profile-results.json](patient-profile-results.json). Domain tests cover consent, dates, demographic validity and birthday-aware age. Repository tests cover signup payloads and rejection of password changes when the current password is wrong.
- Screen tests cover missing details/consent, read-only email, profile edits, password confirmation and therapist demographic rendering, alongside authentication and history regressions. All 15 emulator tests passed (four profile, eight authentication and three history). See [instrumentation transcript](patient-profiles/instrumentation.txt), [signup agreement](patient-profiles/signup-consent.png) and [therapist demographic fixture](patient-profiles/therapist-demographics.png). The app has 53 passing JVM tests and the domain module has 11; lint reports zero errors and 88 advisory warnings.
- English/Filipino resource parity and module-boundary checks pass. No runtime dependency was added. Database CI now runs `scripts/test_patient_profiles.py`.

No hosted migration, physical-phone usability, TalkBack review, patient comprehension, production privacy approval or clinical validation is claimed. Those follow-ups remain unchecked in [POST-IMPLEMENTATION-CHECKLIST.md](POST-IMPLEMENTATION-CHECKLIST.md).
