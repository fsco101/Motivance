# Care chat rollout

How to ship the care chat epic (#113) to the hosted project and to phones, and what to watch afterwards. Every hosted step is applied only with the owner's approval. What ran and what did not is in [CARE-CHAT.md](../validation/CARE-CHAT.md).

## State on 2026-11-16

| Part | Hosted | Still to do |
| --- | --- | --- |
| Migrations `202611150001` to `202611150005` (conversations, agreement, media, notifications, cards and scheduling) | Applied 2026-11-15 and read back | — |
| `202611150006_chat_list_speed.sql` (faster conversation list, from the load check) | Applied 2026-11-16 on the owner's instruction and read back | — |
| `notification-dispatch` Edge Function | Old words for chat | Redeploy so a chat push says "New message from …" and carries the conversation |
| Web app | Not redeployed | Redeploy; until then the live site has no Messages page |
| Photo and video cleanup | Not scheduled | Schedule daily (below) |
| Android | No release with chat | Build and release (below) |
| Push to phones | No Firebase project yet | See [NOTIFICATIONS.md](NOTIFICATIONS.md) |

## Order

Do these in order. Each one is safe on its own, because the earlier parts never depend on the later ones.

1. **Database.** `npx supabase@2.20.12 db push --dry-run`, check that only the expected files are listed, then `db push`, then `migration list --linked` to read them back. The migrations only add things; none rewrites or removes existing data.
2. **Edge Function.** `supabase functions deploy notification-dispatch`, so chat pushes use the words in `_shared/push_text.ts` in the reader's language.
3. **Web.** Redeploy the site. The landing page's privacy line and the sign-up agreement change with it.
4. **Cleanup.** Schedule `python scripts/cleanup_chat_media.py --target hosted --apply` daily, with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set in the operator's scheduled task, never in an app. Only Storage's own API can remove a file, so the database cannot do this by itself. Until it runs, expired files stop being shown but still take space. `--usage` prints what is stored.
5. **Android.** Raise `versionCode` (now 3) and `versionName` in `android/app/build.gradle.kts`, build a release, and send it to patients and therapists before announcing chat. The new build has chat, its notifications, cards, scheduled messages and session videos.
6. **Announce.** Tell therapists that chat is not monitored around the clock, and that patients see the same warning in the agreement.

## Hosted settings to check

- **Realtime.** The first migration adds `chat_messages` and `chat_reads` to the `supabase_realtime` publication. In the dashboard, Database → Publications should list both. Realtime enforces the tables' row-level security, so each person receives only the rows they could read. No other Realtime setting is needed.
- **Storage.** The bucket `chat-media` is private, with a 6 MB file limit and only `image/jpeg`, `image/webp`, `video/mp4` and `video/webm`. The project-wide upload limit (Storage settings) must be at least 6 MB; the default is larger. Files are reached only through signed links that last minutes.
- **Scheduled jobs.** `send-scheduled-messages` runs every minute; check it in `cron.job` after the push. To pause it, use `cron.alter_job(..., active := false)` as for the other jobs.

## Storage limits and cost

The server enforces the limits, whatever an app sends:

- **Photos:** at most 1600 px and 1 MB.
- **Videos:** at most 480p, 30 seconds and 6 MB, and 20 per conversation in 30 days.
- **Messages:** 30 a minute per person.

Every file is removed 15 days after it is sent.

So one conversation holds at most about 10 videos at a time (20 in 30 days, each kept 15 days), around 60 MB, plus photos. As a worst case, 16 conversations at the video limit fill 1 GB. Real use should be far below that. Phones keep their own copy of what they have shown, so a person watching a video again does not download it again.

Check current Supabase prices and plan limits before relying on these numbers; they change over time. Watch `cleanup_chat_media.py --usage` weekly at first. If storage grows faster than expected, the limits are in `202611150003_chat_media.sql` and can be lowered by a migration.

Session videos (#114) are never stored on the server unless a patient sends one in chat, and then they follow the same rules.

## Older Android builds

A phone that keeps a build from before chat (`versionCode` 3 or older):

- **No chat:** it has no chat screens, so it cannot read or send messages. The patient can still turn on chat and use it on the web.
- **Bell:** it leaves a new-message notification out of its list, because it does not know that kind. The bell's unread number, which comes from the server, still counts it until the patient uses Mark all as read, or reads the conversation on the web.
- **Push:** a push for a new message arrives on the bookings channel with the server's words. Tapping it opens the app, not the conversation.

Releasing the new build before announcing chat avoids all of this.

## Pausing or rolling back

- **Stop sending:** `revoke execute on function public.send_message(uuid,uuid,text), public.send_attachment(uuid,text), public.share_progress(uuid,uuid,jsonb,text), public.share_exercise(uuid,uuid,uuid,text), public.schedule_message(uuid,uuid,text,timestamptz) from authenticated;` then pause `send-scheduled-messages`. Reading keeps working, so nothing already said disappears. Granting execute again restores it.
- **Stop new files only:** `revoke execute on function public.start_attachment(uuid,uuid,text,text,integer,integer,integer) from authenticated;`
- **Do not drop the tables.** Messages are part of the patient's record. Remove a person's chat only through the reviewed export and deletion workflow (`export_patient_chat`, `erase_patient_chat`).

## After rollout

Run these on hosted with real accounts, and record each one in [POST-IMPLEMENTATION-CHECKLIST.md](../validation/POST-IMPLEMENTATION-CHECKLIST.md):

- A therapist and a patient exchange a message on the web and on a phone, and each arrives without refreshing.
- A photo and a video can be sent and viewed.
- The cleanup removes a file older than 15 days.
- A push arrives with the conversation's name and opens that conversation.
- A scheduled message arrives at its time.
