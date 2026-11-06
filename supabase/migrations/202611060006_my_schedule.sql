-- What a Scheduler has confirmed, laid out by time. The server builds each day, so the web and Android cannot disagree about one.
-- Nothing here opens a clinical record: can_read_patient is unchanged, and a therapist only learns whether a link already exists.

-- A patient's own view of a session names the therapist. A therapist's view names the patient, and no more than a schedule needs.
create function public.schedule_view(b public.bookings,p_therapist boolean) returns jsonb language sql stable security definer set search_path='' as $$
 select case when p_therapist then jsonb_build_object('id',b.id,'reference_no',b.reference_no,'status',b.status,'starts_at',b.starts_at,'ends_at',b.ends_at,
   'attendance',b.attendance,'location',(select location from public.center_settings),'patient_id',b.patient_id,
   'patient_name',(select display_name from public.profiles where id=b.patient_id),
   'linked',exists(select 1 from public.therapist_patients where therapist_id=b.therapist_id and patient_id=b.patient_id and active))
  else public.my_booking_view(b) end
$$;

create function public.schedule_layout(p_from date,p_to date,p_owner uuid,p_therapist boolean) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare settings public.center_settings; hours public.center_hours; day date; holiday text; step interval; opens timestamptz; closes timestamptz;
 grid timestamptz[]; entries jsonb; days jsonb:='[]'::jsonb; day_status text;
begin
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>62 then raise exception 'booking_invalid_range'; end if;
 select * into strict settings from public.center_settings;
 step:=make_interval(mins=>settings.slot_minutes);
 for day in select generate_series(p_from,p_to,interval '1 day')::date loop
  grid:='{}';
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
   select b.starts_at as moment,jsonb_build_object('starts_at',b.starts_at,'ends_at',b.ends_at,'session',public.schedule_view(b,p_therapist)) as body
   from public.bookings b
   where case when p_therapist then b.therapist_id else b.patient_id end=p_owner and b.status in ('confirmed','rescheduled')
    and b.starts_at>=(day::timestamp at time zone settings.time_zone) and b.starts_at<((day+1)::timestamp at time zone settings.time_zone)
   union all
   select slot,jsonb_build_object('starts_at',slot,'ends_at',slot+step,'session',null)
   from unnest(grid) slot
   where not exists(select 1 from public.bookings b where case when p_therapist then b.therapist_id else b.patient_id end=p_owner
    and b.status in ('confirmed','rescheduled') and b.starts_at<slot+step and b.ends_at>slot)
  ) entry;
  days:=days||jsonb_build_object('date',day,'status',day_status,'holiday',holiday,'rows',entries);
 end loop;
 return jsonb_build_object('time_zone',settings.time_zone,'days',days);
end $$;

create function public.my_schedule(p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.has_role('patient') then raise exception 'Patient access required' using errcode='42501'; end if;
 return public.schedule_layout(p_from,p_to,auth.uid(),false);
end $$;

create function public.therapist_schedule(p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.has_role('therapist') then raise exception 'Therapist access required' using errcode='42501'; end if;
 return public.schedule_layout(p_from,p_to,auth.uid(),true);
end $$;

revoke all on function public.schedule_view(public.bookings,boolean),public.schedule_layout(date,date,uuid,boolean),public.my_schedule(date,date),public.therapist_schedule(date,date) from public,anon,authenticated;
grant execute on function public.my_schedule(date,date),public.therapist_schedule(date,date) to authenticated;
