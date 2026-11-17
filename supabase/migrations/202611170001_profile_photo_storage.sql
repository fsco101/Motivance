-- Profile photos move from Cloudinary to Supabase Storage, so they no longer need a third-party account or secrets.
--
-- Both apps let the person choose the square to keep, then shrink it on the device to one small 384 px image (WebP, or
-- JPEG where the browser cannot write WebP) before it leaves. The server enforces the limits again, so an old or altered
-- client cannot skip them: the bucket refuses anything over 100 KB or of another type, and the photo is saved only once its
-- file is stored in the place the server chose for that person.
--
-- The bucket is public, as Cloudinary delivery was: anyone holding a photo's address can open it, but addresses carry a
-- random 128-bit name and nobody can list the bucket, so a photo is only found through a screen that already shows that
-- person's name. profiles.photo_url now holds the file's path in the bucket, not a full address. Each app builds the
-- address from its own backend URL, because the same file is reached through different hosts (an emulator, a browser,
-- the hosted project).
--
-- Replaced, removed and abandoned files are removed through the Storage API by scripts/cleanup_profile_photos.py.

-- ---------------------------------------------------------------------------------------------------------------------
-- The old Cloudinary path

-- Cloudinary addresses cannot be shown any more, so those photos are cleared and the people see their initials until
-- they choose a new one. Any files still held by a Cloudinary account must be removed there (folder motivance/avatars).
do $$
declare c record;
begin
 for c in select conname from pg_constraint where conrelid='public.profiles'::regclass and contype='c' and pg_get_constraintdef(oid) like '%photo_url%' loop
  execute format('alter table public.profiles drop constraint %I',c.conname);
 end loop;
end $$;
update public.profiles set photo_url=null where photo_url is not null;

drop function public.profile_photo_upload();
drop function public.set_my_profile_photo(text,bigint,text);
drop function public.cloudinary_setting(text);
drop function public.cloudinary_sign(text,text,text);
drop table public.profile_photo_uploads;

-- Vault secrets written by the retired scripts/configure_cloudinary.py are no longer read by anything.
do $$
begin
 delete from vault.secrets where name in ('cloudinary_cloud_name','cloudinary_api_key','cloudinary_api_secret');
exception when undefined_table or invalid_schema_name or insufficient_privilege then null;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Storage

create function public.profile_photo_limit() returns bigint language sql immutable set search_path='' as $$ select 102400::bigint $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('avatars','avatars',true,102400,array['image/webp','image/jpeg'])
on conflict(id) do update set public=true,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

-- <account id>/<32 random hex>.webp or .jpg
alter table public.profiles add constraint profiles_photo_url_check check(photo_url ~ '^[0-9a-f-]{36}/[0-9a-f]{32}\.(webp|jpg)$');

-- One row per upload the server has agreed to. Rows support the hourly limit, checking that a stored file was agreed for
-- the caller, and finding replaced or abandoned files for the cleanup.
create table public.profile_photo_uploads (
 path text primary key check(path ~ '^[0-9a-f-]{36}/[0-9a-f]{32}\.(webp|jpg)$'),
 user_id uuid not null references public.profiles(id),
 mime text not null check(mime in ('image/webp','image/jpeg')),
 bytes bigint,
 issued_at timestamptz not null default now(),
 used_at timestamptz,
 retired_at timestamptz,
 deleted_at timestamptz
);
create index profile_photo_uploads_user_time on public.profile_photo_uploads(user_id,issued_at desc);
create index profile_photo_uploads_due on public.profile_photo_uploads(issued_at) where deleted_at is null;
alter table public.profile_photo_uploads enable row level security;
revoke all on public.profile_photo_uploads from anon,authenticated;

