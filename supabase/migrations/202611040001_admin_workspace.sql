-- Administrator workspace refinement: a searchable directory with identifying details, readable link names,
-- whole-system overview counts and a paginated audit activity feed. Every function re-checks the caller's
-- current active administrator role; no new table, policy or client mutation path is introduced.

-- The directory gains an optional search term, so the earlier single-argument signature is replaced.
drop function public.admin_accounts(uuid);
create function public.admin_accounts(p_after uuid default null,p_search text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; pattern text;
begin
 perform public.require_admin();
 pattern:=nullif(trim(coalesce(p_search,'')),'');
 if length(pattern)>100 then raise exception 'Search term too long'; end if;
 -- Escape LIKE wildcards so a search for "a_b" or "50%" matches literally.
 if pattern is not null then pattern:='%'||replace(replace(replace(pattern,'\','\\'),'%','\%'),'_','\_')||'%'; end if;
 select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'::jsonb) into result from (
  select p.id,p.display_name,p.active,coalesce(u.email,'') as email,u.created_at,u.last_sign_in_at,d.username,
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

-- Counts cover the whole system rather than the loaded directory page. Every new account receives the patient
-- role, so "patients" counts active patient accounts that hold no staff role.
create function public.admin_summary() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform public.require_admin();
 return (
  with staff as (select distinct user_id from public.user_roles where role in ('therapist','admin')),
  patients as (
   select p.id from public.profiles p join public.user_roles r on r.user_id=p.id and r.role='patient'
   where p.active and p.id not in (select user_id from staff)
  )
  select jsonb_build_object(
   'accounts',(select count(*) from public.profiles),
   'disabled',(select count(*) from public.profiles where not active),
   'patients',(select count(*) from patients),
   'therapists',(select count(*) from public.user_roles r join public.profiles p on p.id=r.user_id where r.role='therapist' and p.active),
   'admins',(select count(*) from public.user_roles r join public.profiles p on p.id=r.user_id where r.role='admin' and p.active),
   'active_links',(select count(*) from public.therapist_patients where active),
   'unlinked_patients',(select count(*) from patients a where not exists(
     select 1 from public.therapist_patients t join public.profiles tp on tp.id=t.therapist_id
     where t.patient_id=a.id and t.active and tp.active)),
   'exercises',(select count(*) from public.exercises),
   'active_exercises',(select count(*) from public.exercises where active),
   'sessions_week',(select count(*) from public.sessions where started_at>=now()-interval '7 days'),
   'pending_requests',(select count(*) from public.data_requests where status='requested')
  )
 );
end $$;

-- Links with display names, active links first. The 500-row display bound is unchanged.
create function public.admin_links() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform public.require_admin();
 select coalesce(jsonb_agg(to_jsonb(l) order by l.active desc,lower(l.therapist_name),lower(l.patient_name),l.therapist_id,l.patient_id),'[]'::jsonb) into result from (
  select t.therapist_id,t.patient_id,t.active,tp.display_name as therapist_name,pp.display_name as patient_name
  from public.therapist_patients t
  join public.profiles tp on tp.id=t.therapist_id
  join public.profiles pp on pp.id=t.patient_id
  order by t.active desc,lower(tp.display_name),lower(pp.display_name),t.therapist_id,t.patient_id limit 500
 ) l;
 return result;
end $$;

-- Newest-first audit feed: 30 rows plus one lookahead, keyed by the identity column. Names are resolved for
-- account, role and link targets so the feed does not expose bare identifiers only.
create function public.admin_activity(p_before bigint default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform public.require_admin();
 select coalesce(jsonb_agg(to_jsonb(e) order by e.id desc),'[]'::jsonb) into result from (
  select a.id,a.action,a.target_type,a.target_id,a.recorded_at,a.actor_id,coalesce(actor.display_name,'') as actor_name,
   coalesce((select t.display_name from public.profiles t where t.id::text=case
     when a.target_type in ('profiles','user_roles') then a.target_id
     when a.target_type='therapist_patients' then split_part(a.target_id,':',1) end),'') as target_name,
   coalesce((select t.display_name from public.profiles t where a.target_type='therapist_patients'
     and t.id::text=split_part(a.target_id,':',2)),'') as related_name
  from public.audit_events a
  left join public.profiles actor on actor.id=a.actor_id
  where p_before is null or a.id<p_before
  order by a.id desc limit 31
 ) e;
 return result;
end $$;

revoke all on function public.admin_accounts(uuid,text),public.admin_summary(),public.admin_links(),public.admin_activity(bigint)
 from public,anon,authenticated;
grant execute on function public.admin_accounts(uuid,text),public.admin_summary(),public.admin_links(),public.admin_activity(bigint)
 to authenticated;
