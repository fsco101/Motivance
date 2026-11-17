# Development data lifecycle and request handling

S3 implements consent history, a privacy-request queue, access revocation and auditable prescription changes. This document defines the current development policy and the trusted operator's follow-up procedure; the application does not silently delete immutable history.

## Consent and local storage

Before creating a prescribed session checkpoint the app records an owner-scoped `movement-summary-v1` grant event in Room. Camera permission alone authorizes no persisted rehabilitation summary. The session pins that grant UUID; WorkManager uploads the event before its dependent session. Offline events retain their original timestamps and retry with the same UUID. Grant/withdrawal events append history, never rewrite it.

Withdrawal stops new collection under the prior grant. A new session needs a new explicit grant; server ingestion rejects sessions extending past a withdrawal under the old grant. Records completed before withdrawal remain available to their patient. The UI offers export/deletion requests independently of camera permission and consent withdrawal.

No app feature stores raw camera frames or per-frame pose sequences, and nothing records video unless the patient turns on Record this session (below). SQLite holds aggregate results, versioned targets, instructions and consent/outbox state. Device backup/transfer is excluded. Sign-out deletes the encrypted token file and prescription cache, interrupts drafts and retains owner-scoped results/outbox so an unsent result is not silently lost. A different account cannot upload those records. Keystore protects tokens; Room aggregate data is app-private but not encrypted by Room.

## Session videos (#114)

A patient can turn on **Record this session** before an exercise. It is off for every session until they turn it on. The first time, the app asks for its own agreement, `session-video-v1`, separate from the movement-summary consent and kept on the phone only (`SessionVideoStore`, per account). The agreement says what the video shows, that it is saved only on the phone, that a phone which backs up its gallery to a cloud photo service may back it up too, that it reaches the therapist only if the patient sends it in chat, and that signing out does not remove it.

