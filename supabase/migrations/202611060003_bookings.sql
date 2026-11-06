-- Bookings. Every rule is enforced here, so two simultaneous requests cannot both succeed whatever a client does.
-- Exclusion constraints guard one patient and one therapist in the database itself. Capacity is a count, which a constraint
-- cannot express, so every booking change takes one transaction lock first: that also covers closures and settings.
-- Failures raise a stable booking_* message, which each app translates.
create extension if not exists btree_gist with schema extensions;
create sequence public.booking_reference;

create table public.bookings (
 id uuid primary key default gen_random_uuid(),
 reference_no text not null unique,
 patient_id uuid not null references public.patients(id),
 therapist_id uuid references public.profiles(id),
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 status text not null default 'pending' check(status in ('pending','confirmed','rejected','cancelled','rescheduled')),
 status_reason text check(length(status_reason)<=300),
 previous_starts_at timestamptz,
 attendance text check(attendance in ('attended','no_show')),
 attendance_by uuid references public.profiles(id),
 attendance_at timestamptz,
 self_reschedules smallint not null default 0 check(self_reschedules>=0),
 client_request_id uuid unique,
 calendar_token text not null unique default encode(extensions.gen_random_bytes(24),'hex'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(ends_at>starts_at),
 constraint bookings_no_patient_overlap exclude using gist(patient_id with =,tstzrange(starts_at,ends_at) with &&) where (status in ('pending','confirmed','rescheduled')),
 constraint bookings_no_therapist_overlap exclude using gist(therapist_id with =,tstzrange(starts_at,ends_at) with &&) where (therapist_id is not null and status in ('pending','confirmed','rescheduled'))
);
create index bookings_status_time on public.bookings(status,starts_at);
create index bookings_patient_time on public.bookings(patient_id,starts_at desc);
create index bookings_therapist_time on public.bookings(therapist_id,starts_at desc);

create table public.booking_events (
 id bigint generated always as identity primary key,
 booking_id uuid not null references public.bookings(id),
 actor_id uuid references public.profiles(id),
 actor_role text not null check(actor_role in ('patient','scheduler','therapist','admin','system')),
 action text not null,
 from_status text,
 to_status text,
 from_starts_at timestamptz,
 to_starts_at timestamptz,
 from_therapist uuid,
 to_therapist uuid,
 reason text,
 recorded_at timestamptz not null default now()
);
create index booking_events_booking on public.booking_events(booking_id,id);
create trigger immutable_booking_events before update or delete on public.booking_events for each row execute function public.reject_mutation();

-- No client reads or writes these tables: every path is a function below, which checks the caller and returns only what they may see.
alter table public.bookings enable row level security;
alter table public.booking_events enable row level security;
revoke all on public.bookings,public.booking_events from anon,authenticated;
revoke all on sequence public.booking_reference from anon,authenticated;

create function public.touch_booking() returns trigger language plpgsql set search_path='' as $$
begin
 new.updated_at:=now();
 return new;
end $$;
create trigger touch_booking before update on public.bookings for each row execute function public.touch_booking();

-- A trigger, so a change can never skip the audit trail. Jobs run without a signed-in user, which reads as the system.
create function public.record_booking_event() returns trigger language plpgsql security definer set search_path='' as $$
declare what text; actor uuid:=auth.uid(); acting text;
begin
 if tg_op='INSERT' then what:='requested';
 elsif new.starts_at is distinct from old.starts_at then what:='rescheduled';
 elsif new.status is distinct from old.status then what:=case when new.status='pending' then 'returned_to_pending' else new.status end;
 elsif new.therapist_id is distinct from old.therapist_id then what:='therapist_changed';
 elsif new.attendance is distinct from old.attendance then what:='attendance_marked';
 else return new;
 end if;
 acting:=case when actor is null then 'system' when actor=new.patient_id then 'patient' when public.has_role('scheduler') then 'scheduler'
  when public.has_role('admin') then 'admin' when public.has_role('therapist') then 'therapist' else 'system' end;
 insert into public.booking_events(booking_id,actor_id,actor_role,action,from_status,to_status,from_starts_at,to_starts_at,from_therapist,to_therapist,reason)
 values(new.id,actor,acting,what,old.status,new.status,old.starts_at,new.starts_at,old.therapist_id,new.therapist_id,new.status_reason);
 insert into public.audit_events(actor_id,action,target_type,target_id) values(actor,what,'bookings',new.id::text);
 return new;
end $$;
create trigger record_booking_event after insert or update on public.bookings for each row execute function public.record_booking_event();

create or replace function public.slot_load(p_starts timestamptz,p_ends timestamptz) returns integer language sql stable security definer set search_path='' as $$
 select count(*)::integer from public.bookings where status in ('pending','confirmed','rescheduled') and starts_at<p_ends and ends_at>p_starts
$$;

create function public.slot_on_grid(p_starts timestamptz) returns boolean language plpgsql stable security definer set search_path='' as $$
declare settings public.center_settings; hours public.center_hours; minutes numeric;
begin
 select * into strict settings from public.center_settings;
 select * into hours from public.center_hours where weekday=extract(isodow from p_starts at time zone settings.time_zone)::integer;
 if not found then return false; end if;
 minutes:=extract(epoch from ((p_starts at time zone settings.time_zone)::time-hours.opens_at))/60;
 return minutes>=0 and mod(minutes,settings.slot_minutes)=0;
end $$;

-- The checks that bind everyone, repeated at every decision so a stale screen can never confirm a time that has since closed.
create function public.booking_check_slot(p_starts timestamptz,p_ends timestamptz,p_booking uuid) returns void
language plpgsql security definer set search_path='' as $$
declare settings public.center_settings; problem text;
begin
 select * into strict settings from public.center_settings;
 if p_starts<=now() then raise exception 'booking_past'; end if;
 problem:=public.center_problem(p_starts,p_ends);
 if problem is not null then raise exception 'booking_%',problem; end if;
 if (select count(*) from public.bookings where status in ('pending','confirmed','rescheduled') and starts_at<p_ends and ends_at>p_starts and id is distinct from p_booking)>=settings.slot_capacity
 then raise exception 'booking_full'; end if;
end $$;

create function public.booking_check_therapist(p_therapist uuid,p_starts timestamptz,p_ends timestamptz,p_booking uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_therapist is null then raise exception 'booking_therapist_required'; end if;
 if not exists(select 1 from public.profiles p join public.user_roles r on r.user_id=p.id and r.role='therapist' where p.id=p_therapist and p.active)
 then raise exception 'booking_therapist_unavailable'; end if;
 if exists(select 1 from public.bookings where therapist_id=p_therapist and status in ('pending','confirmed','rescheduled') and starts_at<p_ends and ends_at>p_starts and id is distinct from p_booking)
 then raise exception 'booking_therapist_busy'; end if;
end $$;

create function public.booking_check_patient(p_patient uuid,p_starts timestamptz,p_ends timestamptz,p_booking uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.bookings where patient_id=p_patient and status in ('pending','confirmed','rescheduled') and starts_at<p_ends and ends_at>p_starts and id is distinct from p_booking)
 then raise exception 'booking_overlap'; end if;
end $$;

create function public.booking_reason(p_reason text) returns text language plpgsql immutable set search_path='' as $$
begin
 if p_reason is null or length(trim(p_reason)) not between 3 and 300 then raise exception 'booking_reason_required'; end if;
 return trim(p_reason);
end $$;

-- What a person sees of one booking. The calendar token and internal fields stay behind.
create function public.booking_view(b public.bookings) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',b.id,'reference_no',b.reference_no,'status',b.status,'status_reason',b.status_reason,'starts_at',b.starts_at,'ends_at',b.ends_at,
  'previous_starts_at',b.previous_starts_at,'therapist_id',b.therapist_id,'therapist_name',(select display_name from public.profiles where id=b.therapist_id),
  'attendance',b.attendance,'created_at',b.created_at)
$$;

-- Patient functions.
create function public.request_booking(p_request uuid,p_starts timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare settings public.center_settings; existing public.bookings; created public.bookings; problem text; ends timestamptz;
begin
 if not public.has_role('patient') then raise exception 'Patient access required' using errcode='42501'; end if;
 if p_request is null or p_starts is null then raise exception 'booking_invalid'; end if;
 perform pg_advisory_xact_lock(724020);
 select * into existing from public.bookings where client_request_id=p_request;
 if found then
  if existing.patient_id<>auth.uid() then raise exception 'booking_invalid'; end if;
  return public.booking_view(existing);
 end if;
 select * into strict settings from public.center_settings;
 problem:=public.slot_problem(p_starts);
 if problem is not null then raise exception 'booking_%',problem; end if;
 ends:=p_starts+make_interval(mins=>settings.slot_minutes);
 perform public.booking_check_slot(p_starts,ends,null);
 perform public.booking_check_patient(auth.uid(),p_starts,ends,null);
 if (select count(*) from public.bookings where patient_id=auth.uid() and status in ('pending','confirmed','rescheduled') and ends_at>now())>=settings.max_active_bookings
 then raise exception 'booking_limit'; end if;
 insert into public.bookings(reference_no,patient_id,starts_at,ends_at,client_request_id)
 values('BK-'||to_char(now() at time zone settings.time_zone,'YYYY')||'-'||lpad(nextval('public.booking_reference')::text,6,'0'),auth.uid(),p_starts,ends,p_request)
 returning * into created;
 return public.booking_view(created);
end $$;

create function public.cancel_my_booking(p_booking uuid,p_reason text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare settings public.center_settings; target public.bookings;
begin
 if not public.has_role('patient') then raise exception 'Patient access required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(724020);
 select * into target from public.bookings where id=p_booking and patient_id=auth.uid() for update;
 if not found then raise exception 'booking_unavailable'; end if;
 if target.status not in ('pending','confirmed','rescheduled') then raise exception 'booking_state'; end if;
 select * into strict settings from public.center_settings;
 if target.starts_at-make_interval(hours=>settings.cancel_cutoff_hours)<=now() then raise exception 'booking_too_late'; end if;
 update public.bookings set status='cancelled',status_reason=nullif(trim(coalesce(p_reason,'')),'') where id=target.id returning * into target;
 return public.booking_view(target);
end $$;

-- Scheduler decisions.
create function public.scheduler_confirm(p_booking uuid,p_therapist uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.bookings; therapist uuid;
begin
 perform public.require_scheduler();
 perform pg_advisory_xact_lock(724020);
 select * into target from public.bookings where id=p_booking for update;
 if not found then raise exception 'booking_unavailable'; end if;
 if target.status<>'pending' then raise exception 'booking_state'; end if;
 therapist:=coalesce(p_therapist,target.therapist_id);
 perform public.booking_check_slot(target.starts_at,target.ends_at,target.id);
 perform public.booking_check_therapist(therapist,target.starts_at,target.ends_at,target.id);
 update public.bookings set status='confirmed',therapist_id=therapist,status_reason=null where id=target.id returning * into target;
 return public.booking_view(target);
end $$;

create function public.scheduler_reject(p_booking uuid,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.bookings; reason text;
begin
 perform public.require_scheduler();
 reason:=public.booking_reason(p_reason);
 perform pg_advisory_xact_lock(724020);
 select * into target from public.bookings where id=p_booking for update;
 if not found then raise exception 'booking_unavailable'; end if;
 if target.status<>'pending' then raise exception 'booking_state'; end if;
 update public.bookings set status='rejected',status_reason=reason where id=target.id returning * into target;
 return public.booking_view(target);
end $$;

create function public.scheduler_reschedule(p_booking uuid,p_starts timestamptz,p_therapist uuid default null,p_reason text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare settings public.center_settings; target public.bookings; therapist uuid; ends timestamptz;
begin
 perform public.require_scheduler();
 if p_starts is null then raise exception 'booking_invalid'; end if;
 perform pg_advisory_xact_lock(724020);
 select * into target from public.bookings where id=p_booking for update;
 if not found then raise exception 'booking_unavailable'; end if;
 if target.status not in ('pending','confirmed','rescheduled') then raise exception 'booking_state'; end if;
 if not public.slot_on_grid(p_starts) then raise exception 'booking_off_grid'; end if;
 select * into strict settings from public.center_settings;
 ends:=p_starts+make_interval(mins=>settings.slot_minutes);
 therapist:=coalesce(p_therapist,target.therapist_id);
 perform public.booking_check_slot(p_starts,ends,target.id);
 perform public.booking_check_therapist(therapist,p_starts,ends,target.id);
 perform public.booking_check_patient(target.patient_id,p_starts,ends,target.id);
 update public.bookings set status='rescheduled',therapist_id=therapist,previous_starts_at=target.starts_at,starts_at=p_starts,ends_at=ends,
  status_reason=nullif(trim(coalesce(p_reason,'')),'') where id=target.id returning * into target;
 return public.booking_view(target);
end $$;

create function public.scheduler_assign_therapist(p_booking uuid,p_therapist uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.bookings;
begin
 perform public.require_scheduler();
 perform pg_advisory_xact_lock(724020);
 select * into target from public.bookings where id=p_booking for update;
 if not found then raise exception 'booking_unavailable'; end if;
 if target.status not in ('pending','confirmed','rescheduled') then raise exception 'booking_state'; end if;
 if target.ends_at<=now() then raise exception 'booking_past'; end if;
 perform public.booking_check_therapist(p_therapist,target.starts_at,target.ends_at,target.id);
 update public.bookings set therapist_id=p_therapist where id=target.id returning * into target;
 return public.booking_view(target);
end $$;

create function public.scheduler_cancel(p_booking uuid,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.bookings; reason text;
begin
 perform public.require_scheduler();
 reason:=public.booking_reason(p_reason);
 perform pg_advisory_xact_lock(724020);
 select * into target from public.bookings where id=p_booking for update;
 if not found then raise exception 'booking_unavailable'; end if;
 if target.status not in ('pending','confirmed','rescheduled') then raise exception 'booking_state'; end if;
 update public.bookings set status='cancelled',status_reason=reason where id=target.id returning * into target;
 return public.booking_view(target);
end $$;

-- Only pending requests change, so a booking confirmed in the meantime is left alone. Returns how many were rejected.
create function public.scheduler_bulk_reject(p_bookings uuid[],p_reason text) returns integer language plpgsql security definer set search_path='' as $$
declare reason text; changed integer;
begin
 perform public.require_scheduler();
 reason:=public.booking_reason(p_reason);
 if p_bookings is null or cardinality(p_bookings) not between 1 and 500 then raise exception 'booking_invalid'; end if;
 perform pg_advisory_xact_lock(724020);
 update public.bookings set status='rejected',status_reason=reason where id=any(p_bookings) and status='pending';
 get diagnostics changed=row_count;
 return changed;
end $$;

-- A therapist who leaves cannot stay on future sessions, so those return to Pending for a Scheduler to reassign.
create function public.release_therapist_bookings(p_therapist uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(724020);
 update public.bookings set therapist_id=null,status='pending',status_reason='therapist_unavailable'
 where therapist_id=p_therapist and starts_at>now() and status in ('pending','confirmed','rescheduled');
end $$;

create or replace function public.admin_set_role(p_user uuid,p_role text,p_granted boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(724010);
 perform public.require_admin();
 if p_role is null or p_role not in ('therapist','admin','scheduler') or p_granted is null or p_user=auth.uid()
 then raise exception 'Invalid role change or self modification'; end if;
 if not exists(select 1 from public.profiles where id=p_user and active) then raise exception 'Active account required'; end if;
 if p_granted then
  insert into public.user_roles(user_id,role) values(p_user,p_role) on conflict do nothing;
 else
  delete from public.user_roles where user_id=p_user and role=p_role;
  if p_role='therapist' then
   update public.therapist_patients set active=false where therapist_id=p_user;
   update public.exercise_assignments set active=false where therapist_id=p_user;
   update public.patient_invitations set expires_at=least(expires_at,now()) where therapist_id=p_user;
   perform public.release_therapist_bookings(p_user);
  end if;
 end if;
end $$;

create or replace function public.admin_set_account(p_user uuid,p_active boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(724010);
 perform public.require_admin();
 if p_active is null or p_user=auth.uid() then raise exception 'Cannot change your own account status'; end if;
 update public.profiles set active=p_active where id=p_user;
 if not found then raise exception 'Account unavailable'; end if;
 insert into public.audit_events(actor_id,action,target_type,target_id)
 values(auth.uid(),case when p_active then 'enable' else 'disable' end,'profiles',p_user::text);
 if not p_active then perform public.release_therapist_bookings(p_user); end if;
end $$;

-- The feed names a booking by its reference number, the same on both apps.
create or replace function public.admin_activity(p_before bigint default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform public.require_admin();
 select coalesce(jsonb_agg(to_jsonb(e) order by e.id desc),'[]'::jsonb) into result from (
  select a.id,a.action,a.target_type,a.target_id,a.recorded_at,a.actor_id,coalesce(actor.display_name,'') as actor_name,
   coalesce((select t.display_name from public.profiles t where t.id::text=case
     when a.target_type in ('profiles','user_roles') then a.target_id
     when a.target_type='therapist_patients' then split_part(a.target_id,':',1) end),
    (select b.reference_no from public.bookings b where a.target_type='bookings' and b.id::text=a.target_id),'') as target_name,
   coalesce((select t.display_name from public.profiles t where a.target_type='therapist_patients'
     and t.id::text=split_part(a.target_id,':',2)),'') as related_name
  from public.audit_events a
  left join public.profiles actor on actor.id=a.actor_id
  where p_before is null or a.id<p_before
  order by a.id desc limit 31
 ) e;
 return result;
end $$;

revoke all on function public.touch_booking(),public.record_booking_event(),public.slot_on_grid(timestamptz),public.booking_check_slot(timestamptz,timestamptz,uuid),
 public.booking_check_therapist(uuid,timestamptz,timestamptz,uuid),public.booking_check_patient(uuid,timestamptz,timestamptz,uuid),public.booking_reason(text),
 public.booking_view(public.bookings),public.release_therapist_bookings(uuid),public.request_booking(uuid,timestamptz),public.cancel_my_booking(uuid,text),
 public.scheduler_confirm(uuid,uuid),public.scheduler_reject(uuid,text),public.scheduler_reschedule(uuid,timestamptz,uuid,text),public.scheduler_assign_therapist(uuid,uuid),
 public.scheduler_cancel(uuid,text),public.scheduler_bulk_reject(uuid[],text) from public,anon,authenticated;
grant execute on function public.request_booking(uuid,timestamptz),public.cancel_my_booking(uuid,text),public.scheduler_confirm(uuid,uuid),public.scheduler_reject(uuid,text),
 public.scheduler_reschedule(uuid,timestamptz,uuid,text),public.scheduler_assign_therapist(uuid,uuid),public.scheduler_cancel(uuid,text),public.scheduler_bulk_reject(uuid[],text) to authenticated;
