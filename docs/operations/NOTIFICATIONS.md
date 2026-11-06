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
| `sending` | Claimed by a run | Nothing. A row claimed for over 5 minutes comes back by itself |
| `sent` | Handed to Gmail | Nothing |
| `failed` | Stopped after 5 attempts | Fix the cause, then set `status='pending'` and `attempts=0` to try again |

If everything stays `pending`, check that the job is running and the Vault secrets exist.

```sql
select * from cron.job_run_details order by start_time desc limit 5;
select name from vault.decrypted_secrets where name like 'notification_dispatch%';
```

A run that dies after Gmail accepts an email but before recording it will send that email again when the row comes back. A duplicate is the safer failure, because the alternative is a patient never hearing about a change.

## Calendar links

Confirmation and reschedule emails link to `booking-calendar` with the booking's long random token. A calendar app cannot sign in, so that token is the only key, and the file names no patient. Every version of a booking's file has the same `UID` and a higher `SEQUENCE`, so a calendar that supports updates replaces the entry instead of adding a second one.
