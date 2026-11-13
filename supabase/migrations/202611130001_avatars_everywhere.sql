-- A photo goes wherever a name already goes. Each function below returned a person's name to its caller, and now returns their
-- photo beside it. The profiles row policy is unchanged, so nobody can read a photo except through a screen that shows that name.
-- Every body is its latest definition with only the photo fields added. Signatures are unchanged, so existing grants carry over.

create or replace function public.booking_view(b public.bookings) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',b.id,'reference_no',b.reference_no,'status',b.status,'status_reason',b.status_reason,'starts_at',b.starts_at,'ends_at',b.ends_at,
  'previous_starts_at',b.previous_starts_at,'therapist_id',b.therapist_id,'therapist_name',(select display_name from public.profiles where id=b.therapist_id),
  'therapist_photo',(select photo_url from public.profiles where id=b.therapist_id),
  'attendance',b.attendance,'created_at',b.created_at)
$$;

create or replace function public.schedule_view(b public.bookings,p_therapist boolean) returns jsonb language sql stable security definer set search_path='' as $$
 select case when p_therapist then jsonb_build_object('id',b.id,'reference_no',b.reference_no,'status',b.status,'starts_at',b.starts_at,'ends_at',b.ends_at,
   'attendance',b.attendance,'started',b.starts_at<=now(),'location',(select location from public.center_settings),'patient_id',b.patient_id,
   'patient_name',(select display_name from public.profiles where id=b.patient_id),
   'patient_photo',(select photo_url from public.profiles where id=b.patient_id),
   'linked',exists(select 1 from public.therapist_patients where therapist_id=b.therapist_id and patient_id=b.patient_id and active))
  else public.my_booking_view(b) end
$$;

create or replace function public.scheduler_booking_detail(p_booking uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target public.bookings;
begin
 perform public.require_scheduler();
 select * into target from public.bookings where id=p_booking;
 if not found then raise exception 'booking_unavailable'; end if;
 return public.booking_view(target)||jsonb_build_object(
  'patient_id',target.patient_id,'patient_name',(select display_name from public.profiles where id=target.patient_id),
  'patient_photo',(select photo_url from public.profiles where id=target.patient_id),
  'series_id',target.series_id,
  'series_remaining',(select count(*) from public.bookings b join public.booking_series s on s.id=b.series_id
    where b.series_id=target.series_id and s.cancelled_at is null and b.status in ('pending','confirmed','rescheduled') and b.starts_at>now()),
  'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'actor_role',e.actor_role,'actor_name',a.display_name,'actor_photo',a.photo_url,'from_status',e.from_status,'to_status',e.to_status,
    'from_starts_at',e.from_starts_at,'to_starts_at',e.to_starts_at,'reason',e.reason,'to_attendance',e.to_attendance,'recorded_at',e.recorded_at) order by e.id desc)
   from public.booking_events e left join public.profiles a on a.id=e.actor_id where e.booking_id=target.id),'[]'::jsonb));
end $$;

