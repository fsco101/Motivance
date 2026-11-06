-- The Scheduler runs in-center bookings. The role is granted like the therapist role and is deliberately kept out of
-- can_read_patient, so it opens no clinical record: Schedulers read names and times through their own functions only.
alter table public.user_roles drop constraint user_roles_role_check;
alter table public.user_roles add constraint user_roles_role_check check(role in ('patient','therapist','admin','scheduler'));

create function public.require_scheduler() returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.has_role('scheduler') then raise exception 'Active scheduler required' using errcode='42501'; end if;
end $$;

create or replace function public.admin_set_role(p_user uuid,p_role text,p_granted boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(724010);
 perform public.require_admin();
 if p_role is null or p_role not in ('therapist','admin','scheduler') or p_granted is null or p_user=auth.uid()
 then raise exception 'Invalid role change or self modification'; end if;
 if not exists(select 1 from public.profiles where id=p_user and active) then raise exception 'Active account required'; end if;
 if p_granted then
  insert into public.user_roles(user_id,role) values(p_user,p_role) on conflict do nothing;
 else
  delete from public.user_roles where user_id=p_user and role=p_role;
  if p_role='therapist' then
   update public.therapist_patients set active=false where therapist_id=p_user;
   update public.exercise_assignments set active=false where therapist_id=p_user;
   update public.patient_invitations set expires_at=least(expires_at,now()) where therapist_id=p_user;
  end if;
 end if;
end $$;

-- Schedulers are staff, so they stop counting as patients and gain a count of their own.
create or replace function public.admin_summary() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform public.require_admin();
 return (
  with staff as (select distinct user_id from public.user_roles where role in ('therapist','admin','scheduler')),
  patients as (
   select p.id from public.profiles p join public.user_roles r on r.user_id=p.id and r.role='patient'
   where p.active and p.id not in (select user_id from staff)
  )
  select jsonb_build_object(
   'accounts',(select count(*) from public.profiles),
   'disabled',(select count(*) from public.profiles where not active),
   'patients',(select count(*) from patients),
   'therapists',(select count(*) from public.user_roles r join public.profiles p on p.id=r.user_id where r.role='therapist' and p.active),
   'schedulers',(select count(*) from public.user_roles r join public.profiles p on p.id=r.user_id where r.role='scheduler' and p.active),
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

-- Names only: this is what a Scheduler needs to pick a patient, and the boundary the role must not cross.
create function public.scheduler_patients(p_search text default null,p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; pattern text;
begin
 perform public.require_scheduler();
 pattern:=nullif(trim(coalesce(p_search,'')),'');
 if length(pattern)>100 then raise exception 'Search term too long'; end if;
 -- Escape LIKE wildcards so a search for "a_b" or "50%" matches literally.
 if pattern is not null then pattern:='%'||replace(replace(replace(pattern,'\','\\'),'%','\%'),'_','\_')||'%'; end if;
 select coalesce(jsonb_agg(to_jsonb(a) order by lower(a.name),a.id),'[]'::jsonb) into result from (
  select p.id,p.display_name as name
  from public.profiles p join public.user_roles r on r.user_id=p.id and r.role='patient'
  where p.active and (pattern is null or p.display_name ilike pattern)
   and not exists(select 1 from public.user_roles s where s.user_id=p.id and s.role in ('therapist','admin','scheduler'))
  order by lower(p.display_name),p.id limit least(greatest(coalesce(p_limit,20),1),50)
 ) a;
 return result;
end $$;

revoke all on function public.require_scheduler(),public.scheduler_patients(text,integer) from public,anon,authenticated;
grant execute on function public.scheduler_patients(text,integer) to authenticated;
