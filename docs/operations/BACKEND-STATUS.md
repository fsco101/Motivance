# Backend status on the administrator overview

The administrator overview, in both apps, opens with how the backend is doing (migration `202611170002_admin_backend_status.sql`, function `admin_backend()`). Below it come the attention items, then the cards that open each section, then recent activity.

## What it shows

| Part | Source | When it asks for a look |
| --- | --- | --- |
| **Database**, used against the plan's limit, with what remains | `pg_database_size` of the project database | Amber at 75% used, red at 90%, with the words "Getting full" or "Nearly full" |
| **File storage**, used against the plan's limit, with what remains | Sizes of every file in Storage (`storage.objects`) | Same thresholds |
| **Largest tables**, the six biggest, indexes included | `pg_total_relation_size` of each `public` table | – |
| **Files by bucket**: profile photos and chat photos and videos | `storage.objects` by bucket | – |
| **Scheduled jobs**, how many ran without failing | `pg_cron` run history: a job fails when its last run failed or any run failed in the last day | Red, naming the failing jobs. If the scheduler cannot be read, amber with "could not be read" |
| **Notifications waiting** to be sent, and the oldest | `notification_deliveries` that are pending or sending | Amber when the oldest has waited over 15 minutes: the sender has probably stopped |
| **Failed notifications**, last 7 days | `notification_deliveries` that failed | Amber when any failed |
| **Notifications sent**, last 24 hours | `notification_deliveries` that were sent | – |
| **Signed in this week**, and new accounts | `auth.users` | – |
| **Phones for push** | `device_tokens` | – |
| **Last 14 days**: exercise sessions, chat messages, bookings made, new accounts, each day | Each table's own timestamps, counted in the center's time zone (`center_settings.time_zone`) | – |

Each daily series has its own chart and scale, because their sizes differ too much to share one axis. On the web, pointing at a day or moving along with the arrow keys names that day's count, and "Show as a table" lists every number. On Android, TalkBack reads each chart's total and every day.

Only sizes and counts leave the function; no names, messages or file paths. It refuses anyone who is not an active administrator. If it fails, the rest of the overview still loads and the section says the status could not be read.

## Plan limits

Supabase does not tell the database which plan the project is on, so the limits live in the one-row table `public.backend_plan`, seeded with the Free plan: 500 MB of database and 1 GB of file storage, counted in binary units as the Supabase dashboard does. When the project moves to another plan, update the row with the new plan's limits, for example for Pro:

```sql
update public.backend_plan set name='Supabase Pro', database_bytes=8::bigint*1024*1024*1024, storage_bytes=100::bigint*1024*1024*1024, updated_at=now();
```

Run it in the Supabase SQL editor or with `psql`. The apps read the new limits on their next refresh. Nothing else changes.

## Keeping space free

- File storage is mostly chat photos and videos. `scripts/cleanup_chat_media.py --apply` removes them 15 days after sending, and `scripts/cleanup_profile_photos.py --apply` removes replaced profile photos. Both need scheduling on the hosted project.
- The largest tables are normally session measurements and audit history. Retention is described in [DATA-LIFECYCLE.md](DATA-LIFECYCLE.md).

## Verification

- Web: `npm test` (`features/admin/backend.test.ts`) and `npm run test:contract` (`tests/contract/admin.test.ts`, against the real local stack: plan limits, sizes, buckets, 14 days in the center's time zone, jobs, and refusal for non-administrators).
- Android: `AdministrationRepositoryTest` (reading the status, and the overview still loading when it fails) and `BackendStatusTest` (sizes, thresholds and failing jobs, with the same cases as the web).