create or replace function public.scheduler_bookings(p_search text default null,p_statuses text[] default null,p_from date default null,p_to date default null,
 p_therapist uuid default null,p_patient uuid default null,p_sort text default 'starts_at',p_descending boolean default false,p_limit integer default 25,p_offset integer default 0,p_attendance text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare settings public.center_settings; pattern text; sorted text; result jsonb;
begin
 perform public.require_scheduler();
 select * into strict settings from public.center_settings;
 pattern:=nullif(trim(coalesce(p_search,'')),'');
 if length(pattern)>100 then raise exception 'Search term too long'; end if;
 -- Escape LIKE wildcards so a search for "a_b" or "50%" matches literally.
 if pattern is not null then pattern:='%'||replace(replace(replace(pattern,'\','\\'),'%','\%'),'_','\_')||'%'; end if;
 -- Only these names can reach the query, so the sort cannot carry anything else.
 sorted:=case coalesce(p_sort,'starts_at') when 'starts_at' then 'b.starts_at' when 'created_at' then 'b.created_at' when 'reference_no' then 'b.reference_no' when 'status' then 'b.status'
  when 'patient' then 'lower(pp.display_name)' when 'therapist' then 'lower(tp.display_name)' when 'attendance' then 'b.attendance' else null end;
 if sorted is null then raise exception 'booking_invalid'; end if;
 if p_attendance is not null and p_attendance not in ('attended','no_show','unmarked') then raise exception 'booking_invalid'; end if;
 execute format($q$
  with found as (
   select b.id,b.reference_no,b.status,b.status_reason,b.starts_at,b.ends_at,b.previous_starts_at,b.patient_id,b.therapist_id,b.attendance,b.series_id,b.starts_at<=now() as started,b.created_at,
    pp.display_name as patient_name,tp.display_name as therapist_name,pp.photo_url as patient_photo,tp.photo_url as therapist_photo,row_number() over(order by %s %s nulls last,b.id) as position
   from public.bookings b
   join public.profiles pp on pp.id=b.patient_id
   left join public.profiles tp on tp.id=b.therapist_id
   where ($1 is null or pp.display_name ilike $1 or tp.display_name ilike $1 or b.reference_no ilike $1)
    and ($2 is null or b.status=any($2))
    and ($3 is null or b.starts_at>=($3::timestamp at time zone $7))
    and ($4 is null or b.starts_at<(($4+1)::timestamp at time zone $7))
    and ($5 is null or b.therapist_id=$5)
    and ($6 is null or b.patient_id=$6)
    -- Not marked means a session that has started, because a session still to come needs nothing yet.
    and ($10 is null or b.attendance=$10 or ($10='unmarked' and b.attendance is null and b.starts_at<=now()))
  )
  select jsonb_build_object('total',(select count(*) from found),
   'rows',coalesce((select jsonb_agg(to_jsonb(f)-'position' order by f.position) from found f where f.position>$9 and f.position<=$9+$8),'[]'::jsonb))
 $q$,sorted,case when p_descending then 'desc' else 'asc' end)
 into result using pattern,p_statuses,p_from,p_to,p_therapist,p_patient,settings.time_zone,least(greatest(coalesce(p_limit,25),1),500),greatest(coalesce(p_offset,0),0),p_attendance;
 return result;
end $$;

create or replace function public.scheduler_calendar_impact(p_starts timestamptz,p_ends timestamptz,p_therapist uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform public.require_scheduler();
 if p_starts is null or p_ends is null or p_ends<=p_starts then raise exception 'booking_invalid_range'; end if;
 return coalesce((select jsonb_agg(public.booking_view(b)||jsonb_build_object('patient_id',b.patient_id,'patient_name',(select display_name from public.profiles where id=b.patient_id),
   'patient_photo',(select photo_url from public.profiles where id=b.patient_id)) order by b.starts_at,b.id)
  from public.calendar_affected(p_starts,p_ends,p_therapist) b),'[]'::jsonb);
end $$;

create or replace function public.scheduler_patients(p_search text default null,p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; pattern text;
begin
 perform public.require_scheduler();
 pattern:=nullif(trim(coalesce(p_search,'')),'');
 if length(pattern)>100 then raise exception 'Search term too long'; end if;
 -- Escape LIKE wildcards so a search for "a_b" or "50%" matches literally.
 if pattern is not null then pattern:='%'||replace(replace(replace(pattern,'\','\\'),'%','\%'),'_','\_')||'%'; end if;
 select coalesce(jsonb_agg(to_jsonb(a) order by lower(a.name),a.id),'[]'::jsonb) into result from (
  select p.id,p.display_name as name,p.photo_url as photo
  from public.profiles p join public.user_roles r on r.user_id=p.id and r.role='patient'
  where p.active and (pattern is null or p.display_name ilike pattern)
   and not exists(select 1 from public.user_roles s where s.user_id=p.id and s.role in ('therapist','admin','scheduler'))
  order by lower(p.display_name),p.id limit least(greatest(coalesce(p_limit,20),1),50)
 ) a;
 return result;
end $$;

create or replace function public.scheduler_schedule_patients() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform public.require_scheduler();
 return coalesce((select jsonb_agg(to_jsonb(a) order by lower(a.name),a.id) from (
  select distinct p.id,p.display_name as name,p.photo_url as photo
  from public.bookings b join public.profiles p on p.id=b.patient_id
  where b.status in ('confirmed','rescheduled')
 ) a),'[]'::jsonb);
end $$;

create or replace function public.scheduler_therapists(p_booking uuid default null,p_starts timestamptz default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target public.bookings; starts timestamptz; ends timestamptz; result jsonb;
begin
 perform public.require_scheduler();
 if p_booking is not null then
  select * into target from public.bookings where id=p_booking;
  if not found then raise exception 'booking_unavailable'; end if;
  starts:=coalesce(p_starts,target.starts_at);
  ends:=starts+(target.ends_at-target.starts_at);
 end if;
 select coalesce(jsonb_agg(to_jsonb(t) order by t.linked desc,lower(t.name),t.id),'[]'::jsonb) into result from (
  select p.id,p.display_name as name,p.photo_url as photo,
   exists(select 1 from public.therapist_patients l where l.therapist_id=p.id and l.patient_id=target.patient_id and l.active) as linked,
   exists(select 1 from public.bookings b where b.therapist_id=p.id and b.id<>target.id and b.status in ('pending','confirmed','rescheduled') and b.starts_at<ends and b.ends_at>starts) as busy,
   exists(select 1 from public.therapist_time_off o where o.therapist_id=p.id and o.starts_at<ends and o.ends_at>starts) as on_leave
  from public.profiles p join public.user_roles r on r.user_id=p.id and r.role='therapist'
  where p.active
 ) t;
 return result;
end $$;

create or replace function public.scheduler_time_off() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform public.require_scheduler();
 return coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'therapist_id',o.therapist_id,'therapist_name',p.display_name,'therapist_photo',p.photo_url,'starts_at',o.starts_at,'ends_at',o.ends_at,'reason',o.reason) order by o.starts_at,o.id)
  from public.therapist_time_off o join public.profiles p on p.id=o.therapist_id where o.ends_at>now()),'[]'::jsonb);
end $$;

create or replace function public.admin_links() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform public.require_admin();
 select coalesce(jsonb_agg(to_jsonb(l) order by l.active desc,lower(l.therapist_name),lower(l.patient_name),l.therapist_id,l.patient_id),'[]'::jsonb) into result from (
  select t.therapist_id,t.patient_id,t.active,tp.display_name as therapist_name,pp.display_name as patient_name,tp.photo_url as therapist_photo,pp.photo_url as patient_photo
  from public.therapist_patients t
  join public.profiles tp on tp.id=t.therapist_id
  join public.profiles pp on pp.id=t.patient_id
  order by t.active desc,lower(tp.display_name),lower(pp.display_name),t.therapist_id,t.patient_id limit 500
 ) l;
 return result;
end $$;

create or replace function public.admin_activity(p_before bigint default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform public.require_admin();
 select coalesce(jsonb_agg(to_jsonb(e) order by e.id desc),'[]'::jsonb) into result from (
  select a.id,a.action,a.target_type,a.target_id,a.recorded_at,a.actor_id,coalesce(actor.display_name,'') as actor_name,actor.photo_url as actor_photo,
   coalesce((select t.display_name from public.profiles t where t.id::text=case
     when a.target_type in ('profiles','user_roles') then a.target_id
     when a.target_type='therapist_patients' then split_part(a.target_id,':',1) end),
    (select b.reference_no from public.bookings b where a.target_type='bookings' and b.id::text=a.target_id),'') as target_name,
   coalesce((select t.display_name from public.profiles t where a.target_type='therapist_patients'
     and t.id::text=split_part(a.target_id,':',2)),'') as related_name
  from public.audit_events a
  left join public.profiles actor on actor.id=a.actor_id
  where p_before is null or a.id<p_before
  order by a.id desc limit 31
 ) e;
 return result;
end $$;

-- The person a notification is about, so the bell can show their face. A row holds facts, and who it concerns is one of them.
alter table public.notifications add column subject_id uuid references public.profiles(id) on delete set null;

-- A booking names two people, and a notification is about the other one: the therapist for the patient, the patient for anyone else.
create function public.set_notification_subject() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.subject_id is null and new.booking_id is not null then
  select case when new.user_id=b.patient_id then b.therapist_id else b.patient_id end into new.subject_id from public.bookings b where b.id=new.booking_id;
 end if;
 return new;
end $$;
revoke all on function public.set_notification_subject() from public,anon,authenticated;
create trigger set_notification_subject before insert on public.notifications for each row execute function public.set_notification_subject();

update public.notifications n set subject_id=case when n.user_id=b.patient_id then b.therapist_id else b.patient_id end
from public.bookings b where b.id=n.booking_id and n.subject_id is null;

-- The subject's name and photo are read now rather than stored, so a removed photo leaves old notifications too.
create or replace function public.my_notifications(p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 return jsonb_build_object(
  'unread',(select count(*) from public.notifications where user_id=auth.uid() and read_at is null),
  'rows',coalesce((select jsonb_agg(to_jsonb(n)-'user_id'-'dedupe_key'||jsonb_build_object('subject_name',s.display_name,'subject_photo',s.photo_url) order by n.created_at desc,n.id) from
   (select * from public.notifications where user_id=auth.uid() order by created_at desc,id limit least(greatest(coalesce(p_limit,50),1),200)) n
   left join public.profiles s on s.id=n.subject_id),'[]'::jsonb));
end $$;
