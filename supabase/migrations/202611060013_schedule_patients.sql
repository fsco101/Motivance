-- The schedule's patient filter offers the people on the schedule. scheduler_patients is a search box capped at 50, so as a list it would
-- silently leave patients out, and it hides disabled accounts whose confirmed sessions are still on the schedule.
create function public.scheduler_schedule_patients() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform public.require_scheduler();
 return coalesce((select jsonb_agg(to_jsonb(a) order by lower(a.name),a.id) from (
  select distinct p.id,p.display_name as name
  from public.bookings b join public.profiles p on p.id=b.patient_id
  where b.status in ('confirmed','rescheduled')
 ) a),'[]'::jsonb);
end $$;

revoke all on function public.scheduler_schedule_patients() from public,anon,authenticated;
grant execute on function public.scheduler_schedule_patients() to authenticated;
