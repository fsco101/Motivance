-- Session videos shared with the therapist (#129). A video recorded on the phone (#114) stays on the phone until the patient chooses,
-- for that one session, to let their therapist see it. Only then is it uploaded, made smaller, into a private bucket. The patient and
-- the therapist whose exercise it was can watch it; nobody else can, administrators included. The server keeps it for 15 days, or
-- until the patient stops sharing it, whichever comes first. The phone's own copy is never touched. Files are removed through the
-- Storage API by scripts/cleanup_chat_media.py, as chat media are.

create function public.session_video_days() returns integer language sql immutable set search_path='' as $$ select 15 $$;
-- 480p H.264 at about 500 kbps: the first five minutes fit well inside 20 MB.
create function public.session_video_limit(p_kind text) returns bigint language sql immutable set search_path='' as $$
 select case p_kind when 'video' then 20971520 when 'preview' then 204800 end
$$;
create function public.session_video_ms() returns integer language sql immutable set search_path='' as $$ select 300500 $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('session-videos','session-videos',false,20971520,array['video/mp4','image/jpeg'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

-- One row per shared video, from the moment its upload is allowed. Its ID is made on the phone, so a retry is safe.
create table public.session_videos (
 id uuid primary key,
 session_id uuid not null unique references public.sessions(id),
 patient_id uuid not null references public.patients(id),
 -- The therapist whose exercise the session was: the one person it is shared with.
 therapist_id uuid not null references public.profiles(id),
 width integer not null check(width between 2 and 854), height integer not null check(height between 2 and 854),
 duration_ms integer not null check(duration_ms between 1 and 300500),
 media_path text not null unique, preview_path text not null unique,
 bytes bigint, preview_bytes bigint,
 created_at timestamptz not null default now(),
 shared_at timestamptz, expires_at timestamptz,
 -- Set when the patient stops sharing or the cleanup removes the files.
 removed_at timestamptz,
 check(least(width,height)<=480)
);
create index session_videos_due on public.session_videos(expires_at) where removed_at is null;
create index session_videos_patient on public.session_videos(patient_id,shared_at desc);

create table public.session_video_trash (path text primary key, queued_at timestamptz not null default now());
alter table public.session_video_trash enable row level security;
revoke all on public.session_video_trash from anon,authenticated;

create function public.session_video_gone() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.removed_at is null then
  insert into public.session_video_trash(path) values(old.media_path),(old.preview_path) on conflict do nothing;
 end if;
 return old;
end $$;
create trigger session_video_gone after delete on public.session_videos for each row execute function public.session_video_gone();

-- Who may watch: the patient, and the therapist whose exercise it was while their link is active. Nobody else, so not an administrator.
create function public.session_video_viewer(v public.session_videos) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_active_user() and (v.patient_id=auth.uid() or (v.therapist_id=auth.uid() and public.has_role('therapist')
  and exists(select 1 from public.therapist_patients l where l.therapist_id=v.therapist_id and l.patient_id=v.patient_id and l.active)))
$$;

alter table public.session_videos enable row level security;
revoke all on public.session_videos from anon,authenticated;
grant select on public.session_videos to authenticated;
create policy session_videos_read on public.session_videos for select to authenticated
 using (shared_at is not null and removed_at is null and expires_at>now() and public.session_video_viewer(session_videos));

create function public.session_video_readable(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.session_videos v where p_path in (v.media_path,v.preview_path) and v.removed_at is null and (
  (v.shared_at is null and v.patient_id=auth.uid() and public.is_active_user())
  or (v.shared_at is not null and v.expires_at>now() and public.session_video_viewer(v))))
$$;
create function public.session_video_writable(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_active_user() and exists(select 1 from public.session_videos v where p_path in (v.media_path,v.preview_path)
  and v.patient_id=auth.uid() and v.shared_at is null and v.removed_at is null and v.created_at>now()-interval '1 hour')
$$;
create policy session_videos_read on storage.objects for select to authenticated using (bucket_id='session-videos' and public.session_video_readable(name));
create policy session_videos_upload on storage.objects for insert to authenticated with check (bucket_id='session-videos' and public.session_video_writable(name));

create function public.session_video_json(v public.session_videos) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',v.id,'session_id',v.session_id,'patient_id',v.patient_id,'therapist_id',v.therapist_id,'width',v.width,'height',v.height,
  'duration_ms',v.duration_ms,'bytes',v.bytes,'media_path',v.media_path,'preview_path',v.preview_path,'shared_at',v.shared_at,'expires_at',v.expires_at)
$$;

-- Sharing in two steps, as chat media are: first the server agrees to the file and names where it goes, then, once it is stored,
-- it is shared. Only the patient whose session it is can share it, and only while the exercise's therapist is linked.
create function public.start_session_video(p_id uuid,p_session uuid,p_width integer,p_height integer,p_duration_ms integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare existing public.session_videos; s public.sessions; therapist uuid; folder text;
begin
 if not public.is_active_user() or not public.has_role('patient') then raise exception 'Patient access required' using errcode='42501'; end if;
 select * into existing from public.session_videos where id=p_id;
 if found then
  if existing.patient_id<>auth.uid() or existing.session_id<>p_session or existing.shared_at is not null or existing.removed_at is not null then raise exception 'video_invalid'; end if;
  return jsonb_build_object('media_path',existing.media_path,'preview_path',existing.preview_path,'limit',public.session_video_limit('video'),'preview_limit',public.session_video_limit('preview'));
 end if;
 select * into s from public.sessions where id=p_session and patient_id=auth.uid();
 if not found then raise exception 'video_session_missing'; end if;
 select a.therapist_id into therapist from public.prescription_versions p join public.exercise_assignments a on a.id=p.assignment_id where p.id=s.prescription_version_id;
 if not exists(select 1 from public.therapist_patients l where l.therapist_id=therapist and l.patient_id=auth.uid() and l.active) then raise exception 'video_unavailable' using errcode='42501'; end if;
 if exists(select 1 from public.session_videos v where v.session_id=p_session and v.removed_at is null and (v.shared_at is not null or v.created_at>now()-interval '1 hour')) then
  raise exception 'video_already_shared';
 end if;
 if p_width is null or p_height is null or p_duration_ms is null or p_width<2 or p_height<2 or least(p_width,p_height)>480 or greatest(p_width,p_height)>854
  or p_duration_ms<1 or p_duration_ms>public.session_video_ms() then raise exception 'video_too_large'; end if;
 if (select count(*) from public.session_videos where patient_id=auth.uid() and created_at>now()-interval '1 hour')>=5 then raise exception 'video_rate_limited'; end if;
 -- A session whose earlier attempt was abandoned starts again under a new ID.
 delete from public.session_videos where session_id=p_session and shared_at is null;
 folder:=auth.uid()::text||'/'||p_id::text||'/';
 insert into public.session_videos(id,session_id,patient_id,therapist_id,width,height,duration_ms,media_path,preview_path)
 values(p_id,p_session,auth.uid(),therapist,p_width,p_height,p_duration_ms,folder||'media.mp4',folder||'preview.jpg');
 return jsonb_build_object('media_path',folder||'media.mp4','preview_path',folder||'preview.jpg','limit',public.session_video_limit('video'),'preview_limit',public.session_video_limit('preview'));
end $$;

-- Checks what was stored against what was agreed, then shares it for 15 days. A file that breaks a limit is refused and queued for
-- removal, so nothing is left behind.
create function public.share_session_video(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.session_videos; media storage.objects; preview storage.objects;
begin
 if not public.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 select * into v from public.session_videos where id=p_id and patient_id=auth.uid() for update;
 if not found or v.removed_at is not null then raise exception 'video_invalid'; end if;
 if v.shared_at is not null then return public.session_video_json(v); end if;
 if not exists(select 1 from public.therapist_patients l where l.therapist_id=v.therapist_id and l.patient_id=v.patient_id and l.active) then
  raise exception 'video_unavailable' using errcode='42501';
 end if;
 select * into media from storage.objects where bucket_id='session-videos' and name=v.media_path;
 select * into preview from storage.objects where bucket_id='session-videos' and name=v.preview_path;
 if media.id is null or preview.id is null then raise exception 'video_missing'; end if;
 if coalesce((media.metadata->>'size')::bigint,0)>public.session_video_limit('video') or coalesce(media.metadata->>'mimetype','')<>'video/mp4'
  or coalesce((preview.metadata->>'size')::bigint,0)>public.session_video_limit('preview') or coalesce(preview.metadata->>'mimetype','')<>'image/jpeg' then
  -- Returned rather than raised, so the removal is kept.
  delete from public.session_videos where id=v.id;
  return jsonb_build_object('refused','video_too_large');
 end if;
 update public.session_videos set shared_at=now(),expires_at=now()+make_interval(days=>public.session_video_days()),
  bytes=(media.metadata->>'size')::bigint,preview_bytes=(preview.metadata->>'size')::bigint where id=v.id returning * into v;
 return public.session_video_json(v);
end $$;

-- The patient changes their mind: the server copy goes at once, and nobody can open it from now on.
create function public.stop_sharing_session_video(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare v public.session_videos;
begin
 if not public.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 select * into v from public.session_videos where id=p_id and patient_id=auth.uid() for update;
 if not found then raise exception 'video_invalid'; end if;
 if v.removed_at is null then
  update public.session_videos set removed_at=now() where id=v.id;
  insert into public.session_video_trash(path) values(v.media_path),(v.preview_path) on conflict do nothing;
 end if;
end $$;

-- Files to remove: expired ones, ones no longer shared, uploads abandoned for an hour, files whose rows are gone, and any stored file
-- more than an hour old that no video names.
create function public.session_video_due(p_limit integer default 200) returns text[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(path),array[]::text[]) from (
  select path from (
   select unnest(array[v.media_path,v.preview_path]) path from public.session_videos v
    where v.removed_at is null and ((v.shared_at is not null and v.expires_at<=now()) or (v.shared_at is null and v.created_at<now()-interval '1 hour'))
   union select t.path from public.session_video_trash t
   union select o.name from storage.objects o where o.bucket_id='session-videos' and o.created_at<now()-interval '1 hour'
    and not exists(select 1 from public.session_videos v where o.name in (v.media_path,v.preview_path) and v.removed_at is null)) due
  order by path limit greatest(1,least(p_limit,1000))) picked
$$;

create function public.session_video_removed(p_paths text[]) returns integer language plpgsql security definer set search_path='' as $$
declare marked integer;
begin
 update public.session_videos set removed_at=now() where removed_at is null and media_path=any(p_paths) and preview_path=any(p_paths);
 get diagnostics marked=row_count;
 delete from public.session_video_trash where path=any(p_paths);
 return marked;
end $$;

create function public.session_video_usage() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('files',count(*),'bytes',coalesce(sum((metadata->>'size')::bigint),0)) from storage.objects where bucket_id='session-videos'
$$;

revoke all on function public.session_video_days(),public.session_video_limit(text),public.session_video_ms(),public.session_video_gone(),
 public.session_video_viewer(public.session_videos),public.session_video_readable(text),public.session_video_writable(text),public.session_video_json(public.session_videos),
 public.start_session_video(uuid,uuid,integer,integer,integer),public.share_session_video(uuid),public.stop_sharing_session_video(uuid),
 public.session_video_due(integer),public.session_video_removed(text[]),public.session_video_usage() from public,anon,authenticated;
grant execute on function public.start_session_video(uuid,uuid,integer,integer,integer),public.share_session_video(uuid),public.stop_sharing_session_video(uuid) to authenticated;
-- The storage policies call these as the signed-in person.
grant execute on function public.session_video_readable(text),public.session_video_writable(text),public.session_video_viewer(public.session_videos) to authenticated;
-- The cleanup script, with the service key.
grant execute on function public.session_video_due(integer),public.session_video_removed(text[]),public.session_video_usage() to service_role;
