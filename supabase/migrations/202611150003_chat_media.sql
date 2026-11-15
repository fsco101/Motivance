-- Photos and video in care chat (issue #106). Files live in a private Supabase Storage bucket, never behind a public URL.
-- Both apps shrink a file before upload; the server enforces the limits again, so an old or altered client cannot skip it.
-- A message with an attachment exists only once its files are stored and checked. Files are readable by the two people in
-- the conversation, through short-lived signed links, for 15 days. After that no link is issued, and the cleanup
-- (scripts/cleanup_chat_media.py) removes the files through the Storage API, which is the only way files can be removed.

-- ---------------------------------------------------------------------------------------------------------------------
-- The agreement gains a version for media. Words still need any version the patient has agreed to; photos and video need
-- care-chat-v2, which says what is stored and for how long.

create or replace function public.chat_consent_version() returns text language sql immutable set search_path='' as $$ select 'care-chat-v2' $$;

create or replace function public.chat_consented(p_patient uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select c.event='granted' from public.consents c where c.patient_id=p_patient and c.consent_type='care-chat'
  order by c.occurred_at desc,c.recorded_at desc,c.id desc limit 1),false)
$$;

create function public.chat_media_consented(p_patient uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select c.event='granted' and c.version=public.chat_consent_version() from public.consents c
  where c.patient_id=p_patient and c.consent_type='care-chat' order by c.occurred_at desc,c.recorded_at desc,c.id desc limit 1),false)
$$;

create or replace function public.my_chat_consent() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare latest public.consents;
begin
 if not public.has_role('patient') then raise exception 'Patient access required' using errcode='42501'; end if;
 select * into latest from public.consents where patient_id=auth.uid() and consent_type='care-chat' order by occurred_at desc,recorded_at desc,id desc limit 1;
 return jsonb_build_object('version',public.chat_consent_version(),'granted',coalesce(latest.event='granted',false),
  'media',public.chat_media_consented(auth.uid()),'accepted_version',latest.version,'at',latest.occurred_at);
end $$;

-- Agreeing again to an older version records the current one; the same answer to the current version records nothing.
create or replace function public.set_chat_consent(p_granted boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare latest public.consents;
begin
 if not public.has_role('patient') then raise exception 'Patient access required' using errcode='42501'; end if;
 if p_granted is null then raise exception 'chat_invalid'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text,11));
 select * into latest from public.consents where patient_id=auth.uid() and consent_type='care-chat' order by occurred_at desc,recorded_at desc,id desc limit 1;
 if latest.id is null and not p_granted then return public.my_chat_consent(); end if;
 if latest.id is null or latest.event is distinct from (case when p_granted then 'granted' else 'withdrawn' end)
  or (p_granted and latest.version<>public.chat_consent_version()) then
  insert into public.consents(patient_id,consent_type,version,event,client_event_id,occurred_at)
  values(auth.uid(),'care-chat',public.chat_consent_version(),case when p_granted then 'granted' else 'withdrawn' end,gen_random_uuid(),now());
 end if;
 return public.my_chat_consent();
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Limits. Both apps shrink before upload to well inside these.

create function public.chat_media_limit(p_kind text) returns bigint language sql immutable set search_path='' as $$
 select case p_kind when 'image' then 1048576 when 'video' then 6291456 when 'preview' then 204800 end
