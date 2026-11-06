-- A full slot can still be wanted. Patients wait for a specific time, and everyone waiting hears when a place opens.
-- Waiting holds nothing: the first to book gets the place, under the same rules as any booking, so one person who never answers stalls nobody.
create table public.booking_waitlist (
 id uuid primary key default gen_random_uuid(),
 patient_id uuid not null references public.patients(id),
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 status text not null default 'waiting' check(status in ('waiting','booked','left')),
 -- When this person heard about the place open now. It clears when the slot fills again, so the next place is news and a burst of cancellations is one message.
 notified_at timestamptz,
 settled_at timestamptz,
 created_at timestamptz not null default now(),
 check(ends_at>starts_at)
);
create unique index booking_waitlist_once on public.booking_waitlist(patient_id,starts_at) where status='waiting';
create index booking_waitlist_open on public.booking_waitlist(starts_at,ends_at) where status='waiting';
alter table public.booking_waitlist enable row level security;
revoke all on public.booking_waitlist from anon,authenticated;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check(kind in (
 'confirmed','rejected','cancelled','rescheduled','therapist_changed','returned_to_pending',
 'session_assigned','session_moved','session_cancelled','session_removed',
 'request_received','patient_cancelled','needs_therapist','reminder','session_reminder','place_open'));

-- Each opening is its own news, so it needs its own number for notify to tell one from another.
create sequence public.waitlist_event;

create or replace function public.center_availability(p_from date,p_to date,p_staff boolean) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare settings public.center_settings; hours public.center_hours; today date; earliest timestamptz; latest timestamptz; step interval;
 day date; holiday text; slot timestamptz; closes timestamptz; slots jsonb; days jsonb:='[]'::jsonb; day_status text; closed boolean; soon boolean; far boolean;
begin
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>62 then raise exception 'booking_invalid_range'; end if;
 select * into strict settings from public.center_settings;
 today:=(now() at time zone settings.time_zone)::date;
 earliest:=case when p_staff then now() else now()+make_interval(hours=>settings.minimum_notice_hours) end;
 latest:=case when p_staff then 'infinity'::timestamptz else now()+make_interval(days=>settings.booking_horizon_days) end;
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
     'mine',not p_staff and exists(select 1 from public.bookings where patient_id=auth.uid() and status in ('pending','confirmed','rescheduled') and starts_at<slot+step and ends_at>slot),
     'waiting',not p_staff and exists(select 1 from public.booking_waitlist where patient_id=auth.uid() and status='waiting' and starts_at<slot+step and ends_at>slot));
    end if;
    slot:=slot+step;
   end loop;
   day_status:=case when jsonb_array_length(slots)>0 then 'open' when closed then 'closure' when far then 'too_far' when soon then 'too_soon' else 'closed' end;
  end if;
  days:=days||jsonb_build_object('date',day,'status',day_status,'holiday',holiday,'slots',slots);
 end loop;
 return jsonb_build_object('time_zone',settings.time_zone,'slot_minutes',settings.slot_minutes,'days',days);
end $$;

-- Waiting only makes sense for a time that is bookable and full. Asking twice is the same as asking once, so a retry after a lost response is harmless.
create function public.join_waitlist(p_starts timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare settings public.center_settings; problem text; ends timestamptz; entry public.booking_waitlist;
begin
 if not public.has_role('patient') then raise exception 'Patient access required' using errcode='42501'; end if;
 if p_starts is null then raise exception 'booking_invalid'; end if;
 perform pg_advisory_xact_lock(724020);
 select * into entry from public.booking_waitlist where patient_id=auth.uid() and status='waiting' and starts_at=p_starts;
 if not found then
  select * into strict settings from public.center_settings;
  problem:=public.slot_problem(p_starts);
  if problem is not null then raise exception 'booking_%',problem; end if;
  ends:=p_starts+make_interval(mins=>settings.slot_minutes);
  perform public.booking_check_patient(auth.uid(),p_starts,ends,null);
  if public.slot_load(p_starts,ends)<settings.slot_capacity then raise exception 'booking_not_full'; end if;
  insert into public.booking_waitlist(patient_id,starts_at,ends_at) values(auth.uid(),p_starts,ends) returning * into entry;
 end if;
 return jsonb_build_object('id',entry.id,'starts_at',entry.starts_at,'ends_at',entry.ends_at);
end $$;

-- Only ever the caller's own, and leaving twice is the same as leaving once.
create function public.leave_waitlist(p_starts timestamptz) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.has_role('patient') then raise exception 'Patient access required' using errcode='42501'; end if;
 update public.booking_waitlist set status='left',settled_at=now() where patient_id=auth.uid() and status='waiting' and starts_at=p_starts;
end $$;

-- A time that can no longer be booked has nothing left to wait for, so it drops off the list.
create function public.my_waitlist() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare settings public.center_settings;
begin
 if not public.has_role('patient') then raise exception 'Patient access required' using errcode='42501'; end if;
 select * into strict settings from public.center_settings;
 return coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'starts_at',w.starts_at,'ends_at',w.ends_at,'open',public.slot_load(w.starts_at,w.ends_at)<settings.slot_capacity) order by w.starts_at)
  from public.booking_waitlist w where w.patient_id=auth.uid() and w.status='waiting' and public.slot_problem(w.starts_at) is null),'[]'::jsonb);
