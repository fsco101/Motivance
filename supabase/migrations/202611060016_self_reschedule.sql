-- Patients move their own sessions, within the rules, without calling the center.
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check(kind in (
 'confirmed','rejected','cancelled','rescheduled','therapist_changed','returned_to_pending',
 'session_assigned','session_moved','session_cancelled','session_removed',
 'request_received','patient_cancelled','needs_therapist','reminder','session_reminder','place_open','patient_rescheduled'));

-- The server decides whether a session can still be moved and until when, as it does for cancelling, so the apps cannot drift apart on the rule.
create or replace function public.my_booking_view(b public.bookings) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare settings public.center_settings; cancel_until timestamptz; reschedule_until timestamptz; moves_left integer; active boolean;
begin
 select * into strict settings from public.center_settings;
 active:=b.status in ('pending','confirmed','rescheduled');
 cancel_until:=b.starts_at-make_interval(hours=>settings.cancel_cutoff_hours);
 reschedule_until:=b.starts_at-make_interval(hours=>settings.reschedule_cutoff_hours);
 moves_left:=greatest(settings.max_self_reschedules-b.self_reschedules,0);
 return public.booking_view(b)||jsonb_build_object('location',settings.location,'cancel_until',cancel_until,'can_cancel',active and cancel_until>now(),
  'reschedule_until',reschedule_until,'reschedules_left',moves_left,'can_reschedule',active and reschedule_until>now() and moves_left>0);
end $$;

-- A move is a new request for a new time: the same rules apply, and a Scheduler confirms it again. The therapist stays only if they are free then.
create function public.reschedule_my_booking(p_booking uuid,p_starts timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare settings public.center_settings; target public.bookings; problem text; ends timestamptz; therapist uuid;
begin
 if not public.has_role('patient') then raise exception 'Patient access required' using errcode='42501'; end if;
 if p_starts is null then raise exception 'booking_invalid'; end if;
 perform pg_advisory_xact_lock(724020);
 select * into target from public.bookings where id=p_booking and patient_id=auth.uid() for update;
 if not found then raise exception 'booking_unavailable'; end if;
 if target.status not in ('pending','confirmed','rescheduled') then raise exception 'booking_state'; end if;
 -- Already there, as after a retry when the first response was lost. Nothing changes and no move is used.
 if target.starts_at=p_starts then return public.my_booking_view(target); end if;
 select * into strict settings from public.center_settings;
 if target.starts_at-make_interval(hours=>settings.reschedule_cutoff_hours)<=now() then raise exception 'booking_reschedule_late'; end if;
 if target.self_reschedules>=settings.max_self_reschedules then raise exception 'booking_reschedule_limit'; end if;
 problem:=public.slot_problem(p_starts);
 if problem is not null then raise exception 'booking_%',problem; end if;
 ends:=p_starts+make_interval(mins=>settings.slot_minutes);
 perform public.booking_check_slot(p_starts,ends,target.id);
 perform public.booking_check_patient(auth.uid(),p_starts,ends,target.id);
 therapist:=target.therapist_id;
 if therapist is not null then
  begin
   perform public.booking_check_therapist(therapist,p_starts,ends,target.id);
  exception when raise_exception then
   therapist:=null;
  end;
 end if;
 update public.bookings set status='pending',therapist_id=therapist,previous_starts_at=target.starts_at,starts_at=p_starts,ends_at=ends,status_reason=null,
  self_reschedules=target.self_reschedules+1 where id=target.id returning * into target;
 return public.my_booking_view(target);
end $$;

-- A patient's move needs confirming, so a therapist hears the news without a calendar link: the new time is not theirs to plan around yet.
create or replace function public.notify_booking_event() returns trigger language plpgsql security definer set search_path='' as $$
declare b public.bookings; facts jsonb; patient jsonb; moved boolean; was uuid:=new.from_therapist; now_with uuid:=new.to_therapist;
begin
 select * into strict b from public.bookings where id=new.booking_id;
 facts:=jsonb_build_object('reference_no',b.reference_no,'starts_at',b.starts_at,'ends_at',b.ends_at,'previous_starts_at',new.from_starts_at,
  'patient_name',(select display_name from public.profiles where id=b.patient_id),'therapist_name',(select display_name from public.profiles where id=b.therapist_id));
 -- A Scheduler's reason is written for the patient, and a therapist's reason for being away never reaches anyone here.
 patient:=facts||jsonb_build_object('reason',new.reason);
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

revoke all on function public.reschedule_my_booking(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.reschedule_my_booking(uuid,timestamptz) to authenticated;
