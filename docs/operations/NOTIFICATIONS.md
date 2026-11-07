# Booking notifications

A change to a booking writes an in-app notification, and each notification adds a row to a queue. The `notification-dispatch` Edge Function drains that queue through Gmail, and `pg_cron` calls it every minute. A booking only ever writes rows, so it never waits for Gmail and cannot fail because of it.

This covers booking email only. Sign-up and password email go through Supabase Auth, which `supabase/.env` and `scripts/configure_auth_email.py` configure.

## Hosted setup

Keep every value below out of Git and out of chat. Supabase blocks ports 25 and 587 from Edge Functions, so email uses port 465, which is why the port is its own setting.

1. Deploy the functions. Neither is called with a person's token, so both turn JWT checks off in `supabase/config.toml`.

   ```powershell
   supabase functions deploy notification-dispatch
   supabase functions deploy booking-calendar
   ```

2. Set the Edge secrets. Generate the shared secret yourself, for example with `openssl rand -hex 32`.

   ```powershell
   supabase secrets set SMTP_HOST=smtp.gmail.com NOTIFICATION_SMTP_PORT=465 SMTP_USER=you@gmail.com SMTP_PASS=your-app-password SMTP_FROM_EMAIL=you@gmail.com SMTP_SENDER_NAME=Motivance
   supabase secrets set NOTIFICATION_DISPATCH_SECRET=your-shared-secret PUBLIC_SITE_URL=https://your-web-app PUBLIC_FUNCTIONS_URL=https://your-project.supabase.co/functions/v1
   ```

3. Give the scheduled job the address and the same secret. Run this in the SQL editor. Until both exist, the job does nothing.

   ```sql
   select vault.create_secret('https://your-project.supabase.co/functions/v1/notification-dispatch', 'notification_dispatch_url');
   select vault.create_secret('your-shared-secret', 'notification_dispatch_secret');
   ```

4. Book a session and confirm it. The email should arrive within about a minute.

