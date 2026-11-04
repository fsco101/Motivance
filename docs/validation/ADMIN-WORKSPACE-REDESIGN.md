# Administrator workspace redesign

Engineering review: Claude Code, 2026-11-04. This refines the existing native Android administrator workspace and adds read-only administrator RPCs. It does not establish physical-device usability, TalkBack comprehension, Filipino wording approval or clinical validation.

## Delivered behavior

The workspace in `android/app/src/main/java/com/motivance/feature/admin/` now has five sections, selected from a horizontally scrolling chip row that keeps the selected chip in view:

- **Overview**: server-side counts for accounts (with the disabled count), patient-only accounts (with the count lacking an active therapist), therapists, administrators, active links, active/total exercises, sessions in the last seven days and open privacy requests. Each count is calculated for the whole system, not the loaded directory page. Tiles open the matching section or account filter. A "Needs attention" list shows patients without a therapist, disabled accounts, an empty active catalogue and open privacy requests. The five newest audit records are shown below it.
- **Accounts**: server-side search by display name, email, username or account ID, plus client-side filters (all, patient-only, therapists, administrators, disabled). Compact cards show a role-coloured initials avatar, name, username/email and role/status badges. Expanding a card shows a selectable and copyable account ID, join date, last sign-in, labelled role switches with consequences explained, and a full-width Disable/Enable action. Therapist and patient cards offer a shortcut to the Links section with that account preselected. The administrator's own card shows an explanation and no controls, matching the server's self-modification rule.
- **Links**: therapist and patient pickers suggest active accounts of the correct type from the loaded directory and also accept a pasted account ID. A malformed ID is reported inline. An already-active pair disables submission. Links are grouped by therapist with names, active/revoked status and revoke/restore actions. The list has active/revoked/all filters, and a text filter appears for longer lists.
- **Catalogue**: exercise cards show the name, code, version, algorithm key and active state. Editing is opt-in, with a dirty-state badge, required-field errors, live character counters (120/4000), discard/close, and a confirmation that names the version number to be published.
- **Activity**: an append-only audit feed with category filters (accounts and roles, links, catalogue, clinical, privacy), readable event titles, resolved account/link names, the actor ("System" for trigger events without an authenticated actor) and the local date/time. Older records load in pages of 30.

Every mutation opens a confirmation dialog that names the affected record and states its consequence. Destructive changes use error colouring. Success notices identify the kind of change. A failed read still clears loaded administrator records. The search term is kept for retry and for the refresh that follows a mutation.

## Backend

Migration `supabase/migrations/202611040001_admin_workspace.sql` adds no table, policy or mutation path. It does the following:

- Replaces `admin_accounts(uuid)` with `admin_accounts(uuid, text)`. Results gain `email`, `created_at`, `last_sign_in_at` and `username`. The optional search term is trimmed, limited to 100 characters, case-insensitive and matched literally, with LIKE wildcards escaped. The page size stays at 50 rows plus one lookahead row.
- Adds `admin_summary()`, `admin_links()` (named links, active first, 500-row bound unchanged) and `admin_activity(bigint)` (newest first, 30 rows plus one lookahead row, keyed by audit identity, with actor/target/related names).
- Has every function call `require_admin()` and grants execution only to `authenticated`, so anonymous, patient and therapist callers are denied.

## Executed evidence

| Check | Result |
|---|---|
| `python scripts/test_administration.py` (real local Auth/PostgREST, disposable fixtures) | 76 checks passed (previously 54). New checks cover role denial for the four RPCs, email/date fields, case-insensitive email and display-name search, literal wildcard handling, overlong search rejection, summary keys, unlinked-patient count change on linking, named links, activity ordering/lookahead/cursor and resolved names |
| `python scripts/verify_backend_migrations.py` (fresh database replay) | All migrations plus seed and 18 SQL policy tests passed; main local data preserved |
| App and domain JVM tests | 80 tests, zero failures. New: `AdministrationTest` (6), `AdministrationRepositoryTest` (2), and `AdministrationViewModelTest` (9, previously 4) |
| Pixel 6 AVD instrumented `AdministrationScreenTest` | 3 tests passed: named confirmation before disabling, overview attention navigation, own-account controls hidden |
| Emulator visual review | Every section, the expanded account card, the confirmation dialog, the link picker popup and the catalogue editor were rendered with synthetic fixtures and inspected. This review led to two fixes: shorter catalogue activation labels and auto-reveal of the selected section chip. The temporary capture harness was removed |
| `python scripts/check_resources.py` | 665 strings per locale; format parity and contrast pairs passed |
| Android lint (`:app:lintDebug`) | Zero errors; 94 advisory warnings, none in `feature/admin/` sources |
| `python scripts/check_module_boundaries.py` | Pure Kotlin modules remain free of platform/backend imports |

The English `admin_links` resource previously contained a literal `?` in place of a dash. It now reads "Therapist–patient links".

## Limitations

- The overview counts are server totals, but account filters and the link pickers only cover loaded directory pages. Use search or paste an ID for other accounts.
- The audit schema records which role row changed, not the role name, and records a link "update" without distinguishing revoke from restore. The feed labels these events generically.
- The open privacy request count is informational. Fulfilment remains the documented data-lifecycle procedure and is not done in the app.
- Physical-phone, TalkBack and Filipino wording review are deferred to the [post-implementation checklist](POST-IMPLEMENTATION-CHECKLIST.md).
