-- When a therapist is away. Schedulers keep the reason: a therapist sees their own leave on My Schedule, but no one else's and no reason.
create table public.therapist_time_off (
 id uuid primary key default gen_random_uuid(),
 therapist_id uuid not null references public.profiles(id),
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 reason text not null check(length(trim(reason)) between 3 and 300),
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(ends_at>starts_at)
);
create index therapist_time_off_times on public.therapist_time_off(therapist_id,starts_at,ends_at);
alter table public.therapist_time_off enable row level security;
revoke all on public.therapist_time_off from anon,authenticated;

-- The single gate for confirming, assigning and rescheduling, so one check covers all three.
create or replace function public.booking_check_therapist(p_therapist uuid,p_starts timestamptz,p_ends timestamptz,p_booking uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_therapist is null then raise exception 'booking_therapist_required'; end if;
 if not exists(select 1 from public.profiles p join public.user_roles r on r.user_id=p.id and r.role='therapist' where p.id=p_therapist and p.active)
 then raise exception 'booking_therapist_unavailable'; end if;
 if exists(select 1 from public.therapist_time_off where therapist_id=p_therapist and starts_at<p_ends and ends_at>p_starts) then raise exception 'booking_therapist_on_leave'; end if;
 if exists(select 1 from public.bookings where therapist_id=p_therapist and status in ('pending','confirmed','rescheduled') and starts_at<p_ends and ends_at>p_starts and id is distinct from p_booking)
 then raise exception 'booking_therapist_busy'; end if;
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
  select p.id,p.display_name as name,
   exists(select 1 from public.therapist_patients l where l.therapist_id=p.id and l.patient_id=target.patient_id and l.active) as linked,
   exists(select 1 from public.bookings b where b.therapist_id=p.id and b.id<>target.id and b.status in ('pending','confirmed','rescheduled') and b.starts_at<ends and b.ends_at>starts) as busy,
   exists(select 1 from public.therapist_time_off o where o.therapist_id=p.id and o.starts_at<ends and o.ends_at>starts) as on_leave
  from public.profiles p join public.user_roles r on r.user_id=p.id and r.role='therapist'
  where p.active
 ) t;
 return result;
end $$;

-- A stretch of time can now strand the whole center, or just one therapist's sessions.
drop function public.scheduler_calendar_impact(timestamptz,timestamptz);
drop function public.calendar_resolve(timestamptz,timestamptz,jsonb);
drop function public.calendar_affected(timestamptz,timestamptz);

create function public.calendar_affected(p_starts timestamptz,p_ends timestamptz,p_therapist uuid default null) returns setof public.bookings
language sql stable security definer set search_path='' as $$
 select * from public.bookings where status in ('pending','confirmed','rescheduled') and starts_at<p_ends and ends_at>p_starts and ends_at>now()
  and (p_therapist is null or therapist_id=p_therapist) order by starts_at,id
$$;

create function public.calendar_resolve(p_starts timestamptz,p_ends timestamptz,p_resolutions jsonb,p_therapist uuid default null) returns integer
language plpgsql security definer set search_path='' as $$
declare decisions jsonb:=coalesce(p_resolutions,'[]'::jsonb); item jsonb; decided uuid[]; affected uuid[];
begin
 if jsonb_typeof(decisions)<>'array' then raise exception 'booking_invalid'; end if;
 select coalesce(array_agg((value->>'booking')::uuid),'{}') into decided from jsonb_array_elements(decisions);
 select coalesce(array_agg(id),'{}') into affected from public.calendar_affected(p_starts,p_ends,p_therapist);
 if not affected<@decided then raise exception 'booking_unresolved'; end if;
 if not decided<@affected or cardinality(decided)<>cardinality(affected) then raise exception 'booking_invalid'; end if;
 for item in select value from jsonb_array_elements(decisions) loop
  case item->>'action'
   when 'cancel' then perform public.scheduler_cancel((item->>'booking')::uuid,item->>'reason');
   when 'reschedule' then perform public.scheduler_reschedule((item->>'booking')::uuid,(item->>'starts_at')::timestamptz,(item->>'therapist')::uuid,item->>'reason');
   -- A therapist being away rarely means the session has to move: someone else can usually take it at the same time.
   when 'assign' then perform public.scheduler_assign_therapist((item->>'booking')::uuid,(item->>'therapist')::uuid);
   else raise exception 'booking_invalid';
  end case;
 end loop;
 return cardinality(decided);
end $$;

create function public.scheduler_calendar_impact(p_starts timestamptz,p_ends timestamptz,p_therapist uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform public.require_scheduler();
 if p_starts is null or p_ends is null or p_ends<=p_starts then raise exception 'booking_invalid_range'; end if;
 return coalesce((select jsonb_agg(public.booking_view(b)||jsonb_build_object('patient_id',b.patient_id,'patient_name',(select display_name from public.profiles where id=b.patient_id)) order by b.starts_at,b.id)
  from public.calendar_affected(p_starts,p_ends,p_therapist) b),'[]'::jsonb);
end $$;

create function public.scheduler_time_off() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform public.require_scheduler();
 return coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'therapist_id',o.therapist_id,'therapist_name',p.display_name,'starts_at',o.starts_at,'ends_at',o.ends_at,'reason',o.reason) order by o.starts_at,o.id)
  from public.therapist_time_off o join public.profiles p on p.id=o.therapist_id where o.ends_at>now()),'[]'::jsonb);
end $$;