-- Only the person the place was issued to may put a file there, once, within the hour. There is no select, update or
-- delete policy: files are read through the public address, never listed, and only the cleanup removes them.
create function public.profile_photo_writable(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_active_user() and exists(select 1 from public.profile_photo_uploads u where u.path=p_path and u.user_id=auth.uid()
  and u.used_at is null and u.deleted_at is null and u.issued_at>now()-interval '1 hour')
$$;
create policy avatars_upload on storage.objects for insert to authenticated with check (bucket_id='avatars' and public.profile_photo_writable(name));

-- ---------------------------------------------------------------------------------------------------------------------
-- Uploading in two steps: the server names the place, the app stores the file there, then the server checks it and saves.

create function public.start_profile_photo(p_mime text default 'image/webp') returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare place text;
begin
 if not public.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_mime is null or p_mime not in ('image/webp','image/jpeg') then raise exception 'Unsupported photo type' using errcode='22023'; end if;
 -- PostgREST maps PTxxx codes to that HTTP status, which lets the apps show a specific message.
 if (select count(*) from public.profile_photo_uploads where user_id=auth.uid() and issued_at>now()-interval '1 hour')>=10 then
  raise exception 'Too many photo uploads; try again later' using errcode='PT429';
 end if;
 place:=auth.uid()::text||'/'||replace(gen_random_uuid()::text,'-','')||case p_mime when 'image/webp' then '.webp' else '.jpg' end;
 insert into public.profile_photo_uploads(path,user_id,mime) values(place,auth.uid(),p_mime);
 return jsonb_build_object('bucket','avatars','path',place,'limit',public.profile_photo_limit());
end $$;

-- Saves a stored file as the caller's photo, after checking it is theirs, unused, recent, and within the limits.
create function public.set_my_profile_photo(p_path text) returns text language plpgsql volatile security definer set search_path='' as $$
declare ticket public.profile_photo_uploads; stored storage.objects;
begin
 if not public.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 select * into ticket from public.profile_photo_uploads where path=p_path and user_id=auth.uid() and used_at is null and deleted_at is null
  and issued_at>now()-interval '1 hour' for update;
 if not found then raise exception 'Unknown or expired photo upload' using errcode='42501'; end if;
 select * into stored from storage.objects where bucket_id='avatars' and name=p_path;
 if stored.id is null then raise exception 'Photo file missing' using errcode='PT409'; end if;
 if coalesce((stored.metadata->>'size')::bigint,public.profile_photo_limit()+1)>public.profile_photo_limit()
  or coalesce(stored.metadata->>'mimetype','')<>ticket.mime then
  raise exception 'Photo too large or of the wrong type' using errcode='PT413';
 end if;
 update public.profile_photo_uploads set retired_at=now() where user_id=auth.uid() and used_at is not null and retired_at is null;
 update public.profile_photo_uploads set used_at=now(),bytes=(stored.metadata->>'size')::bigint where path=p_path;
 update public.profiles set photo_url=p_path where id=auth.uid();
 insert into public.audit_events(actor_id,action,target_type,target_id) values(auth.uid(),'update_photo','profiles',auth.uid()::text);
 return p_path;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Cleanup, for scripts/cleanup_profile_photos.py with the service key.

-- Replaced or removed photos, places issued more than two hours ago and never used, and, as a safety net, any file more
-- than two hours old that is not somebody's current photo.
create function public.profile_photos_due(p_limit integer default 200) returns text[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(path),array[]::text[]) from (
  select path from (
   select u.path from public.profile_photo_uploads u where u.deleted_at is null
    and (u.retired_at is not null or (u.used_at is null and u.issued_at<now()-interval '2 hours'))
   union select o.name from storage.objects o where o.bucket_id='avatars' and o.created_at<now()-interval '2 hours'
    and not exists(select 1 from public.profiles p where p.photo_url=o.name)) due
  order by path limit greatest(1,least(p_limit,1000))) picked
$$;

create function public.profile_photos_removed(p_paths text[]) returns integer language plpgsql security definer set search_path='' as $$
declare marked integer;
begin
 update public.profile_photo_uploads set deleted_at=now() where deleted_at is null and path=any(p_paths)
  and not exists(select 1 from public.profiles p where p.photo_url=profile_photo_uploads.path);
 get diagnostics marked=row_count;
 return marked;
end $$;

create function public.profile_photo_usage() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('files',count(*),'bytes',coalesce(sum((metadata->>'size')::bigint),0))
 from storage.objects where bucket_id='avatars'
$$;

revoke all on function public.profile_photo_limit(),public.profile_photo_writable(text),public.start_profile_photo(text),
 public.set_my_profile_photo(text),public.profile_photos_due(integer),public.profile_photos_removed(text[]),public.profile_photo_usage()
 from public,anon,authenticated;
grant execute on function public.profile_photo_writable(text),public.start_profile_photo(text),public.set_my_profile_photo(text) to authenticated;
grant execute on function public.profile_photos_due(integer),public.profile_photos_removed(text[]),public.profile_photo_usage() to service_role;