$$;
create function public.chat_media_days() returns integer language sql immutable set search_path='' as $$ select 15 $$;
create function public.chat_video_cap() returns integer language sql immutable set search_path='' as $$ select 20 $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('chat-media','chat-media',false,6291456,array['image/jpeg','image/webp','video/mp4','video/webm'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

-- One row per photo or video, from the moment its upload is allowed. Its ID is also its message's ID.
create table public.chat_attachments (
 id uuid primary key,
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 uploader_id uuid not null references public.profiles(id),
 kind text not null check(kind in ('image','video')),
 mime text not null check(mime in ('image/jpeg','image/webp','video/mp4','video/webm')),
 width integer not null check(width between 1 and 1600), height integer not null check(height between 1 and 1600),
 duration_ms integer check(duration_ms between 1 and 30500),
 media_path text not null unique, preview_path text not null unique,
 bytes bigint, preview_bytes bigint,
 created_at timestamptz not null default now(),
 sent_at timestamptz, expires_at timestamptz,
 removed_at timestamptz,
 check((kind='image' and mime like 'image/%' and duration_ms is null) or (kind='video' and mime like 'video/%' and duration_ms is not null
  and least(width,height)<=480 and greatest(width,height)<=854))
);
create index chat_attachments_due on public.chat_attachments(expires_at) where removed_at is null;
create index chat_attachments_conversation on public.chat_attachments(conversation_id,kind,sent_at);
alter table public.chat_attachments enable row level security;
revoke all on public.chat_attachments from anon,authenticated;

-- Files whose rows are gone, for example after an erasure, still have to be removed from storage. A deleted row leaves its
-- paths here, so nothing is ever orphaned.
create table public.chat_media_trash (path text primary key, queued_at timestamptz not null default now());
alter table public.chat_media_trash enable row level security;
revoke all on public.chat_media_trash from anon,authenticated;

create function public.chat_attachment_gone() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.removed_at is null then
  insert into public.chat_media_trash(path) values(old.media_path),(old.preview_path) on conflict do nothing;
 end if;
 return old;
end $$;
create trigger chat_attachment_gone after delete on public.chat_attachments for each row execute function public.chat_attachment_gone();

-- Who may touch a file: the uploader while it is being sent, and the two people while it is live.
create function public.chat_media_readable(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.chat_attachments a where p_path in (a.media_path,a.preview_path) and a.removed_at is null and (
  (a.sent_at is null and a.uploader_id=auth.uid() and public.is_active_user())
  or (a.sent_at is not null and a.expires_at>now() and public.chat_can_read(a.conversation_id))))
$$;
create function public.chat_media_writable(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_active_user() and exists(select 1 from public.chat_attachments a where p_path in (a.media_path,a.preview_path)
  and a.uploader_id=auth.uid() and a.sent_at is null and a.removed_at is null and a.created_at>now()-interval '1 hour')
$$;

create policy chat_media_read on storage.objects for select to authenticated using (bucket_id='chat-media' and public.chat_media_readable(name));
create policy chat_media_upload on storage.objects for insert to authenticated with check (bucket_id='chat-media' and public.chat_media_writable(name));

-- ---------------------------------------------------------------------------------------------------------------------
-- Sending in two steps. First the server agrees to the file and names where it goes; then, once it is stored, the message.

create function public.chat_media_extension(p_mime text) returns text language sql immutable set search_path='' as $$
 select case p_mime when 'image/jpeg' then 'jpg' when 'image/webp' then 'webp' when 'video/mp4' then 'mp4' when 'video/webm' then 'webm' end
$$;

-- The same ID again returns the same places, so a retry is safe. Returns where the file and its preview go.
create function public.start_attachment(p_id uuid,p_conversation uuid,p_kind text,p_mime text,p_width integer,p_height integer,p_duration_ms integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.chat_attachments; patient uuid; folder text;
begin
 if not public.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 select * into existing from public.chat_attachments where id=p_id;
 if found then
  if existing.uploader_id<>auth.uid() or existing.conversation_id<>p_conversation or existing.sent_at is not null or existing.removed_at is not null then raise exception 'chat_invalid'; end if;
  return jsonb_build_object('media_path',existing.media_path,'preview_path',existing.preview_path,'limit',public.chat_media_limit(existing.kind),'preview_limit',public.chat_media_limit('preview'));
 end if;
 if not public.chat_can_send(p_conversation) then
  if public.chat_link_open(p_conversation) then raise exception 'chat_consent_required'; end if;
  raise exception 'chat_closed';
 end if;
 select patient_id into patient from public.conversations where id=p_conversation;
 if not public.chat_media_consented(patient) then raise exception 'chat_media_consent_required'; end if;
 if p_kind not in ('image','video') or public.chat_media_extension(p_mime) is null or p_mime not like p_kind||'/%'
  or p_width is null or p_height is null or p_width<1 or p_height<1 then raise exception 'chat_media_invalid'; end if;
 if (p_kind='image' and (greatest(p_width,p_height)>1600 or p_duration_ms is not null))
  or (p_kind='video' and (least(p_width,p_height)>480 or greatest(p_width,p_height)>854 or p_duration_ms is null or p_duration_ms<1 or p_duration_ms>30500)) then
  raise exception 'chat_media_too_large';
 end if;
 if p_kind='video' and (select count(*) from public.chat_attachments where conversation_id=p_conversation and kind='video'
   and created_at>now()-interval '30 days' and (sent_at is not null or created_at>now()-interval '1 hour'))>=public.chat_video_cap() then
  raise exception 'chat_video_cap';
 end if;
 if (select count(*) from public.chat_attachments where uploader_id=auth.uid() and sent_at is null and created_at>now()-interval '1 hour')>=5 then
  raise exception 'chat_rate_limited';
 end if;
 folder:=p_conversation::text||'/'||p_id::text||'/';
 insert into public.chat_attachments(id,conversation_id,uploader_id,kind,mime,width,height,duration_ms,media_path,preview_path)
 values(p_id,p_conversation,auth.uid(),p_kind,p_mime,p_width,p_height,case when p_kind='video' then p_duration_ms end,
  folder||'media.'||public.chat_media_extension(p_mime),folder||'preview.jpg');
 return jsonb_build_object('media_path',folder||'media.'||public.chat_media_extension(p_mime),'preview_path',folder||'preview.jpg',
  'limit',public.chat_media_limit(p_kind),'preview_limit',public.chat_media_limit('preview'));
end $$;

-- Checks what was stored against what was agreed, then makes the message. A file that breaks a limit is refused and queued
-- for removal, so nothing is left behind.
create function public.send_attachment(p_id uuid,p_caption text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.chat_attachments; stored public.chat_messages; media storage.objects; preview storage.objects; words text:=btrim(coalesce(p_caption,''));
begin
 if not public.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 select * into stored from public.chat_messages where id=p_id;
 if found then
  if stored.sender_id is distinct from auth.uid() then raise exception 'chat_invalid'; end if;
  return public.chat_message_json(stored);
 end if;
 select * into a from public.chat_attachments where id=p_id and uploader_id=auth.uid() for update;
 if not found or a.sent_at is not null or a.removed_at is not null then raise exception 'chat_invalid'; end if;
 if char_length(words)>2000 then raise exception 'chat_invalid'; end if;
 if not public.chat_can_send(a.conversation_id) then
  if public.chat_link_open(a.conversation_id) then raise exception 'chat_consent_required'; end if;
  raise exception 'chat_closed';
 end if;
 select * into media from storage.objects where bucket_id='chat-media' and name=a.media_path;
 select * into preview from storage.objects where bucket_id='chat-media' and name=a.preview_path;
 if media.id is null or preview.id is null then raise exception 'chat_media_missing'; end if;
 if coalesce((media.metadata->>'size')::bigint,0)>public.chat_media_limit(a.kind) or coalesce((media.metadata->>'mimetype'),'')<>a.mime
  or coalesce((preview.metadata->>'size')::bigint,0)>public.chat_media_limit('preview') or coalesce(preview.metadata->>'mimetype','')<>'image/jpeg' then
  delete from public.chat_attachments where id=a.id;
  return jsonb_build_object('refused','chat_media_too_large');
 end if;
 update public.chat_attachments set sent_at=now(),expires_at=now()+make_interval(days=>public.chat_media_days()),
  bytes=(media.metadata->>'size')::bigint,preview_bytes=(preview.metadata->>'size')::bigint where id=a.id returning * into a;
 insert into public.chat_messages(id,conversation_id,sender_id,kind,body,data)
 values(a.id,a.conversation_id,auth.uid(),'attachment',words,jsonb_build_object('attachment_kind',a.kind,'mime',a.mime,'width',a.width,'height',a.height,
  'duration_ms',a.duration_ms,'bytes',a.bytes,'media_path',a.media_path,'preview_path',a.preview_path,'expires_at',a.expires_at))
 returning * into stored;
 update public.conversations set last_message_at=stored.created_at where id=a.conversation_id;
 insert into public.chat_reads(conversation_id,user_id,read_at) values(a.conversation_id,auth.uid(),stored.created_at)
 on conflict(conversation_id,user_id) do update set read_at=excluded.read_at;
 return public.chat_message_json(stored);
end $$;

-- Taking back a photo or video also ends its file's life at once.
create or replace function public.delete_message(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare stored public.chat_messages;
begin
 if not public.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 select * into stored from public.chat_messages where id=p_id and sender_id=auth.uid() for update;
 if not found then raise exception 'Message unavailable' using errcode='42501'; end if;
 if stored.deleted_at is not null then return public.chat_message_json(stored); end if;
 if stored.created_at<now()-interval '15 minutes' then raise exception 'chat_too_late'; end if;
 update public.chat_messages set deleted_at=now(),body='',data='{}'::jsonb where id=p_id returning * into stored;
 update public.chat_attachments set expires_at=now() where id=p_id;
 return public.chat_message_json(stored);
end $$;

-- What the conversation list needs to say whether photos and video can be sent.
create or replace function public.my_conversations() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(row order by sort_at desc,id) from (
  select c.id,coalesce(c.last_message_at,c.created_at) sort_at,jsonb_build_object(
   'id',c.id,
   'side',case when c.patient_id=auth.uid() then 'patient' else 'therapist' end,
   'other_id',o.id,'other_name',o.display_name,'other_photo',o.photo_url,
   'open',public.chat_can_send(c.id),
   'consented',public.chat_consented(c.patient_id),
   'media',public.chat_media_consented(c.patient_id),
   'last_message_at',c.last_message_at,
   'last_message',(select public.chat_message_json(m) from public.chat_messages m where m.conversation_id=c.id order by m.created_at desc,m.id desc limit 1),
   'unread',(select count(*) from public.chat_messages m where m.conversation_id=c.id and m.sender_id is distinct from auth.uid() and m.deleted_at is null
     and m.created_at>coalesce((select r.read_at from public.chat_reads r where r.conversation_id=c.id and r.user_id=auth.uid()),'-infinity'::timestamptz))
  ) row
  from public.conversations c
  join public.profiles o on o.id=case when c.patient_id=auth.uid() then c.therapist_id else c.patient_id end
  where auth.uid() in (c.therapist_id,c.patient_id) and public.chat_can_read(c.id)
 ) listed),'[]'::jsonb);
end $$;

create or replace function public.conversation_messages(p_conversation uuid,p_before_at timestamptz default null,p_before_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare page constant integer:=50; found jsonb; total integer; patient uuid;
begin
 if not public.chat_can_read(p_conversation) then raise exception 'Conversation unavailable' using errcode='42501'; end if;
 select c.patient_id into patient from public.conversations c where c.id=p_conversation;
 select coalesce(jsonb_agg(public.chat_message_json(m) order by m.created_at desc,m.id desc),'[]'::jsonb),count(*) into found,total from (
  select * from public.chat_messages m where m.conversation_id=p_conversation
   and (p_before_at is null or (m.created_at,m.id)<(p_before_at,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
  order by m.created_at desc,m.id desc limit page+1) m;
 return jsonb_build_object(
  'messages',case when total>page then found-page else found end,
  'more',total>page,
  'open',public.chat_can_send(p_conversation),
  'consented',public.chat_consented(patient),
  'media',public.chat_media_consented(patient),
  'other_read_at',(select r.read_at from public.chat_reads r where r.conversation_id=p_conversation and r.user_id<>auth.uid()));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- For the trusted operator and the cleanup, with the service key only.

-- Files to remove: expired ones, uploads abandoned for an hour, files whose rows are gone, and, as a safety net, any stored
-- file more than an hour old that no attachment names at all, however it came to be there.
create function public.chat_media_due(p_limit integer default 200) returns text[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(path),array[]::text[]) from (
  select path from (
   select unnest(array[a.media_path,a.preview_path]) path from public.chat_attachments a
    where a.removed_at is null and ((a.sent_at is not null and a.expires_at<=now()) or (a.sent_at is null and a.created_at<now()-interval '1 hour'))
   union select t.path from public.chat_media_trash t
   union select o.name from storage.objects o where o.bucket_id='chat-media' and o.created_at<now()-interval '1 hour'
    and not exists(select 1 from public.chat_attachments a where o.name in (a.media_path,a.preview_path))) due
  order by path limit greatest(1,least(p_limit,1000))) picked
$$;

create function public.chat_media_removed(p_paths text[]) returns integer language plpgsql security definer set search_path='' as $$
declare marked integer;
begin
 update public.chat_attachments set removed_at=now() where removed_at is null and media_path=any(p_paths) and preview_path=any(p_paths);
 get diagnostics marked=row_count;
 delete from public.chat_media_trash where path=any(p_paths);
 return marked;
end $$;

-- How much of the free storage chat is using.
create function public.chat_media_usage() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('files',count(*),'bytes',coalesce(sum((metadata->>'size')::bigint),0))
 from storage.objects where bucket_id='chat-media'
$$;

-- The export names each attachment and, while it still exists, where its file is, so the operator can include it.
create or replace function public.export_patient_chat(p_patient uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'patient_id',p_patient,
  'exported_at',now(),
  'agreement',coalesce((select jsonb_agg(jsonb_build_object('version',c.version,'event',c.event,'at',c.occurred_at) order by c.occurred_at,c.recorded_at)
    from public.consents c where c.patient_id=p_patient and c.consent_type='care-chat'),'[]'::jsonb),
  'conversations',coalesce((select jsonb_agg(jsonb_build_object(
    'therapist_id',v.therapist_id,'therapist_name',(select display_name from public.profiles where id=v.therapist_id),'started_at',v.created_at,
    'messages',coalesce((select jsonb_agg(jsonb_build_object(
      'at',m.created_at,
      'from',case when m.sender_id is null then 'system' when m.sender_id=p_patient then 'patient' else 'therapist' end,
      'kind',m.kind,'deleted',m.deleted_at is not null,
      'text',case when m.deleted_at is null then m.body else '' end,
      'attachment',(select jsonb_build_object('kind',a.kind,'mime',a.mime,'bytes',a.bytes,'expires_at',a.expires_at,
         'file',case when a.removed_at is null and a.expires_at>now() and m.deleted_at is null then a.media_path end)
        from public.chat_attachments a where a.id=m.id)) order by m.created_at,m.id)
     from public.chat_messages m where m.conversation_id=v.id),'[]'::jsonb)) order by v.created_at)
   from public.conversations v where v.patient_id=p_patient),'[]'::jsonb))
$$;

revoke all on function public.chat_media_consented(uuid),public.chat_media_limit(text),public.chat_media_days(),public.chat_video_cap(),
 public.chat_attachment_gone(),public.chat_media_readable(text),public.chat_media_writable(text),public.chat_media_extension(text),
 public.start_attachment(uuid,uuid,text,text,integer,integer,integer),public.send_attachment(uuid,text),
 public.chat_media_due(integer),public.chat_media_removed(text[]),public.chat_media_usage() from public,anon,authenticated;
grant execute on function public.chat_media_consented(uuid),public.chat_media_readable(text),public.chat_media_writable(text),
 public.start_attachment(uuid,uuid,text,text,integer,integer,integer),public.send_attachment(uuid,text) to authenticated;
grant execute on function public.chat_media_due(integer),public.chat_media_removed(text[]),public.chat_media_usage() to service_role;
