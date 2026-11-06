-- Reminders before a session, and an end for requests nobody decided.
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check(kind in (
 'confirmed','rejected','cancelled','rescheduled','therapist_changed','returned_to_pending',
 'session_assigned','session_moved','session_cancelled','session_removed',
 'request_received','patient_cancelled','needs_therapist','reminder','session_reminder'));

create function public.enqueue_booking_reminders() returns integer language plpgsql security definer set search_path='' as $$
declare b public.bookings; label text; facts jsonb; reminder_key text; added integer; total integer:=0;
begin
 for b in select * from public.bookings where status in ('confirmed','rescheduled') and starts_at>now() and starts_at<=now()+interval '24 hours' order by starts_at,id loop
  label:=case when b.starts_at<=now()+interval '1 hour' then '1h' else '24h' end;
  -- The start time is in the key: a job that runs twice finds the key and sends nothing, and a session that moves has a new key.
  reminder_key:='reminder:'||label||':'||b.id||':'||extract(epoch from b.starts_at)::bigint;
  facts:=jsonb_build_object('reference_no',b.reference_no,'starts_at',b.starts_at,'ends_at',b.ends_at,'window',label,
   'patient_name',(select display_name from public.profiles where id=b.patient_id),'therapist_name',(select display_name from public.profiles where id=b.therapist_id));
  insert into public.notifications(user_id,kind,booking_id,data,dedupe_key) values(b.patient_id,'reminder',b.id,facts,reminder_key) on conflict(user_id,dedupe_key) do nothing;
  get diagnostics added=row_count;
  if b.therapist_id is not null then
   insert into public.notifications(user_id,kind,booking_id,data,dedupe_key) values(b.therapist_id,'session_reminder',b.id,facts,reminder_key) on conflict(user_id,dedupe_key) do nothing;
  end if;
  -- Kept with the booking's own history. The administrators' feed would only fill up with these.
  if added>0 then
   insert into public.booking_events(booking_id,actor_role,action,to_status,to_starts_at,to_therapist) values(b.id,'system','reminder_sent',b.status,b.starts_at,b.therapist_id);
   total:=total+1;
  end if;
 end loop;
 return total;
end $$;

-- The time has gone, so nobody can act on these. Rejecting them tells the patient, and leaves the audit log saying the system did it.
create function public.expire_stale_bookings() returns integer language plpgsql security definer set search_path='' as $$
declare expired integer;
begin
 perform pg_advisory_xact_lock(724020);
 update public.bookings set status='rejected',status_reason='request_expired' where status='pending' and starts_at<now();
 get diagnostics expired=row_count;
 return expired;
end $$;

revoke all on function public.enqueue_booking_reminders(),public.expire_stale_bookings() from public,anon,authenticated;
select cron.schedule('booking-reminders','*/5 * * * *','select public.enqueue_booking_reminders()');
select cron.schedule('expire-booking-requests','*/15 * * * *','select public.expire_stale_bookings()');