end $$;

-- Tells everyone waiting across this span that a place is open, unless they have heard already. Only a place someone could actually book is news.
create function public.waitlist_release(p_from timestamptz,p_to timestamptz) returns void language plpgsql security definer set search_path='' as $$
declare settings public.center_settings; entry public.booking_waitlist;
begin
 select * into strict settings from public.center_settings;
 for entry in select w.* from public.booking_waitlist w join public.profiles p on p.id=w.patient_id and p.active
  where w.status='waiting' and w.notified_at is null and w.starts_at<p_to and w.ends_at>p_from order by w.created_at,w.id loop
  if public.slot_problem(entry.starts_at) is null and public.slot_load(entry.starts_at,entry.ends_at)<settings.slot_capacity then
   perform public.notify(entry.patient_id,'place_open',null,jsonb_build_object('starts_at',entry.starts_at,'ends_at',entry.ends_at),nextval('public.waitlist_event'),null);
   update public.booking_waitlist set notified_at=now() where id=entry.id;
  end if;
 end loop;
end $$;

-- Every change to a booking is recorded in booking_events, so a place opening here cannot be missed by a new way of cancelling or moving one.
create function public.release_waitlist() returns trigger language plpgsql security definer set search_path='' as $$
declare b public.bookings;
begin
 select * into strict b from public.bookings where id=new.booking_id;
 if new.from_status in ('pending','confirmed','rescheduled') and new.to_status in ('rejected','cancelled') then
  perform public.waitlist_release(b.starts_at,b.ends_at);
 elsif new.from_starts_at is not null and new.from_starts_at is distinct from new.to_starts_at then
  perform public.waitlist_release(new.from_starts_at,new.from_starts_at+(b.ends_at-b.starts_at));
 end if;
 return null;
end $$;
create trigger release_waitlist after insert on public.booking_events for each row execute function public.release_waitlist();

-- Raising the capacity opens a place in every full slot at once.
create function public.release_waitlist_capacity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.slot_capacity>old.slot_capacity then perform public.waitlist_release('-infinity','infinity'); end if;
 return null;
end $$;
create trigger release_waitlist_capacity after update of slot_capacity on public.center_settings for each row execute function public.release_waitlist_capacity();

-- However a patient comes to hold the slot they wanted, they stop waiting for it. A slot that has filled again makes the next place news.
create function public.settle_waitlist() returns trigger language plpgsql security definer set search_path='' as $$
declare settings public.center_settings;
begin
 if new.status not in ('pending','confirmed','rescheduled') then return null; end if;
 select * into strict settings from public.center_settings;
 update public.booking_waitlist set status='booked',settled_at=now() where patient_id=new.patient_id and status='waiting' and starts_at<new.ends_at and ends_at>new.starts_at;
 if public.slot_load(new.starts_at,new.ends_at)>=settings.slot_capacity then
  update public.booking_waitlist set notified_at=null where status='waiting' and notified_at is not null and starts_at<new.ends_at and ends_at>new.starts_at;
 end if;
 return null;
end $$;
create trigger settle_waitlist after insert or update of status,starts_at,ends_at on public.bookings for each row execute function public.settle_waitlist();

revoke all on function public.join_waitlist(timestamptz),public.leave_waitlist(timestamptz),public.my_waitlist(),public.waitlist_release(timestamptz,timestamptz),
 public.release_waitlist(),public.release_waitlist_capacity(),public.settle_waitlist() from public,anon,authenticated;
grant execute on function public.join_waitlist(timestamptz),public.leave_waitlist(timestamptz),public.my_waitlist() to authenticated;
