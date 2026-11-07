-- The numbers a Scheduler opens on. Each one counts what the page it opens lists, so following a figure never contradicts it.
create function public.scheduler_summary() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare settings public.center_settings; hours public.center_hours; today date; monday date; day date; slot timestamptz; closes timestamptz; step interval; places integer:=0; booked integer;
begin
 perform public.require_scheduler();
 select * into strict settings from public.center_settings;
 today:=(now() at time zone settings.time_zone)::date;
 monday:=today-(extract(isodow from today)::integer-1);
 step:=make_interval(mins=>settings.slot_minutes);
 -- The whole week, days already gone included, so the figure does not shrink as the week passes.
 for day in select generate_series(monday,monday+6,interval '1 day')::date loop
  select * into hours from public.center_hours where weekday=extract(isodow from day)::integer;
  continue when not found or not hours.is_open;
  slot:=(day+hours.opens_at) at time zone settings.time_zone;
  closes:=(day+hours.closes_at) at time zone settings.time_zone;
  while slot+step<=closes loop
   if public.center_problem(slot,slot+step) is null then places:=places+settings.slot_capacity; end if;
   slot:=slot+step;
  end loop;
 end loop;
 -- Only sessions in an open slot, so a session left outside changed hours cannot count against places it does not use.
 select count(*) into booked from public.bookings b where b.status in ('confirmed','rescheduled')
  and b.starts_at>=public.center_day_start(monday) and b.starts_at<public.center_day_start(monday+7) and public.center_problem(b.starts_at,b.ends_at) is null;
 return jsonb_build_object(
  'pending',(select count(*) from public.bookings where status='pending'),
  'today',(select count(*) from public.bookings where status in ('confirmed','rescheduled') and starts_at>=public.center_day_start(today) and starts_at<public.center_day_start(today+1)),
  'booked',booked,'places',places,'utilization',case when places>0 then round(100.0*booked/places)::integer end,
  'date',today,'week_from',monday,'week_to',monday+6);
end $$;

revoke all on function public.scheduler_summary() from public,anon,authenticated;
grant execute on function public.scheduler_summary() to authenticated;
