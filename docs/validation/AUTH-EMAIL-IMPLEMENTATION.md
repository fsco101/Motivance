# Auth email implementation evidence

Date: 2026-11-01. Reviewer: Codex engineering review. Scope: enhancement to completed MOT-04, plus SMTP configuration tooling; this does not complete hosted deployment or establish real inbox delivery.

The existing Supabase signup and recovery flow now includes confirmation resend, an unconfirmed-sign-in path to the confirmation form, recovery resend without submitting a password, and English/Filipino notices for invalid/expired codes, email rate limits and password-policy failures. Only allowlisted backend error identifiers leave the HTTP adapter; raw provider response details are discarded. The recovery adapter verifies a code before submitting a new password and cannot submit a password when verification fails.

Both email templates now use Motivance styling and bilingual explanations. Codes are entered in the app, so no link callback or Google OAuth provider is needed. The local Auth service was restarted without a database reset; inspection confirmed confirmation required, six-digit codes, 600-second expiry and local capture on port 1025.

`scripts/configure_auth_email.py` previews configuration by default, optionally checks SMTP TLS/authentication without sending mail, and can apply local or hosted settings. Hosted application reads back nonsecret settings. Local restart restores the original tracked config even after a normal startup failure. Credentials use ignored backend `supabase/.env`, separate from Android public configuration. Synthetic auth regressions refuse a real SMTP profile.

## Executed checks

- Android `:app:testDebugUnitTest :core:domain:test`: 57 tests passed (49 app, 8 domain), no failures/errors/skips. New tests cover resend, safe error mapping/redaction and rejection before password mutation.
- `:app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug`: passed. This produces debug artifacts, not a signed production release.
- Focused `AuthScreenTest` on the Pixel 6 Android 15 emulator: 8 tests passed, including confirmation resend following an unconfirmed sign-in and reset resend excluding the password/old code.
- `python scripts/test_local_auth.py`: 31 checks passed against the running local Supabase stack and captured mail. Includes confirmation resend, wrong/consumed signup and recovery codes, new-password acceptance, old-password rejection, session refresh/logout and existing role/RLS regressions. Only this run's synthetic accounts were cleaned up.
- `python -m unittest discover -s scripts -p test_configure_auth_email.py -v`: 7 tests passed. Covers preview without network/mutations, missing settings, Gmail sender validation, code templates, startup rollback, credential redaction and hosted read-back mismatch. These tests mock provider and management requests.

Machine counts are recorded in [auth-email-test-results.json](auth-email-test-results.json), and live local backend details in [local-auth-results.json](local-auth-results.json). Gradle's full XML/HTML reports remain under ignored Android build folders.

## Pending checks and external setup

After the sender credentials were supplied locally, they were moved from `android/.env` into ignored backend `supabase/.env`. Gmail TLS and authentication on port 587 passed. The real SMTP profile was applied to the existing local Docker stack without a database reset. Runtime checks confirmed host, port, user, password and sender match the backend configuration, with confirmation still required and six-digit/600-second codes. Credential values were compared in memory and are absent from evidence. See [SMTP connection results](smtp-connection-results.json). The tracked capture configuration was restored; reapply the SMTP profile after an ordinary restart.

No real recipient was contacted. Hosted configuration application/read-back, real Gmail inbox delivery, actual code-expiry timing, real-provider throttling and physical-device transport remain unexecuted. Unit tests cover expiry/rate-limit feedback without claiming those provider checks passed. The earlier 31 backend checks used local capture before the real SMTP profile was applied; do not rerun synthetic email suites while real SMTP is active.

Use [the SMTP setup procedure](../operations/AUTH-EMAIL.md) when reapplying the local profile or separately configuring a hosted project. Real inbox and physical-device acceptance remain unchecked in [POST-IMPLEMENTATION-CHECKLIST.md](POST-IMPLEMENTATION-CHECKLIST.md). S5 deployment work remains open. Changes remain local for the user's commit/push workflow.
