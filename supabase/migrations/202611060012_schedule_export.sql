-- A confirmed schedule leaves the system as a file, so every export is on the record: who, which format and how many rows.
create function public.scheduler_log_export(p_format text,p_rows integer) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.require_scheduler();
 if p_format is null or p_format not in ('xlsx','pdf') or p_rows is null or p_rows<0 then raise exception 'booking_invalid'; end if;
 insert into public.audit_events(actor_id,action,target_type,target_id) values(auth.uid(),'export','bookings',p_format||':'||p_rows);
end $$;

revoke all on function public.scheduler_log_export(text,integer) from public,anon,authenticated;
grant execute on function public.scheduler_log_export(text,integer) to authenticated;
