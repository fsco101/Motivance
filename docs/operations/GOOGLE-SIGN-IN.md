# Google sign-in

Patients and staff can sign in with their Google account on the web, alongside email and password (#166-#170). Google is one more way to prove who someone is. It never creates staff and never skips a consent.

> **Android's button is hidden for now** (owner's instruction, 2026-11-23), until the Android OAuth clients exist. Everything behind it is built and tested. To show it, set `GOOGLE_SIGN_IN_ON_ANDROID = true` in `android/app/src/main/java/com/motivance/feature/auth/GoogleSignIn.kt`, create the Android clients below, fill `GOOGLE_WEB_CLIENT_ID` in `android/.env`, and rebuild. While it is hidden, a Google-created account can still use the Android app: after setting a password in Profile on the web, it signs in with email and password, and Android's Profile and finish-profile screen behave as described here.

## How it works

| | Web | Android |
|---|---|---|
| What the person taps | **Continue with Google**, below the password form on `/sign-in` | **Continue with Google**, below the password form on the sign-in screen |
| What happens | `supabase.auth.signInWithOAuth({ provider: 'google' })` with PKCE. Auth sends the browser to Google, Google back to Auth, and Auth to `/auth/callback?code=…`, which exchanges the code for a session in this browser | Credential Manager shows Google's account picker (`GetSignInWithGoogleOption`) with the Web client ID as the server client ID and a fresh nonce. The ID token goes to `/auth/v1/token?grant_type=id_token` with the raw nonce |
| Which Google client | The **Web** client, with its secret held by Supabase Auth | The **Android** client is matched by Google from the package name and signing key. The token it returns is issued for the **Web** client ID |
| After sign-in | The session is stored like a password sign-in | The session is stored in the same encrypted vault as a password sign-in, so token renewal, the offline start (#160) and push registration work unchanged |
| Signing out | Ends this browser's session. Google always asks which account (`prompt=select_account`) | Also clears Credential Manager's state, so on a shared phone the next person chooses their own account |

Both apps have one sign-in page for every role, so there is no separate staff page. An account lands on its own workspace exactly as after a password sign-in.

### What a Google sign-in may create and link

These rules hold on the server, so both apps follow them. `scripts/test_google_sign_in.py` checks each one on the local stack.

- **An existing account with the same verified email.** Auth adds the Google identity to that account. It keeps its roles, patients, plans, sessions and messages, and no second account appears.
- **A new email.** The account is confirmed by Google, so `on_user_created` provisions it at once through `provision_account`: the patient role and nothing else. Role claims are ignored, so Google can never create staff.
- **A new patient finishes their profile before Home.** Google gives no username or patient details. `my_sign_in()` reports `profile_required` for a patient (with no staff role) who has a Google identity and no patient profile. Both apps then show *Finish setting up your account*, with the same form and privacy agreement as an email sign-up, and open Home once it is saved.
- **A pending email sign-up confirmed by Google** keeps none of the form's details or agreement, because whoever filled the form may not be the person proving the address. The person finishes their own profile (migration `202611230001_google_sign_in.sql`).
- **Cleanup.** `delete_expired_signups()` removes only never-confirmed sign-ups. A Google account is confirmed from the start, so it is never removed.
- **Google-only accounts have no password.** Profile does not offer *Change password* to them. It says they sign in with Google and offers *Set a password*, which asks only for the new one. The sign-in email cannot be changed in either app, for any account.
- **Consents are unchanged.** The privacy agreement is part of finishing the profile. The messages agreement, video consent and movement-summary consent are asked at the same moments as today.
- **Administrators** see the same account view as before. Showing how a person signs in is not part of this change; if it is added, it ships to both apps and is recorded in [ADMIN-PARITY.md](../architecture/ADMIN-PARITY.md).

## Owner steps in the Google Cloud console

These need the owner's Google account, so an agent does not do them.

1. **Create or choose a project** at <https://console.cloud.google.com/>.
2. **OAuth consent screen** (Google Auth Platform → Branding):
   - App name **Motivance**, a support email, and the logo `web/public/logo-256.png`.
   - App home page and privacy policy: `https://motivance.vercel.app`.
   - Authorised domains: `motivance.vercel.app` and `nlmpvelcycedhhcmtgmx.supabase.co`. Not `vercel.app` or `supabase.co`: both are public suffixes, so Google refuses them as "must be a top private domain".
   - Data access (scopes): `openid`, `.../auth/userinfo.email` and `.../auth/userinfo.profile` only.
   - Audience: while the app is in **Testing**, only the listed test users can sign in. Add each tester's Google address. Publishing the app removes that limit.
3. **Web client** (Clients → Create client → Web application), named for example *Motivance web*:
   - Authorised JavaScript origins: `https://motivance.vercel.app` and `http://localhost:3000`.
   - Authorised redirect URIs: `https://nlmpvelcycedhhcmtgmx.supabase.co/auth/v1/callback` and `http://127.0.0.1:54321/auth/v1/callback`.
   - Copy the **client ID** and the **client secret**.
4. **Android clients** (Clients → Create client → Android), one for each app:
   - `com.motivance` with the SHA-1 of the release signing key.
   - `com.motivance.debug` with the SHA-1 of the debug keystore. Print it with `keytool -list -v -keystore "%USERPROFILE%\.android\debug.keystore" -alias androiddebugkey -storepass android -keypass android`.
   - Android clients have no secret, and their IDs are not entered anywhere. Google matches the app by package name and SHA-1, then issues the token for the Web client ID.

## Values and where they live

| Value | Where | Secret? |
|---|---|---|
| `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` | ignored `supabase/.env` (local stack and the hosted script) | No |
| `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` | ignored `supabase/.env`, and Supabase Auth on the hosted project | **Yes.** Never in an app, `web/.env`, `android/.env` or Git |
| `GOOGLE_WEB_CLIENT_ID` | ignored `android/.env`, compiled into BuildConfig | No. The same Web client ID |

The web app needs no new value. It asks Supabase Auth, which holds the secret. Until `GOOGLE_WEB_CLIENT_ID` is set, Android's button says Google sign-in is not set up in this version of the app.

## Local stack

1. Fill both `SUPABASE_AUTH_EXTERNAL_GOOGLE_*` values in `supabase/.env`.
2. Restart the stack so Auth reads them. This keeps data; do not reset.
   ```powershell
   npx --yes supabase@2.20.12 stop
   npx --yes supabase@2.20.12 start
   ```
3. Read back what Auth loaded:
   ```powershell
   python scripts/configure_google_sign_in.py --target local
   ```
   It prints whether Google is on, the client ID, the nonce check and the redirect list, and checks only that the secret is present.
4. For Android, add `GOOGLE_WEB_CLIENT_ID` to `android/.env` and rebuild.

`supabase/config.toml` enables `[auth.external.google]` with the client ID and secret read from `env(...)`, leaves `skip_nonce_check = false`, and allows redirects back to `http://localhost:3000/**` and `http://127.0.0.1:3000/**`. Without the values, Google stays on but cannot complete a sign-in. Email and password work as before.

## Hosted project

Apply only on the owner's instruction.

```powershell
python scripts/configure_google_sign_in.py --target hosted          # reads the hosted settings, shows the change
python scripts/configure_google_sign_in.py --target hosted --apply  # sets them, then reads them back
```

It needs `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`, `PUBLIC_SITE_URL` and both Google values in `supabase/.env`. It turns the Google provider on with the Web client ID and secret, keeps the nonce check on, and adds `https://motivance.vercel.app/**` to the redirect allow-list without removing anything already there. The read-back fails loudly if any of these differ. The secret and the access token are never printed.

The web button reaches the live site only after a Vercel redeploy, which also waits for the owner's instruction.

## Checking it

| Check | How |
|---|---|
| Hosted and local settings | `configure_google_sign_in.py` read-back, above |
| Account rules | `python scripts/test_google_sign_in.py` on the local stack |
| Script | `python -m unittest discover -s scripts -p test_configure_google_sign_in.py` |
| Web | `npx playwright test tests/e2e/google-sign-in.spec.ts --workers=1` in `web/`. Auth's two Google steps are stubbed, so the test never reaches Google and sends no email |
| Android | `GoogleSignInTest` and `SupabaseAuthRepositoryTest` unit tests; `AuthScreenTest.googleButtonStatesAtTwiceTheFontSizeInFilipino` on an emulator |
| Real Google accounts | [POST-IMPLEMENTATION-CHECKLIST.md](../validation/POST-IMPLEMENTATION-CHECKLIST.md#google-sign-in-166-170-2026-11-23). Auth checks Google's own signature, so no automated test can make a real token |

## When it goes wrong

| What the person sees | Likely cause |
|---|---|
| Google shows *Error 400: redirect_uri_mismatch* | The Supabase callback is missing from the Web client's redirect URIs |
| Google shows *Access blocked: this app's request is invalid* or *has not completed the Google verification process* | The consent screen is in Testing and the account is not a listed test user |
| Android: *Google sign-in is not available on this phone* | Google Play services is missing or old, or no Android client matches the package name and SHA-1 (a debug build needs the debug keystore's SHA-1) |
| Android: *Google could not confirm this account* | Auth refused the token: the client ID in `supabase/.env` or the hosted settings is not the Web client the app used, or the nonce check failed |
| Web: *Google could not confirm this account* | The client secret in Supabase does not match the Web client |
| Web: *That Google sign-in was started in another tab or has expired* | The browser lost the PKCE verifier (another tab, cleared storage, or a slow return). Start again from sign-in |
| Web: back on sign-in after Google, with no session | The site's address is missing from Auth's redirect allow-list, so Auth sent the person to the Site URL instead |
