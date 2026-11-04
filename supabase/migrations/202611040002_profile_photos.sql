-- Profile photos replace the bundled person/star/heart icon choice.
--
-- Photos are uploaded by the app directly to Cloudinary using a short-lived signature issued here. The Cloudinary
-- API secret is kept in Supabase Vault (secrets cloudinary_cloud_name, cloudinary_api_key, cloudinary_api_secret,
-- written by scripts/configure_cloudinary.py) and never reaches the APK. Each signature is bound to a server-chosen,
-- per-user, unguessable public ID. The photo is saved only after Cloudinary's response signature verifies, so a
-- client cannot attach an arbitrary URL or another user's upload.

alter table public.profiles add column photo_url text
 check(photo_url ~ '^https://res\.cloudinary\.com/[A-Za-z0-9_-]+/image/upload/v[0-9]+/motivance/avatars/[0-9a-f-]{36}/[0-9a-f]{32}$');
-- Readable under the existing row policy (owner, linked therapists, administrators). It has no client update grant.
grant select(photo_url) on public.profiles to authenticated;

-- The legacy icon choice is no longer collected. Existing values are retained, and new profile writes store null.
alter table public.patient_profiles alter column avatar drop not null;

-- Issued signatures. These rows support rate limiting, verifying that a completed upload was issued to the caller,
-- and finding replaced or abandoned Cloudinary assets for scripts/cleanup_profile_photos.py.
create table public.profile_photo_uploads (
 public_id text primary key,
 user_id uuid not null references public.profiles(id),
 issued_at timestamptz not null default now(),
 used_at timestamptz,
 retired_at timestamptz,
 deleted_at timestamptz
);
create index profile_photo_uploads_user_time on public.profile_photo_uploads(user_id,issued_at desc);
alter table public.profile_photo_uploads enable row level security;
revoke all on public.profile_photo_uploads from anon,authenticated;

-- Reads one Cloudinary setting from Vault. Static SQL inside plpgsql resolves at call time, so a database without
-- Vault, such as the fresh-schema verifier, can still apply this migration. In that case uploads report "not configured".
create function public.cloudinary_setting(p_name text) returns text language plpgsql stable security definer set search_path='' as $$
declare v text;
begin
 select decrypted_secret into v from vault.decrypted_secrets where name='cloudinary_'||p_name order by created_at desc limit 1;
 return nullif(trim(v),'');
exception when undefined_table or invalid_schema_name then return null;
end $$;
revoke all on function public.cloudinary_setting(text) from public,anon,authenticated;

-- Cloudinary API signature: lowercase hex SHA-1 of the alphabetically ordered parameters joined with '&', followed
-- by the API secret.
create function public.cloudinary_sign(p_payload text,p_secret text,p_algorithm text default 'sha1') returns text
language sql immutable set search_path='' as $$
 select encode(extensions.digest(p_payload||p_secret,p_algorithm),'hex')
$$;
revoke all on function public.cloudinary_sign(text,text,text) from public,anon,authenticated;

create function public.profile_photo_upload() returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare cloud text; api_key text; secret text; issued bigint; pid text;
begin
 if not public.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 cloud:=public.cloudinary_setting('cloud_name'); api_key:=public.cloudinary_setting('api_key'); secret:=public.cloudinary_setting('api_secret');
 -- PostgREST maps PTxxx codes to that HTTP status, which lets the app show a specific "not configured" message.
 if cloud is null or api_key is null or secret is null or cloud !~ '^[A-Za-z0-9_-]+$' then
  raise exception 'Profile photo uploads are not configured' using errcode='PT503';
 end if;
 if (select count(*) from public.profile_photo_uploads where user_id=auth.uid() and issued_at>now()-interval '1 hour')>=10 then
  raise exception 'Too many photo uploads; try again later' using errcode='PT429';
 end if;
 pid:='motivance/avatars/'||auth.uid()::text||'/'||replace(gen_random_uuid()::text,'-','');
 issued:=extract(epoch from now())::bigint;
 insert into public.profile_photo_uploads(public_id,user_id) values(pid,auth.uid());
 return jsonb_build_object('cloud_name',cloud,'api_key',api_key,'timestamp',issued,'public_id',pid,
  'signature',public.cloudinary_sign('public_id='||pid||'&timestamp='||issued,secret));