| Variable | Where | For |
| --- | --- | --- |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_EMAIL`, `SMTP_SENDER_NAME` | Edge secrets | The Gmail sender. `SMTP_PASS` is a Google App Password |
| `NOTIFICATION_SMTP_PORT` | Edge secrets | 465 hosted. Port 465 uses TLS from the start |
| `NOTIFICATION_DISPATCH_SECRET` | Edge secrets and Vault | Lets the scheduled job call the function |
| `PUBLIC_SITE_URL` | Edge secrets | The link back to the app |
| `PUBLIC_FUNCTIONS_URL` | Edge secrets | Where calendar links point |

## Push notifications

Push is built and waiting for credentials. With none set, the app builds and runs normally and does nothing push-related, and `notification-dispatch` marks each push `skipped` with the reason `FCM_SERVICE_ACCOUNT is not set`. Email and the in-app bell are unaffected.

To turn it on:

1. In the [Firebase console](https://console.firebase.google.com/), create a project, or use an existing one.
2. Add an Android app to it. The package name is `com.motivance`, and `com.motivance.debug` for a debug build, so add both if you test with a debug build.
3. Open Project settings, then the General tab, and copy four values from the Android app into `android/.env`. They are public client values, so they ship in the app. Do not download or commit `google-services.json`: the app does not use it.

   | Value in `android/.env` | Where it is in the console |
   | --- | --- |
   | `FIREBASE_PROJECT_ID` | Project ID |
   | `FIREBASE_APP_ID` | App ID, which starts with `1:` |
   | `FIREBASE_API_KEY` | Web API key |
   | `FIREBASE_SENDER_ID` | Cloud Messaging tab, Sender ID |

4. Rebuild and install the app. After sign-in it asks for permission to show notifications.
5. In Project settings, open Service accounts, and choose Generate new private key. Keep this file secret and out of Git. It is the only push secret, and it never goes in the app.
6. Give it to the Edge Functions, then redeploy the dispatcher.

   ```powershell
   supabase secrets set FCM_SERVICE_ACCOUNT="$(Get-Content -Raw path\to\service-account.json)"
   supabase functions deploy notification-dispatch
   ```

7. On a phone signed in as a patient, have a Scheduler confirm a session. The notification should arrive within about a minute. Then tick the real push check in [the follow-up checklist](../validation/POST-IMPLEMENTATION-CHECKLIST.md).

| Variable | Where | For |
| --- | --- | --- |
| `FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID`, `FIREBASE_API_KEY`, `FIREBASE_SENDER_ID` | `android/.env` | Public client values. All four are needed |
| `FCM_SERVICE_ACCOUNT` | Edge secrets | The service account's whole JSON file. A secret |
| `FCM_API_URL` | Edge secrets, tests only | Points the dispatcher at a stub. Leave it unset everywhere real |

A message carries data only, so the app builds the notification itself. A lock screen shows only that there is an update, because a message can name a patient. Signing out removes the phone's token, and FCM reporting a token dead removes it too. A person's phone is theirs alone: a token moves with each sign-in.

| Delivery status | Meaning |
| --- | --- |
| `skipped`, `FCM_SERVICE_ACCOUNT is not set` | Push is not turned on yet |
| `skipped`, `No device` | Nobody to reach: no phone registered, or the phone is gone. Not a failure |
| `pending`, with `FCM 503` or similar | FCM had a temporary problem, and it will try again |
| `failed` | Stopped after 5 attempts. Check the service account and the project ID |

If every push fails with `Could not get an FCM access token`, the service account is wrong or has been revoked. Check it first.

`python scripts/test_push.py` proves the request format, retries and removal of dead tokens against a stub on this machine. It never reaches Google, and it is not proof that a real phone receives anything.

## Testing locally

`python scripts/test_email.py` starts the functions, sends real email to local Mailpit, and removes what it created. It stops if the running function has any other mail server, so it cannot reach a real inbox. Read what it sent at <http://127.0.0.1:54324>.

Never start the functions locally with `supabase/.env`, because it holds the real Gmail sender.

## When something goes wrong

Each row in `notification_deliveries` records its attempts and last error.

```sql
select status, attempts, next_attempt_at, last_error from public.notification_deliveries order by created_at desc limit 20;
```

| Status | Meaning | What to do |
| --- | --- | --- |
| `pending` | Waiting, or waiting to retry | Nothing. Waits grow from 2 to 16 minutes |
| `skipped` | A push with nobody to reach, or with push not turned on | Nothing. See [Push notifications](#push-notifications) |
| `sending` | Claimed by a run | Nothing. A row claimed for over 5 minutes comes back by itself |
| `sent` | Handed to Gmail | Nothing |
| `failed` | Stopped after 5 attempts | Fix the cause, then set `status='pending'` and `attempts=0` to try again |

If everything stays `pending`, check that the job is running and the Vault secrets exist.

```sql
select * from cron.job_run_details order by start_time desc limit 5;
select name from vault.decrypted_secrets where name like 'notification_dispatch%';
```

A run that dies after Gmail accepts an email but before recording it will send that email again when the row comes back. A duplicate is the safer failure, because the alternative is a patient never hearing about a change.

## Scheduled jobs

| Job | Runs | Does |
| --- | --- | --- |
| `notification-dispatch` | Every minute | Calls the Edge Function, if there is anything to send |
| `booking-reminders` | Every 5 minutes | Reminds patients and therapists 24 hours and 1 hour before a confirmed session |
| `expire-booking-requests` | Every 15 minutes | Rejects pending requests whose time has passed, and tells the patient |

Reminders and expiry run inside the database, so they keep working with no Edge secrets. Without the Vault secrets above, their notifications still appear in both apps, and only the email waits.

To pause a job, for example during maintenance, use `cron.alter_job`. The `postgres` role cannot update `cron.job` directly.

```sql
select cron.alter_job((select jobid from cron.job where jobname='booking-reminders'), active := false);
```

## Calendar links

Confirmation and reschedule emails link to `booking-calendar` with the booking's long random token. A calendar app cannot sign in, so that token is the only key, and the file names no patient. Every version of a booking's file has the same `UID` and a higher `SEQUENCE`, so a calendar that supports updates replaces the entry instead of adding a second one.
