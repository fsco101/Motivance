# Verification, password reset and SMTP

Registration uses Supabase email/password authentication. Gmail and other email addresses can register. This verifies email ownership; Google social sign-in is separate. The Android app never connects to Gmail SMTP directly.

After signup, enter the six-digit confirmation code in the app. Unconfirmed sign-in opens the confirmation form; **Send a new code** requests another signup email. **Forgot password** requests a recovery code; enter it with a new password to finish resetting. Recovery verifies the code before submitting the password change. Invalid/expired codes, rate limits and password-policy failures have English and Filipino messages. Request a fresh code if a password update failed after consuming a recovery code.

Sign-up saves nothing to Motivance's own tables until the code is entered. Supabase Auth keeps a pending record (email, password hash, code and the entered details) so it can check the code. When the code is entered, the database creates the profile, the patient role and the details. Sign-up still refuses invalid details, and refuses a username used by an account or by a sign-up still waiting for its code. A job runs every minute and deletes a pending record once its latest code has expired, ten minutes after it was sent. A new code requested within that time keeps the record for another ten minutes. Once the record is deleted, Auth still answers a resend request with success but sends nothing, so the sign-up screens ask the person to sign up again. Unconfirmed accounts created before 2026-11-08 already had records; at the owner's request they are left as they are. The ten minutes are set in three places, which must agree: `otp_expiry` in `supabase/config.toml`, `mailer_otp_exp` in the setup script and `signup_code_lifetime()` in the migration. `scripts/test_configure_auth_email.py` checks that they do.

Both emails show the logo from `https://motivance.vercel.app/logo-96.png`, which is `web/public/logo-96.png` on the deployed site. Gmail blocks embedded images, so the logo has to be a public HTTPS file. It disappears from emails if the site stops serving that file. Its alt text is empty because the name is written beside it.

## Current environment

The checked-in local configuration requires confirmation, uses six-digit codes valid for ten minutes, and captures email at `http://127.0.0.1:54324`. It does **not** deliver to Gmail. The one-second local send interval is for isolated capture tests; the real SMTP profile uses 60 seconds. Provider quotas and Supabase email rate limits apply separately.

The current local Docker Auth instance has been configured with the sender credentials in ignored `supabase/.env`. Gmail TLS authentication and runtime configuration checks passed on 2026-11-01; no message was sent and inbox delivery remains pending. The tracked default is still local capture: reapply the SMTP profile after an ordinary stack restart. Hosted SMTP deployment is separate. See [connection evidence](../validation/smtp-connection-results.json).

## Configure a sender

1. For a Gmail sender, enable Google 2-Step Verification and create an **App Password**, if permitted by the account. Use that instead of the normal account password. See [Google App Passwords](https://support.google.com/mail/answer/185833?hl=en).
2. Copy `supabase/.env.example` to ignored `supabase/.env` if absent. Fill it locally in an editor. Keep credentials out of chat, Git, screenshots and `android/.env`.
3. Set `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER` and `SMTP_FROM_EMAIL` to the same full Gmail address, and `SMTP_PASS` to the App Password. Port 587 uses STARTTLS; port 465 uses implicit TLS. See [Google SMTP settings](https://developers.google.com/workspace/gmail/imap/imap-smtp).
4. For hosted setup, also fill `SUPABASE_PROJECT_REF`, a personal access token in `SUPABASE_ACCESS_TOKEN`, and `PUBLIC_SITE_URL`, the deployed HTTPS web address that becomes Auth's Site URL. The token is an operator credential, never mobile configuration. Alternatively configure the same values and templates directly in the project's Auth settings using [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

The script also supports a domain email provider's TLS SMTP credentials. Choose a sender/provider appropriate for deployment volume. No subscription is purchased by setup.

From the repository root, preview without network requests:

```powershell
python scripts/configure_auth_email.py --target hosted
```

Check TLS/authentication without sending a message (this does not require a hosted project):

```powershell
python scripts/configure_auth_email.py --target local --check-smtp
```

Apply to the selected hosted project:

```powershell
python scripts/configure_auth_email.py --target hosted --check-smtp --apply
```

Hosted setup enables email signup, requires confirmation, installs both code templates, sets the Site URL from `PUBLIC_SITE_URL` and reads back nonsecret settings. It refuses a missing or non-HTTPS address, so the `http://localhost:3000` default can never be applied. Other Auth configuration is preserved. Passwords, tokens and raw CLI/API responses are withheld from output. Read-back verifies configuration, not inbox delivery. Review the project reference before applying. The script uses the official [Auth configuration API](https://supabase.com/docs/reference/api/v1-update-auth-service-config).

For local Docker with real mail delivery:

```powershell
python scripts/configure_auth_email.py --target local --check-smtp --apply
```

Local setup stops/starts the stack without resetting its database. It temporarily supplies an SMTP profile through environment references, then restores `supabase/config.toml`. Running containers retain the applied settings; a subsequent ordinary start uses the tracked capture profile. Rerun setup after restarting if real local mail is needed. If startup fails, the config is restored; `npx --yes supabase@2.20.12 start` starts the capture profile. Never use `db reset` for an email configuration change.

## Hosted project state

On 2026-11-08 the setup was applied to the hosted project, for issue #94. Before that, the project still had Supabase's defaults: link templates without `{{ .Token }}`, 8-digit codes valid for an hour and no custom SMTP. Sign-up therefore emailed a link while both apps waited for a code. The read-back after applying shows both templates with the code, 6-digit codes valid for 10 minutes, Gmail SMTP on port 587 and Site URL `https://motivance.vercel.app`. No message was sent, so inbox delivery is still untested.

Later on 2026-11-08 the templates with the logo were applied the same way and read back, and migration `202611080001_verified_signup.sql` was pushed, so the hosted project also creates accounts only after the code. See [VERIFIED-SIGNUP.md](../validation/VERIFIED-SIGNUP.md).

The hosted email rate limit, `rate_limit_email_sent`, is still Supabase's default of 2 per hour for the whole project. The script does not change it. Raise it under Auth rate limits before more than a couple of people sign up or reset a password in the same hour, within what the sender allows.

## Delivery acceptance

Use an inbox you own or have permission to test. Register through Android, check Inbox and Spam/Junk, confirm the code, sign out, request a reset, and verify that the old password fails and the new password succeeds. Check resend, invalid/expired codes and throttling. Setup and unit tests do not contact any recipient.

`python scripts/test_local_auth.py` creates synthetic `example.test` accounts, reads captured local mail and cleans up its own accounts. It refuses real SMTP. Restart the capture profile before running it. Do not run synthetic email suites against hosted services or a real sender.

Hosted deliverability, rate limits and physical-device checks remain in [the follow-up checklist](../validation/POST-IMPLEMENTATION-CHECKLIST.md). When moving to hosted Auth, update `android/.env` to the same HTTPS project and matching public key, then rebuild. SMTP-only changes need no APK rebuild.