create function public.scheduler_save_time_off(p_id uuid,p_therapist uuid,p_starts timestamptz,p_ends timestamptz,p_reason text,p_resolutions jsonb default '[]'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare saved public.therapist_time_off; why text;
begin
 perform public.require_scheduler();
 why:=public.booking_reason(p_reason);
 if p_starts is null or p_ends is null or p_ends<=p_starts then raise exception 'booking_invalid_range'; end if;
 if not exists(select 1 from public.profiles p join public.user_roles r on r.user_id=p.id and r.role='therapist' where p.id=p_therapist and p.active) then raise exception 'booking_therapist_unavailable'; end if;
 perform pg_advisory_xact_lock(724020);
 if p_id is null then
  insert into public.therapist_time_off(therapist_id,starts_at,ends_at,reason,created_by) values(p_therapist,p_starts,p_ends,why,auth.uid()) returning * into saved;
 else
  update public.therapist_time_off set therapist_id=p_therapist,starts_at=p_starts,ends_at=p_ends,reason=why,updated_at=now() where id=p_id returning * into saved;
  if not found then raise exception 'booking_unavailable'; end if;
 end if;
 perform public.calendar_resolve(p_starts,p_ends,p_resolutions,p_therapist);
 return to_jsonb(saved);
end $$;

create function public.scheduler_delete_time_off(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.require_scheduler();
 perform pg_advisory_xact_lock(724020);
 delete from public.therapist_time_off where id=p_id;
 if not found then raise exception 'booking_unavailable'; end if;
end $$;

-- A therapist's own schedule says when they are away, without the reason.
create or replace function public.schedule_layout(p_from date,p_to date,p_owner uuid,p_therapist boolean) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare settings public.center_settings; hours public.center_hours; day date; holiday text; step interval; opens timestamptz; closes timestamptz;
 grid timestamptz[]; entries jsonb; days jsonb:='[]'::jsonb; day_status text; day_start timestamptz; day_end timestamptz;
begin
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>62 then raise exception 'booking_invalid_range'; end if;
 select * into strict settings from public.center_settings;
 step:=make_interval(mins=>settings.slot_minutes);
 for day in select generate_series(p_from,p_to,interval '1 day')::date loop
  grid:='{}';
  day_start:=day::timestamp at time zone settings.time_zone;
  day_end:=(day+1)::timestamp at time zone settings.time_zone;
  select name into holiday from public.center_holidays where day between starts_on and ends_on order by starts_on,name limit 1;
  select * into hours from public.center_hours where weekday=extract(isodow from day)::integer;
  if not found or not hours.is_open then day_status:='closed';
  elsif holiday is not null then day_status:='holiday';
  else
   opens:=(day+hours.opens_at) at time zone settings.time_zone;
   closes:=(day+hours.closes_at) at time zone settings.time_zone;
   -- A time the center has closed is no longer part of its hours.
   select coalesce(array_agg(slot order by slot),'{}') into grid from generate_series(opens,closes-step,step) slot
    where not exists(select 1 from public.center_closures where starts_at<slot+step and ends_at>slot);
   day_status:=case when cardinality(grid)>0 then 'open' when opens+step<=closes then 'closure' else 'closed' end;
  end if;
  -- A session always shows, even if the hours around it have changed since it was confirmed.
  select coalesce(jsonb_agg(entry.body order by entry.moment),'[]'::jsonb) into entries from (
   select b.starts_at as moment,jsonb_build_object('starts_at',b.starts_at,'ends_at',b.ends_at,'on_leave',false,'session',public.schedule_view(b,p_therapist)) as body
   from public.bookings b
   where case when p_therapist then b.therapist_id else b.patient_id end=p_owner and b.status in ('confirmed','rescheduled')
    and b.starts_at>=day_start and b.starts_at<day_end
   union all
   select slot,jsonb_build_object('starts_at',slot,'ends_at',slot+step,'session',null,
    'on_leave',p_therapist and exists(select 1 from public.therapist_time_off o where o.therapist_id=p_owner and o.starts_at<slot+step and o.ends_at>slot))
   from unnest(grid) slot
   where not exists(select 1 from public.bookings b where case when p_therapist then b.therapist_id else b.patient_id end=p_owner
    and b.status in ('confirmed','rescheduled') and b.starts_at<slot+step and b.ends_at>slot)
  ) entry;
  days:=days||jsonb_build_object('date',day,'status',day_status,'holiday',holiday,'rows',entries,
   'on_leave',p_therapist and exists(select 1 from public.therapist_time_off o where o.therapist_id=p_owner and o.starts_at<day_end and o.ends_at>day_start));
 end loop;
 return jsonb_build_object('time_zone',settings.time_zone,'days',days);
end $$;

revoke all on function public.calendar_affected(timestamptz,timestamptz,uuid),public.calendar_resolve(timestamptz,timestamptz,jsonb,uuid),public.scheduler_calendar_impact(timestamptz,timestamptz,uuid),
 public.scheduler_time_off(),public.scheduler_save_time_off(uuid,uuid,timestamptz,timestamptz,text,jsonb),public.scheduler_delete_time_off(uuid) from public,anon,authenticated;
grant execute on function public.scheduler_calendar_impact(timestamptz,timestamptz,uuid),public.scheduler_time_off(),public.scheduler_save_time_off(uuid,uuid,timestamptz,timestamptz,text,jsonb),public.scheduler_delete_time_off(uuid) to authenticated;
