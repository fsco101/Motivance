-- What a patient sees of their own bookings. The server works out whether a booking can still be cancelled and until when,
-- so the web and Android cannot drift apart on the rule, and the clients have nothing to recompute.
create function public.my_booking_view(b public.bookings) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare settings public.center_settings; cancel_until timestamptz;
begin
 select * into strict settings from public.center_settings;
 cancel_until:=b.starts_at-make_interval(hours=>settings.cancel_cutoff_hours);
 return public.booking_view(b)||jsonb_build_object('location',settings.location,'cancel_until',cancel_until,
  'can_cancel',b.status in ('pending','confirmed','rescheduled') and cancel_until>now());
end $$;

create function public.my_bookings() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.has_role('patient') then raise exception 'Patient access required' using errcode='42501'; end if;
 select coalesce(jsonb_agg(public.my_booking_view(b) order by b.starts_at desc),'[]'::jsonb) into result
 from (select * from public.bookings where patient_id=auth.uid() order by starts_at desc limit 200) b;
 return result;
end $$;

-- The same dates and slots as before, each slot now saying whether the caller already holds a booking at that time.
create or replace function public.booking_availability(p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare settings public.center_settings; hours public.center_hours; today date; earliest timestamptz; latest timestamptz; step interval;
 day date; holiday text; slot timestamptz; closes timestamptz; slots jsonb; days jsonb:='[]'::jsonb; day_status text; closed boolean; soon boolean; far boolean;
begin
 if not public.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>62 then raise exception 'booking_invalid_range'; end if;
 select * into strict settings from public.center_settings;
 today:=(now() at time zone settings.time_zone)::date;
 earliest:=now()+make_interval(hours=>settings.minimum_notice_hours);
 latest:=now()+make_interval(days=>settings.booking_horizon_days);
 step:=make_interval(mins=>settings.slot_minutes);
 for day in select generate_series(p_from,p_to,interval '1 day')::date loop
  slots:='[]'::jsonb; closed:=false; soon:=false; far:=false;
  select name into holiday from public.center_holidays where day between starts_on and ends_on order by starts_on,name limit 1;
  select * into hours from public.center_hours where weekday=extract(isodow from day)::integer;
  if day<today then day_status:='past';
  elsif not found or not hours.is_open then day_status:='closed';
  elsif holiday is not null then day_status:='holiday';
  else
   slot:=(day+hours.opens_at) at time zone settings.time_zone;
   closes:=(day+hours.closes_at) at time zone settings.time_zone;
   while slot+step<=closes loop
    if slot<=now() or slot<earliest then soon:=true;
    elsif slot>latest then far:=true;
    elsif exists(select 1 from public.center_closures where starts_at<slot+step and ends_at>slot) then closed:=true;
    else slots:=slots||jsonb_build_object('starts_at',slot,'ends_at',slot+step,'remaining',greatest(settings.slot_capacity-public.slot_load(slot,slot+step),0),
     'mine',exists(select 1 from public.bookings where patient_id=auth.uid() and status in ('pending','confirmed','rescheduled') and starts_at<slot+step and ends_at>slot));
    end if;
    slot:=slot+step;
   end loop;
   day_status:=case when jsonb_array_length(slots)>0 then 'open' when closed then 'closure' when far then 'too_far' when soon then 'too_soon' else 'closed' end;
  end if;
  days:=days||jsonb_build_object('date',day,'status',day_status,'holiday',holiday,'slots',slots);
 end loop;
 return jsonb_build_object('time_zone',settings.time_zone,'slot_minutes',settings.slot_minutes,'days',days);
end $$;

revoke all on function public.my_booking_view(public.bookings),public.my_bookings() from public,anon,authenticated;
grant execute on function public.my_bookings() to authenticated;
