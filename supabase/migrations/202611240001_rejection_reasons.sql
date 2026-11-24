-- #172: a Scheduler rejects a request with one of the center's common reasons, or with their own words ("Other").
-- A common reason is stored as a code, like the server's own request_expired, so each app, the email and the push show it in the
-- patient's language. An optional note may go with a common reason, and the patient sees it word for word (owner's decision,
-- 2026-11-24). Free text keeps the 3-300 character rule. Older clients that send only p_reason keep working as "Other".

alter table public.bookings add column status_note text check(length(status_note)<=300);
alter table public.booking_events add column note text check(length(note)<=300);

-- The common reasons, in the order a Scheduler sees them. The apps hold the same list with its words.
create function public.rejection_codes() returns text[] language sql immutable set search_path='' as $$
 select array['slot_unavailable','therapist_away','outside_hours','duplicate_request','call_center']
$$;

-- The reason and note to store: a known code with an optional note, or "Other" with the Scheduler's own words and no note.
create function public.rejection(p_code text,p_reason text,p_note text,out reason text,out note text) language plpgsql immutable set search_path='' as $$
begin
 if coalesce(p_code,'other')='other' then
  reason:=public.booking_reason(p_reason);
  note:=null;
 elsif p_code=any(public.rejection_codes()) then
  reason:=p_code;
  note:=nullif(trim(coalesce(p_note,'')),'');
  if length(note)>300 then raise exception 'booking_note_too_long'; end if;
 else raise exception 'booking_reason_unknown';
 end if;
end $$;

create or replace function public.record_booking_event() returns trigger language plpgsql security definer set search_path='' as $$
declare what text; actor uuid:=auth.uid(); acting text;
begin
 if tg_op='INSERT' then what:=case when new.series_id is null then 'requested' else 'series_booked' end;
 elsif new.starts_at is distinct from old.starts_at then what:='rescheduled';
 elsif new.status is distinct from old.status then what:=case when new.status='pending' then 'returned_to_pending' else new.status end;
 elsif new.therapist_id is distinct from old.therapist_id then what:='therapist_changed';
 elsif new.attendance is distinct from old.attendance then what:='attendance_marked';
 else return new;
 end if;
 acting:=case when actor is null then 'system' when actor=new.patient_id then 'patient' when public.has_role('scheduler') then 'scheduler'
  when public.has_role('admin') then 'admin' when public.has_role('therapist') then 'therapist' else 'system' end;
 insert into public.booking_events(booking_id,actor_id,actor_role,action,from_status,to_status,from_starts_at,to_starts_at,from_therapist,to_therapist,reason,note,from_attendance,to_attendance)
 values(new.id,actor,acting,what,old.status,new.status,old.starts_at,new.starts_at,old.therapist_id,new.therapist_id,new.status_reason,new.status_note,old.attendance,new.attendance);
 insert into public.audit_events(actor_id,action,target_type,target_id) values(actor,what,'bookings',new.id::text);
 return new;
end $$;

create or replace function public.notify_booking_event() returns trigger language plpgsql security definer set search_path='' as $$
declare b public.bookings; facts jsonb; patient jsonb; moved boolean; was uuid:=new.from_therapist; now_with uuid:=new.to_therapist;
begin
 select * into strict b from public.bookings where id=new.booking_id;
 if new.action='cancelled' and exists(select 1 from public.booking_series s where s.id=b.series_id and s.cancelled_at is not null) then return new; end if;
 facts:=jsonb_build_object('reference_no',b.reference_no,'starts_at',b.starts_at,'ends_at',b.ends_at,'previous_starts_at',new.from_starts_at,
  'patient_name',(select display_name from public.profiles where id=b.patient_id),'therapist_name',(select display_name from public.profiles where id=b.therapist_id));
 -- A Scheduler's reason is written for the patient, and a therapist's reason for being away never reaches anyone here.
 patient:=facts||jsonb_build_object('reason',new.reason,'note',new.note);
 moved:=was is distinct from now_with;
 case new.action
  when 'requested' then perform public.notify_schedulers('request_received',b.id,facts,new.id,new.actor_id);
  when 'confirmed' then
   perform public.notify(b.patient_id,'confirmed',b.id,patient,new.id,new.actor_id);
   perform public.notify(now_with,'session_assigned',b.id,facts,new.id,new.actor_id);
  when 'rejected' then perform public.notify(b.patient_id,'rejected',b.id,patient,new.id,new.actor_id);
  when 'cancelled' then
   if new.actor_role='patient' then perform public.notify_schedulers('patient_cancelled',b.id,facts,new.id,new.actor_id);
   else perform public.notify(b.patient_id,'cancelled',b.id,patient,new.id,new.actor_id);
   end if;
   perform public.notify(was,'session_cancelled',b.id,facts,new.id,new.actor_id);
  when 'rescheduled' then
   if new.actor_role='patient' then
    perform public.notify_schedulers('patient_rescheduled',b.id,facts,new.id,new.actor_id);
    if moved then perform public.notify(was,'session_removed',b.id,facts,new.id,new.actor_id);
    else perform public.notify(now_with,'patient_rescheduled',b.id,facts,new.id,new.actor_id);
    end if;
   else
    perform public.notify(b.patient_id,'rescheduled',b.id,patient,new.id,new.actor_id);
    if moved then
     perform public.notify(was,'session_removed',b.id,facts,new.id,new.actor_id);
     perform public.notify(now_with,'session_assigned',b.id,facts,new.id,new.actor_id);
    else perform public.notify(now_with,'session_moved',b.id,facts,new.id,new.actor_id);
    end if;
   end if;
  when 'therapist_changed' then
   perform public.notify(b.patient_id,'therapist_changed',b.id,patient,new.id,new.actor_id);
   perform public.notify(was,'session_removed',b.id,facts,new.id,new.actor_id);
   perform public.notify(now_with,'session_assigned',b.id,facts,new.id,new.actor_id);
  when 'returned_to_pending' then
   perform public.notify(b.patient_id,'returned_to_pending',b.id,patient,new.id,new.actor_id);
   perform public.notify_schedulers('needs_therapist',b.id,facts,new.id,new.actor_id);
  else null;
 end case;
 return new;
