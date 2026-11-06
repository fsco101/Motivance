-- How a Scheduler runs the center's calendar, and how a closure or holiday is kept from stranding a booking.

-- Sessions still to come inside a stretch of time. One that has already ended needs no decision.
create function public.calendar_affected(p_starts timestamptz,p_ends timestamptz) returns setof public.bookings
language sql stable security definer set search_path='' as $$
 select * from public.bookings where status in ('pending','confirmed','rescheduled') and starts_at<p_ends and ends_at>p_starts and ends_at>now() order by starts_at,id
$$;

-- A date range as the center reads it: from midnight on the first day to midnight after the last.
create function public.center_day_start(p_day date) returns timestamptz language sql stable security definer set search_path='' as $$
 select p_day::timestamp at time zone (select time_zone from public.center_settings)
$$;

-- Every affected booking needs exactly one decision, and only those bookings. The caller saves the closure or holiday first,
-- so a new time inside it is refused by the same rules as any other, and any failure undoes the whole save.
create function public.calendar_resolve(p_starts timestamptz,p_ends timestamptz,p_resolutions jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare decisions jsonb:=coalesce(p_resolutions,'[]'::jsonb); item jsonb; decided uuid[]; affected uuid[];
begin
 if jsonb_typeof(decisions)<>'array' then raise exception 'booking_invalid'; end if;
 select coalesce(array_agg((value->>'booking')::uuid),'{}') into decided from jsonb_array_elements(decisions);
 select coalesce(array_agg(id),'{}') into affected from public.calendar_affected(p_starts,p_ends);
 if not affected<@decided then raise exception 'booking_unresolved'; end if;
 if not decided<@affected or cardinality(decided)<>cardinality(affected) then raise exception 'booking_invalid'; end if;
 for item in select value from jsonb_array_elements(decisions) loop
  case item->>'action'
   when 'cancel' then perform public.scheduler_cancel((item->>'booking')::uuid,item->>'reason');
   when 'reschedule' then perform public.scheduler_reschedule((item->>'booking')::uuid,(item->>'starts_at')::timestamptz,(item->>'therapist')::uuid,item->>'reason');
   else raise exception 'booking_invalid';
  end case;
 end loop;
 return cardinality(decided);
end $$;

-- What the page must list before a closure or holiday can be saved.
create function public.scheduler_calendar_impact(p_starts timestamptz,p_ends timestamptz) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform public.require_scheduler();
 if p_starts is null or p_ends is null or p_ends<=p_starts then raise exception 'booking_invalid_range'; end if;
 return coalesce((select jsonb_agg(public.booking_view(b)||jsonb_build_object('patient_id',b.patient_id,'patient_name',(select display_name from public.profiles where id=b.patient_id)) order by b.starts_at,b.id)
  from public.calendar_affected(p_starts,p_ends) b),'[]'::jsonb);
end $$;

create function public.scheduler_save_closure(p_id uuid,p_starts timestamptz,p_ends timestamptz,p_all_day boolean,p_reason text,p_resolutions jsonb default '[]'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare saved public.center_closures; why text;
begin
 perform public.require_scheduler();
 why:=public.booking_reason(p_reason);
 if p_starts is null or p_ends is null or p_ends<=p_starts then raise exception 'booking_invalid_range'; end if;
 perform pg_advisory_xact_lock(724020);
 if p_id is null then
  insert into public.center_closures(starts_at,ends_at,all_day,reason,created_by) values(p_starts,p_ends,coalesce(p_all_day,false),why,auth.uid()) returning * into saved;
 else
  update public.center_closures set starts_at=p_starts,ends_at=p_ends,all_day=coalesce(p_all_day,false),reason=why,updated_at=now() where id=p_id returning * into saved;
  if not found then raise exception 'booking_unavailable'; end if;
 end if;
 perform public.calendar_resolve(p_starts,p_ends,p_resolutions);
 return to_jsonb(saved);
end $$;

create function public.scheduler_delete_closure(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.require_scheduler();
 perform pg_advisory_xact_lock(724020);
 delete from public.center_closures where id=p_id;
 if not found then raise exception 'booking_unavailable'; end if;
end $$;

create function public.scheduler_save_holiday(p_id uuid,p_name text,p_kind text,p_starts_on date,p_ends_on date,p_resolutions jsonb default '[]'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare saved public.center_holidays; title text:=trim(coalesce(p_name,''));
begin
 perform public.require_scheduler();
 if length(title) not between 1 and 120 or p_kind is null or p_kind not in ('regular','special','seasonal') then raise exception 'booking_invalid'; end if;
 if p_starts_on is null or p_ends_on is null or p_ends_on<p_starts_on then raise exception 'booking_invalid_range'; end if;
 perform pg_advisory_xact_lock(724020);
 if p_id is null then
  insert into public.center_holidays(name,kind,starts_on,ends_on,created_by) values(title,p_kind,p_starts_on,p_ends_on,auth.uid()) returning * into saved;
 else
  update public.center_holidays set name=title,kind=p_kind,starts_on=p_starts_on,ends_on=p_ends_on,updated_at=now() where id=p_id returning * into saved;
  if not found then raise exception 'booking_unavailable'; end if;
 end if;
 perform public.calendar_resolve(public.center_day_start(p_starts_on),public.center_day_start(p_ends_on+1),p_resolutions);
 return to_jsonb(saved);
end $$;

create function public.scheduler_delete_holiday(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.require_scheduler();
 perform pg_advisory_xact_lock(724020);
 delete from public.center_holidays where id=p_id;
 if not found then raise exception 'booking_unavailable'; end if;
end $$;

-- A session already confirmed keeps its time when the hours change, so the page is told how many now fall outside them.
create function public.calendar_outside_hours() returns integer language sql stable security definer set search_path='' as $$
 select count(*)::integer from public.bookings where status in ('pending','confirmed','rescheduled') and ends_at>now() and public.center_problem(starts_at,ends_at) in ('closed_day','outside_hours')
$$;

create function public.scheduler_save_hours(p_hours jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb;
begin
 perform public.require_scheduler();
 if p_hours is null or jsonb_typeof(p_hours)<>'array' or jsonb_array_length(p_hours)<>7 then raise exception 'booking_invalid'; end if;
 perform pg_advisory_xact_lock(724020);
 begin
  if (select count(distinct (value->>'weekday')::integer) from jsonb_array_elements(p_hours))<>7 then raise exception 'booking_invalid'; end if;
  for item in select value from jsonb_array_elements(p_hours) loop
   update public.center_hours set is_open=(item->>'is_open')::boolean,opens_at=(item->>'opens_at')::time,closes_at=(item->>'closes_at')::time where weekday=(item->>'weekday')::integer;
   if not found then raise exception 'booking_invalid'; end if;
  end loop;
 exception when check_violation or invalid_datetime_format or datetime_field_overflow or invalid_text_representation then raise exception 'booking_invalid';
 end;
 return jsonb_build_object('outside_hours',public.calendar_outside_hours());
end $$;

create function public.scheduler_save_settings(p_center_name text,p_location text,p_slot_minutes integer,p_slot_capacity integer,p_cancel_cutoff_hours integer,p_reschedule_cutoff_hours integer,
 p_minimum_notice_hours integer,p_booking_horizon_days integer,p_max_active_bookings integer,p_max_self_reschedules integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare saved public.center_settings;
begin
 perform public.require_scheduler();
 perform pg_advisory_xact_lock(724020);
 begin
  update public.center_settings set center_name=trim(p_center_name),location=trim(coalesce(p_location,'')),slot_minutes=p_slot_minutes,slot_capacity=p_slot_capacity,
   cancel_cutoff_hours=p_cancel_cutoff_hours,reschedule_cutoff_hours=p_reschedule_cutoff_hours,minimum_notice_hours=p_minimum_notice_hours,booking_horizon_days=p_booking_horizon_days,
   max_active_bookings=p_max_active_bookings,max_self_reschedules=p_max_self_reschedules,updated_by=auth.uid(),updated_at=now() where id returning * into saved;
 exception when check_violation or not_null_violation then raise exception 'booking_invalid';
 end;
 return to_jsonb(saved);
end $$;

revoke all on function public.calendar_affected(timestamptz,timestamptz),public.center_day_start(date),public.calendar_resolve(timestamptz,timestamptz,jsonb),public.calendar_outside_hours(),
 public.scheduler_calendar_impact(timestamptz,timestamptz),public.scheduler_save_closure(uuid,timestamptz,timestamptz,boolean,text,jsonb),public.scheduler_delete_closure(uuid),
 public.scheduler_save_holiday(uuid,text,text,date,date,jsonb),public.scheduler_delete_holiday(uuid),public.scheduler_save_hours(jsonb),
 public.scheduler_save_settings(text,text,integer,integer,integer,integer,integer,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.scheduler_calendar_impact(timestamptz,timestamptz),public.scheduler_save_closure(uuid,timestamptz,timestamptz,boolean,text,jsonb),public.scheduler_delete_closure(uuid),
 public.scheduler_save_holiday(uuid,text,text,date,date,jsonb),public.scheduler_delete_holiday(uuid),public.scheduler_save_hours(jsonb),
 public.scheduler_save_settings(text,text,integer,integer,integer,integer,integer,integer,integer,integer) to authenticated;