| Data | Where | How long it stays |
| --- | --- | --- |
| The video: the camera picture with the skeleton and the measured angle drawn on it, as the patient saw it | The phone's gallery, in a Motivance album (`Movies/Motivance`) | Until the patient deletes it, from the session's result or from the gallery. Signing out leaves it, because it is the patient's own file. Motivance uploads a copy only when the patient shares that one video with their therapist (below) |
| The working copy while recording | The app's cache, `session-video/` | Removed once the video is in the gallery, or at once when nothing was recorded |
| Which video belongs to which sessions, and the agreement | The app's own preferences, per account | Kept across sign-out; a pointer only, never the video |
| A copy the patient sends in a conversation | As for any chat video: made smaller first, `chat-media`, removed 15 days after sending | The phone's gallery copy is not affected |
| A copy shared with the therapist (#129) | Made smaller on the phone (480p, about 500 kbps, the first five minutes), then the private bucket `session-videos`, with a row in `session_videos` | 15 days from sharing, or at once when the patient stops sharing. After that no link is issued, and `scripts/cleanup_chat_media.py` removes the file. The phone's gallery copy is not affected |

Before Android 10 the gallery is a shared folder, so the app asks for the storage permission (declared only up to Android 9) when recording is turned on there.

**Sharing a session video with the therapist (#129).** Nothing leaves the phone until the patient chooses, for one session, "Let my therapist see it". The app then says what happens, before anything is sent: a smaller copy goes to the therapist whose exercise it was, who can watch it for 15 days, after which it is deleted from the server. The phone's copy stays, and the patient can stop sharing at any time from the result or from their history, on Android or the web. Only the patient and that therapist, while their link is active, can read the row or get a link to the file; another therapist, a Scheduler and an administrator cannot. A link to watch lasts five minutes. Uploads are limited to five an hour per patient, 20 MB per video and 200 KB per still, all enforced by the server. An upload never shared within an hour is removed like an expired one.

## Retention policy

A sign-up that never enters its email code leaves no Motivance record. Supabase Auth's pending record, which holds the email, password hash, code and entered details, is deleted when the code expires ten minutes after it was last sent. Unconfirmed accounts created before 2026-11-08 kept their records, at the owner's request. See [AUTH-EMAIL.md](AUTH-EMAIL.md).

Detailed profiles use a separate `system-purpose-v1` agreement explaining account management, rehabilitation tracking and connected-therapist profiling. Explicit consent is required before writing demographics; the server records its version/time and preserves them during edits. This is separate from movement-summary grants/withdrawals. Legacy accounts have no inferred demographic-consent record. Detailed profile data is held in `patient_profiles`, not in Room or token storage. A verified export/deletion review must include username, name, gender, birthdate, address, contact, legacy avatar choice and consent evidence from this table, the profile photo (`profiles.photo_url` and its files in the Storage bucket `avatars`, listed in `profile_photo_uploads`), alongside Auth identity and existing rehabilitation records. Revoking a therapist link removes future database reads of demographics.

`public.retention_policy` contains the explicit engineering default `development-v1`: **automatic deletion disabled, review after 365 days**. It is a review interval, not a claim of an approved clinical/legal retention period or an automatic purge job. No production policy is inferred from a user's device clock. Local unsynchronized results are retained until reviewed; resetting/uninstalling the development app or deleting its data removes its local database.

Before pilot data collection, the deployment owner must set actual live/local retention, request response time, account deletion, encryption and backup expiry in the deployment policy. This follow-up is recorded in `docs/validation/POST-IMPLEMENTATION-CHECKLIST.md`; it does not block implementing or testing the development workflow.

Profile photos are optional. The person chooses the square to keep, and the app shrinks it on the device to a 384 px WebP (or JPEG) of a few tens of kilobytes with metadata such as location removed. It is stored in the public Supabase Storage bucket `avatars`. Addresses are unguessable and the bucket cannot be listed, but they are not access-controlled: anyone holding an address can open the image. Replaced, removed and moderated photos leave the profile immediately and are removed from Storage by `scripts/cleanup_profile_photos.py`. Run that script regularly and as part of any deletion request. Photos once stored with Cloudinary were cleared by `202611170001_profile_photo_storage.sql`; any copies left in a Cloudinary account must be deleted there. See [PROFILE-PHOTOS.md](PROFILE-PHOTOS.md).

## Booking data

Booking adds personal data of a different kind: when someone comes to the center, why, whether they came, and how to reach their phone. The reason for a visit (`bookings.visit_reason`) is the patient's own words about their health, so it is read only by the patient, the therapist assigned to that session and Schedulers, never appears in notifications, emails, pushes, calendar files or the administrators' feed, and belongs in any export or deletion review of the patient's bookings. Schedulers read names, reference numbers and times through their own functions, and `can_read_patient` is not widened, so a booking opens no clinical record. No booking record holds a clinical measurement.

| Data | Where | How long it stays |
| --- | --- | --- |
| Bookings, attendance and the reason for a decision | `bookings` | Kept with the patient's record, including cancelled and rejected ones. Under the same `development-v1` policy as other records: no automatic deletion |
| The history of each booking | `booking_events`, `audit_events` | Immutable, as other audit records are. A trigger refuses changes even from the database owner |
| In-app notifications | `notifications` | Kept. Each holds the facts it needs, including names and times, and can hold a Scheduler's reason |
| Email and push queue | `notification_deliveries` | Kept, with the last error. A delivery holds no message text |
| Phone tokens | `device_tokens` | Removed at sign-out and when FCM reports a token dead. A token moves to whoever signs in next. A token left by a phone that never signs out stays until FCM reports it |
| Waitlist places | `booking_waitlist` | Kept, with what became of each place |
| Therapist leave reasons | `therapist_time_off` | Read by Schedulers only. A patient reads only that their therapist is away |
| Calendar links | `bookings.calendar_token` | A long random token that works for as long as the booking exists. The file it opens names no patient |

Exported schedules are built in the browser and saved on the Scheduler's own computer. They hold patient and therapist names, and the system cannot recall them, so each export is recorded before the file exists and treating those files properly is the center's responsibility. Email leaves through Gmail, and push through Google once it is turned on, so both are outside this system once sent. A push carries data only and a lock screen hides its text, but it does pass through Google, which is a point for the deployment owner's privacy review.

A deletion request has to consider these tables too. Do not delete `bookings` or `booking_events` rows to answer one without the same review as other historical records, because the audit trigger exists to prevent exactly that. Retention for all of this awaits the owner's approval, like the rest, and the follow-up is in `docs/validation/POST-IMPLEMENTATION-CHECKLIST.md`.

## Care chat

Patients and their linked therapist can write to each other in both apps (issues #105 to #111). Messages are personal health information, so they are handled as part of the patient's record.

**The agreement.** Nobody can write in a conversation until the patient turns messages on. That is a separate agreement, `care-chat-v1`, recorded in `consents` with `consent_type='care-chat'` and audited like the others. It tells the patient four things, in English and Filipino, in the same words on both apps:

1. Messages go only to the therapist they are linked with. Administrators and Schedulers cannot read them.
2. Messages are kept in their rehabilitation record, and they can ask for a copy or deletion from Profile.
3. The therapist does not read messages around the clock; for anything urgent, call the local emergency number or go to the nearest hospital.
4. Turning messages off stops new messages both ways. What was already said stays in the record, and the therapist can still read it.
5. Photos and videos are made smaller on the device first, and Motivance removes them 15 days after they are sent; a copy the person saved themselves stays with them. This point was added in `care-chat-v2`.

The patient can turn messages off and on again from Profile at any time; each change is a new audited row. A therapist agrees to nothing here, because a conversation only opens with a patient who chose it. This version covers words only. Photos and video (#106) need a new version, accepted before either can be sent, because they change what is stored.

**What is kept, and where.**

| Data | Where | How long it stays |
| --- | --- | --- |
| Conversations, one per therapist and patient pair | `conversations` | With the patient's record, under `development-v1`: no automatic deletion |
| Messages | `chat_messages` | The same. A message its sender took back within 15 minutes keeps its place but loses its words at once |
| How far each person has read | `chat_reads` | The same |
| The patient's answers to the agreement | `consents` | Kept, like every consent event |
| Photos and videos | Private Storage bucket `chat-media`, with a row in `chat_attachments` | 15 days from sending, or until the sender takes the message back. After that no link is issued, and `scripts/cleanup_chat_media.py` removes the file. The message stays and says the file has expired |
| The phone's copies of photos and videos it has shown or sent | The Android app's own storage, per account | Until sign-out on that phone, including after the server's copy is removed. They are not in the phone's gallery; a recorded session video is, and stays (see Session videos) |
| A message written on an Android phone and not yet sent | Room `chat_outbox` on that phone | Until it is sent, discarded, or the account signs out on that phone. Unlike an unsent exercise result, it is not kept for the next sign-in: its words should not stay on a phone someone else may use |
| Messages on screen | The browser's memory, and the Android app's memory | Until the page or app closes. Neither keeps a copy of the conversation on disk |

Messages travel over Supabase Realtime only to the two people in the conversation; the server checks each row against the same rule as reading. Nothing about a message is sent to email or push yet; new-message notifications are #110.

**When the link ends.** Nobody can send. The patient keeps reading the conversation. The therapist loses it, exactly as they lose the patient's other records, until the link is restored. Disabling either account stops both reading and sending for that account; both are already audited (`therapist_patients` and account changes), and their effect on chat follows from these rules rather than from separate events.

**Abuse limits.** One person can send at most 30 messages a minute, and a message is at most 2,000 characters. A photo is at most 1600 px and 1 MB, a video at most 480p, 30 seconds and 6 MB, and a conversation can hold 20 videos in 30 days. All of these are enforced by the server, whatever the app does.

**Removing files.** Only Storage's own API can remove a file, so the database cannot do it by itself. Run `python scripts/cleanup_chat_media.py --target hosted --apply` daily with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set, for example from the operator's scheduled tasks. Until it runs, an expired file is still stored but cannot be reached. `--usage` shows how many files and megabytes chat holds, against the free plan's 1 GB. Muting one conversation's notifications comes with those notifications in #110, since there is nothing to mute yet.

## Export or deletion request workflow

1. The signed-in patient submits `request_patient_data` with a stable request UUID and `export` or `delete`. RLS exposes only the patient's own requests and trusted administrators' permitted view. Repeating an identical UUID is idempotent.
2. The app displays **recorded; awaiting administrator review**. It never reports that an export exists or that records/backups were erased simply because the request was queued.
3. A trusted operator reviews the queue in the protected Supabase administrative environment, verifies the requester and confirms scope, retention obligations and identity-handling requirements. Therapist access alone does not authorize fulfilling privacy requests.
4. For export, gather the verified patient's profile, relevant prescription versions, sessions/measurements and consent history through a trusted controlled export. Include their messages: `select public.export_patient_chat('<patient id>')` with the service key returns every conversation, with whom, every message in order and their messages-agreement history. A message taken back appears only as deleted, without its words. Deliver it through the deployment owner's approved channel. The app does not email exports or attach credentials to a request.
5. For deletion, assess active prescriptions, immutable references, audit/identity records and backup expiry together. Messages can be removed on their own once the request is reviewed: `select public.erase_patient_chat('<patient id>')` with the service key removes every message and read mark in the patient's conversations, refuses unless the patient has an open deletion request, records an `erase` event against `chat_messages` in the audit trail, and returns how many messages it removed. Both people's words in those conversations go, because each conversation is about the patient's care. Database backups still hold them until the backups expire. An audited production purge/account-deletion procedure must be reviewed during release preparation. Do not disable historical-integrity triggers ad hoc on live data; the disposable integration-test cleanup is not a production deletion implementation.
6. Only after fulfillment or a documented decision should the trusted operator set the request to `fulfilled` or `declined`, with `resolved_at`. The audit trigger records the status change. Keep sensitive justification in the protected operational case system, not a public issue or raw app logs.

Automated export delivery, an automatic historical purge and administrator-facing request fulfillment are outside S3's patient request queue; release operations must complete them according to the selected policy. They are not presented as implemented background deletions.

## Access and audit

Invitation codes expire after seven days and are hashed in the database; only a matching authenticated email can redeem one. A therapist revokes only their own link. Revocation disables that therapist's assignments and future server reads; existing offline instructions cannot be remotely removed while disconnected, but expire after 24 hours. New uploads for an inactive assignment fail visibly rather than being silently accepted.

Audit events contain actor, action, table/target identifier and server time for invitations, links, roles, prescriptions and privacy requests. Raw tokens, passwords, invitation codes, video and pose traces are excluded. Use synthetic records for automated tests and exclude private screenshots from the repository.