end $$;

create or replace function public.booking_view(b public.bookings) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',b.id,'reference_no',b.reference_no,'status',b.status,'status_reason',b.status_reason,'status_note',b.status_note,'starts_at',b.starts_at,'ends_at',b.ends_at,
  'previous_starts_at',b.previous_starts_at,'therapist_id',b.therapist_id,'therapist_name',(select display_name from public.profiles where id=b.therapist_id),
  'therapist_photo',(select photo_url from public.profiles where id=b.therapist_id),
  'patient_name',(select display_name from public.profiles where id=b.patient_id),'patient_photo',(select photo_url from public.profiles where id=b.patient_id),
  'visit_reason',b.visit_reason,'attendance',b.attendance,'created_at',b.created_at)
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
    'from_starts_at',e.from_starts_at,'to_starts_at',e.to_starts_at,'reason',e.reason,'note',e.note,'to_attendance',e.to_attendance,'recorded_at',e.recorded_at) order by e.id desc)
   from public.booking_events e left join public.profiles a on a.id=e.actor_id where e.booking_id=target.id),'[]'::jsonb));
end $$;

drop function public.scheduler_reject(uuid,text);
create function public.scheduler_reject(p_booking uuid,p_reason text default null,p_code text default 'other',p_note text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare target public.bookings; given record;
begin
 perform public.require_scheduler();
 given:=public.rejection(p_code,p_reason,p_note);
 perform pg_advisory_xact_lock(724020);
 select * into target from public.bookings where id=p_booking for update;
 if not found then raise exception 'booking_unavailable'; end if;
 if target.status<>'pending' then raise exception 'booking_state'; end if;
 update public.bookings set status='rejected',status_reason=given.reason,status_note=given.note where id=target.id returning * into target;
 return public.booking_view(target);
end $$;

-- Only pending requests change, so a booking confirmed in the meantime is left alone. Returns how many were rejected.
drop function public.scheduler_bulk_reject(uuid[],text);
create function public.scheduler_bulk_reject(p_bookings uuid[],p_reason text default null,p_code text default 'other',p_note text default null) returns integer
language plpgsql security definer set search_path='' as $$
declare given record; changed integer;
begin
 perform public.require_scheduler();
 given:=public.rejection(p_code,p_reason,p_note);
 if p_bookings is null or cardinality(p_bookings) not between 1 and 500 then raise exception 'booking_invalid'; end if;
 perform pg_advisory_xact_lock(724020);
 update public.bookings set status='rejected',status_reason=given.reason,status_note=given.note where id=any(p_bookings) and status='pending';
 get diagnostics changed=row_count;
 return changed;
end $$;

revoke all on function public.rejection_codes(),public.rejection(text,text,text) from public,anon,authenticated;
revoke all on function public.scheduler_reject(uuid,text,text,text),public.scheduler_bulk_reject(uuid[],text,text,text) from public,anon;
grant execute on function public.scheduler_reject(uuid,text,text,text),public.scheduler_bulk_reject(uuid[],text,text,text) to authenticated;
