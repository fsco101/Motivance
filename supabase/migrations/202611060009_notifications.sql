-- What changed, for the people it matters to. A row holds facts, not sentences: each app writes the text in its reader's language,
-- and reads the time in the center's zone.
create table public.notifications (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id),
 kind text not null check(kind in (
  'confirmed','rejected','cancelled','rescheduled','therapist_changed','returned_to_pending',
  'session_assigned','session_moved','session_cancelled','session_removed',
  'request_received','patient_cancelled','needs_therapist')),
 booking_id uuid references public.bookings(id),
 data jsonb not null default '{}'::jsonb,
 read_at timestamptz,
 -- One event can reach a person once, however a retry happens.
 dedupe_key text not null,
 created_at timestamptz not null default now(),
 unique(user_id,dedupe_key)
);
create index notifications_inbox on public.notifications(user_id,created_at desc);
alter table public.notifications enable row level security;
revoke all on public.notifications from anon,authenticated;
grant select on public.notifications to authenticated;
create policy read_own_notifications on public.notifications for select to authenticated using (user_id=auth.uid());

create function public.notify(p_user uuid,p_kind text,p_booking uuid,p_data jsonb,p_event bigint,p_actor uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 -- Nobody needs telling what they have just done themselves.
 if p_user is null or p_user is not distinct from p_actor then return; end if;
 insert into public.notifications(user_id,kind,booking_id,data,dedupe_key) values(p_user,p_kind,p_booking,p_data,p_kind||':'||p_event) on conflict(user_id,dedupe_key) do nothing;
end $$;

create function public.notify_schedulers(p_kind text,p_booking uuid,p_data jsonb,p_event bigint,p_actor uuid) returns void
language plpgsql security definer set search_path='' as $$
declare person uuid;
begin
 for person in select p.id from public.profiles p join public.user_roles r on r.user_id=p.id and r.role='scheduler' where p.active loop
  perform public.notify(person,p_kind,p_booking,p_data,p_event,p_actor);
 end loop;
end $$;

-- Every change to a booking is recorded in booking_events, however it was made, so this cannot be skipped by a new way of changing one.
create function public.notify_booking_event() returns trigger language plpgsql security definer set search_path='' as $$
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
   perform public.notify(b.patient_id,'rescheduled',b.id,patient,new.id,new.actor_id);
   if moved then
    perform public.notify(was,'session_removed',b.id,facts,new.id,new.actor_id);
    perform public.notify(now_with,'session_assigned',b.id,facts,new.id,new.actor_id);
   else perform public.notify(now_with,'session_moved',b.id,facts,new.id,new.actor_id);
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
create trigger notify_booking_event after insert on public.booking_events for each row execute function public.notify_booking_event();

create function public.my_notifications(p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 return jsonb_build_object(
  'unread',(select count(*) from public.notifications where user_id=auth.uid() and read_at is null),
  'rows',coalesce((select jsonb_agg(to_jsonb(n)-'user_id'-'dedupe_key' order by n.created_at desc,n.id) from
   (select * from public.notifications where user_id=auth.uid() order by created_at desc,id limit least(greatest(coalesce(p_limit,50),1),200)) n),'[]'::jsonb));
end $$;

-- With no list, everything. Only ever the caller's own, whatever IDs are sent.
create function public.mark_notifications_read(p_ids uuid[] default null) returns integer language plpgsql security definer set search_path='' as $$
begin
 if not public.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 update public.notifications set read_at=now() where user_id=auth.uid() and read_at is null and (p_ids is null or id=any(p_ids));
 return (select count(*) from public.notifications where user_id=auth.uid() and read_at is null);
end $$;

revoke all on function public.notify(uuid,text,uuid,jsonb,bigint,uuid),public.notify_schedulers(text,uuid,jsonb,bigint,uuid),public.notify_booking_event(),
 public.my_notifications(integer),public.mark_notifications_read(uuid[]) from public,anon,authenticated;
grant execute on function public.my_notifications(integer),public.mark_notifications_read(uuid[]) to authenticated;
