# Environment configuration

The only application environment file is **`android/.env`**. It is ignored by Git. Use `android/.env.example` as the safe template. Rebuild and reinstall the debug app after changing its URL/key: these values are compiled into the APK, not downloaded at runtime.

## Required values

| Variable | Value and source |
|---|---|
| `SUPABASE_URL` | Supabase project API URL. For the local laptop stack: `http://127.0.0.1:54321`. For hosted deployment: `https://YOUR_PROJECT.supabase.co`. |
| `ANDROID_SUPABASE_URL` | Optional Android-specific URL override. Emulator: `http://10.0.2.2:54321`. USB phone with ADB reverse: `http://127.0.0.1:54321`. Hosted: the same HTTPS project URL. |
| `SUPABASE_PUBLISHABLE_KEY` | Public **publishable/anon** API key for the same project. The local setup script obtains the local anon key automatically; hosted keys come from the project's API keys settings. The variable keeps its existing name for compatibility. |

```dotenv
# USB-connected phone; run adb reverse as described below.
SUPABASE_URL=http://127.0.0.1:54321
ANDROID_SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_ANON_OR_PUBLISHABLE_KEY
```

For the emulator, change only `ANDROID_SUPABASE_URL` to `http://10.0.2.2:54321`. For a hosted backend, use its HTTPS URL for both URL variables and its matching public key. The app's debug HTTP exception is restricted to local hosts on port 54321; a laptop LAN HTTP address will not pass the current transport rules.

Gradle resolves process environment before `android/local.properties`, then `android/.env`. `ANDROID_SUPABASE_URL` overrides `SUPABASE_URL` for the Android build. Remove obsolete URL/key entries from `local.properties` if they override the environment file unintentionally. A published APK's public key is not a secret; authorization is enforced by authenticated RPC checks and PostgreSQL RLS. See [Supabase API keys](https://supabase.com/docs/guides/api/api-keys).

## Local setup

From `C:\Motivance` with Docker running:

```powershell
npx --yes supabase@2.20.12 start
npx --yes supabase@2.20.12 migration up --local
python scripts/setup_local_env.py
python scripts/seed_local_accounts.py --with-prescription
```

The environment generator defaults to the emulator URL. For a USB phone, edit its override as shown above, connect/authorize USB debugging, and run:

```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adb devices
& $adb -d reverse tcp:54321 tcp:54321
```

Repeat the reverse command after reconnecting/restarting the phone. Docker and the local Supabase services must remain running for online operations. Cached assignments can be performed offline for 24 hours after download; pending results synchronize once a connection and valid sign-in are available.

## Values that do not belong in Android .env

- **Patient/therapist email and password:** enter them in the app. Local generated credentials are in ignored `docs/operations/local-test-accounts.json`; they are not BuildConfig fields.
- **Service-role/secret API key, database password/connection string:** trusted backend/administrator tools only. The local seed and integration scripts obtain the local service key in memory through the CLI and refuse nonlocal endpoints. They do not save that key in Android configuration.
- **SMTP credentials:** server/operator configuration belongs in ignored `supabase/.env`, using `supabase/.env.example`, or hosted Auth settings. See [verification/reset and SMTP setup](AUTH-EMAIL.md). The default local stack captures email at port 54324.
- **Signing passwords/keystore:** separate protected release tooling, never an app BuildConfig value.
- **Access/refresh tokens:** managed at runtime in an Android Keystore-encrypted, backup-excluded session file; the user does not add these to `.env`.

Sprints 2 and 3 need no cloud GPU, pose API key, Firebase credentials, Redis password, or additional upload-service key. Inference remains on the device; authenticated uploads use the same Supabase project and public client configuration.
