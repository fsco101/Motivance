# Verified sign-up and email logo

Date: 2026-11-08. This was reported by the owner directly, with no GitHub issue. This is engineering evidence from database, contract, browser and JVM tests on the local stack. No real inbox or phone check was run; those are in [POST-IMPLEMENTATION-CHECKLIST.md](POST-IMPLEMENTATION-CHECKLIST.md).

## The problem

Sign-up saved a person in Motivance before they had entered their email code. The cause was the `provision_patient` trigger: it ran `on_user_created()` after every insert into `auth.users`. Supabase Auth inserts that row as soon as someone signs up, so the trigger immediately wrote `profiles`, a `patient` role, `patients` and `patient_profiles`. An unverified person therefore appeared in the admin directory and held their username. Neither app was at fault, since both already waited for the code.

## The fix

Migration `202611080001_verified_signup.sql`:

- **At sign-up**, `on_user_created()` only checks the details. `check_signup_details` writes them and undoes the write, so a sign-up meets exactly the rules a saved profile meets, including table checks and the unique username. It also refuses a username held by another sign-up whose code still works. Nothing is kept.
- **When the code is entered**, Auth sets `email_confirmed_at`, and the new `provision_confirmed_account` trigger creates the profile, the patient role and the details through `provision_account`. Role claims in the metadata are still ignored. If someone took the username in the meantime, the code still works and Profile asks for the details. An account an administrator creates already confirmed is still provisioned at once.
- **Pending records:** Supabase Auth must keep its own pending record to check the code. The owner asked that it not be kept, so `delete_expired_signups()` runs every minute through pg_cron. It deletes a never-confirmed record once its latest code has expired, ten minutes after it was sent (`signup_code_lifetime()`). Invitations and unconfirmed accounts that already own records are left alone.
- **Existing unverified accounts:** at the owner's request, unconfirmed accounts created before this change keep their records. They can still confirm later.

Once a pending record is deleted, local Auth refused the old code (`403 otp_expired`), and still answered `200` to a resend request while sending nothing. This was found by a local probe that ran only after the record was confirmed deleted, so no mail could be sent. Because of this, the sign-up screens now say "if the code expires, sign up again". A wrong or expired code on sign-up shows its own message (`signup.codeExpired` on the web, `SIGNUP_CODE_EXPIRED` on Android). Password reset keeps its existing wording, because a new reset code does work.

## Email logo

Both templates show the logo beside the name in the navy header. It loads from `https://motivance.vercel.app/logo-96.png`, which returned `200 image/png` from the live site. Gmail blocks embedded images, so a public file is the only option. The image is 48 px, with empty alt text because the name sits beside it. The confirmation email now also says the account is created only after the code is entered, and to sign up again if the code expires, in English and Filipino. A screenshot of the rendered email was reviewed.

## Runs

The database test was written first and failed on the old trigger: 5 of its first 15 checks failed, the rest never ran, and the plan reported 30. The cases were "an unconfirmed sign-up has no account, role, patient or details" and "a username from an expired sign-up is free again". The template and code-lifetime tests failed before the templates and migration existed. The web and Android failure-message tests failed before their code existed. The web contract test was rewritten before the migration but first run after it.

- `supabase test db`: 99 checks in 5 files passed. This includes the 30 in `verified_signup.test.sql`. The other four files' fixtures now create confirmed users.
- Web: the sign-up contract test passed 5 of 5 against real local Auth. It shows `0,0,0,0` records after sign-up, and `1,1,1,1` with a single patient role after `verifyOtp`, and it refuses a username held by a pending sign-up. The full contract run passed 160 of 160. `signup.spec.ts` passed 7 of 7, including that a wrong code saves nothing. Typecheck, lint, 264 unit tests, build and `check_web_bundle.py` (296 KB of 300 KB) passed.
- Android: `AuthViewModelTest` passed 22 of 22. The CI set (`:core:assessment:test :core:domain:test :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug`) passed with 416 JVM tests and no lint errors. `check_resources.py` reported 935 strings per language with matching formats.
- `scripts/test_configure_auth_email.py` passed 12 of 12, including the logo and the check that `otp_expiry`, `mailer_otp_exp` and `signup_code_lifetime()` all equal ten minutes. `scripts/test_patient_profiles.py` passed, so profiles for confirmed accounts still save as before.

Not run: emulator tests (only a string and a notice mapping changed on Android), a real inbox, and a sign-up on the hosted project.

## Hosted project

On 2026-11-08, with the owner's approval, `db push --dry-run` listed only this migration for project `nlmpvelcycedhhcmtgmx`. `db push` then applied it, and `migration list` shows it on both sides. `configure_auth_email.py --target hosted --check-smtp --apply` installed the templates with the logo, and the read-back matched every submitted setting. No email was sent. The live database was not queried afterwards: a read-only count of its unverified accounts was blocked by this session's permissions. So the number of older unverified accounts left in place, and the cron job's first runs there, are unconfirmed. The deployed web app and the installed Android app show the new sign-up wording only after their next deployment and build.