end $$;

-- Saves an upload after verifying Cloudinary's response signature over public_id and version. Accounts configured
-- for SHA-256 signatures are also accepted.
create function public.set_my_profile_photo(p_public_id text,p_version bigint,p_signature text) returns text
language plpgsql volatile security definer set search_path='' as $$
declare cloud text; secret text; payload text; url text;
begin
 if not public.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 cloud:=public.cloudinary_setting('cloud_name'); secret:=public.cloudinary_setting('api_secret');
 if cloud is null or secret is null then raise exception 'Profile photo uploads are not configured' using errcode='PT503'; end if;
 perform 1 from public.profile_photo_uploads where public_id=p_public_id and user_id=auth.uid() and used_at is null
  and issued_at>now()-interval '1 hour' for update;
 if not found then raise exception 'Unknown or expired photo upload' using errcode='42501'; end if;
 payload:='public_id='||p_public_id||'&version='||p_version;
 if p_version is null or p_version<=0 or p_signature is null
  or lower(p_signature) not in (public.cloudinary_sign(payload,secret),public.cloudinary_sign(payload,secret,'sha256'))
 then raise exception 'Photo upload could not be verified' using errcode='42501'; end if;
 url:='https://res.cloudinary.com/'||cloud||'/image/upload/v'||p_version||'/'||p_public_id;
 update public.profile_photo_uploads set retired_at=now()
  where user_id=auth.uid() and used_at is not null and retired_at is null;
 update public.profile_photo_uploads set used_at=now() where public_id=p_public_id;
 update public.profiles set photo_url=url where id=auth.uid();
 insert into public.audit_events(actor_id,action,target_type,target_id) values(auth.uid(),'update_photo','profiles',auth.uid()::text);
 return url;
end $$;

create function public.clear_profile_photo(p_user uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.profile_photo_uploads set retired_at=now() where user_id=p_user and used_at is not null and retired_at is null;
 update public.profiles set photo_url=null where id=p_user;
 insert into public.audit_events(actor_id,action,target_type,target_id) values(auth.uid(),'remove_photo','profiles',p_user::text);
end $$;
revoke all on function public.clear_profile_photo(uuid) from public,anon,authenticated;

create function public.clear_my_profile_photo() returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 perform public.clear_profile_photo(auth.uid());
end $$;

-- Moderation: administrators can remove another account's photo. The audit record names the administrator.
create function public.admin_clear_photo(p_user uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.require_admin();
 if not exists(select 1 from public.profiles where id=p_user) then raise exception 'Account unavailable'; end if;
 perform public.clear_profile_photo(p_user);
end $$;

-- The administrator directory also returns photos.
create or replace function public.admin_accounts(p_after uuid default null,p_search text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; pattern text;
begin
 perform public.require_admin();
 pattern:=nullif(trim(coalesce(p_search,'')),'');
 if length(pattern)>100 then raise exception 'Search term too long'; end if;
 if pattern is not null then pattern:='%'||replace(replace(replace(pattern,'\','\\'),'%','\%'),'_','\_')||'%'; end if;
 select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'::jsonb) into result from (
  select p.id,p.display_name,p.active,coalesce(u.email,'') as email,u.created_at,u.last_sign_in_at,d.username,p.photo_url,
   array(select r.role from public.user_roles r where r.user_id=p.id order by r.role) as roles
  from public.profiles p
  join auth.users u on u.id=p.id
  left join public.patient_profiles d on d.user_id=p.id
  where (p_after is null or p.id>p_after)
   and (pattern is null or p.display_name ilike pattern or u.email ilike pattern or d.username ilike pattern or p.id::text ilike pattern)
  order by p.id limit 51
 ) a;
 return result;
end $$;

revoke all on function public.profile_photo_upload(),public.set_my_profile_photo(text,bigint,text),public.clear_my_profile_photo(),
 public.admin_clear_photo(uuid) from public,anon,authenticated;
grant execute on function public.profile_photo_upload(),public.set_my_profile_photo(text,bigint,text),public.clear_my_profile_photo(),
 public.admin_clear_photo(uuid) to authenticated;
