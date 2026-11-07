-- A Scheduler books the same weekly time for a course of therapy in one step. Every date passes the same checks as any booking.
create table public.booking_series (
 id uuid primary key default gen_random_uuid(),
 patient_id uuid not null references public.patients(id),
 therapist_id uuid not null references public.profiles(id),
 weeks smallint not null check(weeks between 2 and 26),
 client_request_id uuid unique,
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 cancelled_at timestamptz,
 cancel_reason text check(length(cancel_reason)<=300)
);
alter table public.booking_series enable row level security;
revoke all on public.booking_series from anon,authenticated;

alter table public.bookings add column series_id uuid references public.booking_series(id);
create index bookings_series on public.bookings(series_id) where series_id is not null;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check(kind in (
 'confirmed','rejected','cancelled','rescheduled','therapist_changed','returned_to_pending',
 'session_assigned','session_moved','session_cancelled','session_removed',
 'request_received','patient_cancelled','needs_therapist','reminder','session_reminder','place_open','patient_rescheduled',
 'series_booked','series_assigned','series_cancelled','session_series_cancelled'));

-- A date of a series is booked by a Scheduler, not requested, so it is recorded as what it is and nobody is told it needs deciding.
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
 insert into public.booking_events(booking_id,actor_id,actor_role,action,from_status,to_status,from_starts_at,to_starts_at,from_therapist,to_therapist,reason,from_attendance,to_attendance)
 values(new.id,actor,acting,what,old.status,new.status,old.starts_at,new.starts_at,old.therapist_id,new.therapist_id,new.status_reason,old.attendance,new.attendance);
 insert into public.audit_events(actor_id,action,target_type,target_id) values(actor,what,'bookings',new.id::text);
 return new;
end $$;

-- A cancelled series tells each person once, so its dates say nothing of their own. The series is marked cancelled first, which is how this knows.
create or replace function public.notify_booking_event() returns trigger language plpgsql security definer set search_path='' as $$
declare b public.bookings; facts jsonb; patient jsonb; moved boolean; was uuid:=new.from_therapist; now_with uuid:=new.to_therapist;
begin
 select * into strict b from public.bookings where id=new.booking_id;
 if new.action='cancelled' and exists(select 1 from public.booking_series s where s.id=b.series_id and s.cancelled_at is not null) then return new; end if;
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

-- The same weekly time, counted in the center's own days so a change of clocks anywhere cannot move a session.
create function public.series_dates(p_starts timestamptz,p_weeks integer) returns setof timestamptz language sql stable security definer set search_path='' as $$
 select ((p_starts at time zone s.time_zone)+make_interval(weeks=>n)) at time zone s.time_zone
 from public.center_settings s,generate_series(0,p_weeks-1) n order by n
$$;

-- Why one date cannot be booked, or null. These are the checks any booking passes, so a series cannot get round one.
create function public.series_problem(p_patient uuid,p_therapist uuid,p_starts timestamptz,p_ends timestamptz) returns text language plpgsql security definer set search_path='' as $$
begin
 if not public.slot_on_grid(p_starts) then return 'off_grid'; end if;
 perform public.booking_check_slot(p_starts,p_ends,null);
 perform public.booking_check_therapist(p_therapist,p_starts,p_ends,null);
 perform public.booking_check_patient(p_patient,p_starts,p_ends,null);
 return null;
exception when raise_exception then
 return replace(sqlerrm,'booking_','');
end $$;

create function public.series_check(p_patient uuid,p_therapist uuid,p_starts timestamptz,p_weeks integer) returns void language plpgsql stable security definer set search_path='' as $$
begin
 if p_patient is null or p_therapist is null or p_starts is null or p_weeks is null or p_weeks not between 2 and 26 then raise exception 'booking_invalid'; end if;
 if not exists(select 1 from public.profiles p join public.user_roles r on r.user_id=p.id and r.role='patient' join public.patients t on t.id=p.id where p.id=p_patient and p.active)
 then raise exception 'booking_patient_unavailable'; end if;
end $$;

-- Each date with what would stop it, so a Scheduler sees the whole course before anything is saved.
create function public.scheduler_series_preview(p_patient uuid,p_therapist uuid,p_starts timestamptz,p_weeks integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare settings public.center_settings; slot timestamptz; ends timestamptz; dates jsonb:='[]'::jsonb;
begin
 perform public.require_scheduler();
 perform public.series_check(p_patient,p_therapist,p_starts,p_weeks);
 select * into strict settings from public.center_settings;
 for slot in select * from public.series_dates(p_starts,p_weeks) loop
  ends:=slot+make_interval(mins=>settings.slot_minutes);
  dates:=dates||jsonb_build_object('starts_at',slot,'ends_at',ends,'problem',public.series_problem(p_patient,p_therapist,slot,ends));
 end loop;
 return jsonb_build_object('dates',dates);
end $$;

create function public.series_view(p_series uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',s.id,'weeks',s.weeks,'booked',(select count(*) from public.bookings b where b.series_id=s.id))
 from public.booking_series s where s.id=p_series
$$;

-- Dates that pass are confirmed and the rest are left out, so one holiday does not cost a patient the whole course.
-- The checks run again here, because the preview may be out of date by now. A repeat with the same request returns the first result.
create function public.scheduler_series_create(p_request uuid,p_patient uuid,p_therapist uuid,p_starts timestamptz,p_weeks integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare settings public.center_settings; series public.booking_series; made public.bookings; opening public.bookings; closing public.bookings; slot timestamptz; ends timestamptz; total integer:=0; facts jsonb; event bigint;
begin
 perform public.require_scheduler();
 if p_request is null then raise exception 'booking_invalid'; end if;
 perform pg_advisory_xact_lock(724020);
 select * into series from public.booking_series where client_request_id=p_request;
 if found then return public.series_view(series.id); end if;
 perform public.series_check(p_patient,p_therapist,p_starts,p_weeks);
 select * into strict settings from public.center_settings;
 insert into public.booking_series(patient_id,therapist_id,weeks,client_request_id,created_by) values(p_patient,p_therapist,p_weeks,p_request,auth.uid()) returning * into series;
 for slot in select * from public.series_dates(p_starts,p_weeks) loop
  ends:=slot+make_interval(mins=>settings.slot_minutes);
  if public.series_problem(p_patient,p_therapist,slot,ends) is null then
   insert into public.bookings(reference_no,patient_id,therapist_id,series_id,starts_at,ends_at,status)
   values('BK-'||to_char(now() at time zone settings.time_zone,'YYYY')||'-'||lpad(nextval('public.booking_reference')::text,6,'0'),p_patient,p_therapist,series.id,slot,ends,'confirmed') returning * into made;
   total:=total+1;
   if opening.id is null then opening:=made; end if;
   closing:=made;
  end if;
 end loop;
 if total=0 then raise exception 'booking_series_empty'; end if;
 select max(id) into event from public.booking_events where booking_id=closing.id;
 facts:=jsonb_build_object('reference_no',opening.reference_no,'starts_at',opening.starts_at,'ends_at',opening.ends_at,'last_starts_at',closing.starts_at,'sessions',total,
  'patient_name',(select display_name from public.profiles where id=p_patient),'therapist_name',(select display_name from public.profiles where id=p_therapist));
 -- One message for the course. Each session still gets its own reminders.
 perform public.notify(p_patient,'series_booked',opening.id,facts,event,auth.uid());
 perform public.notify(p_therapist,'series_assigned',opening.id,facts,event,auth.uid());
 return public.series_view(series.id);
end $$;

-- Sessions that have started are history and stay. A session the patient moved still belongs to the course, so it goes with the rest.
create function public.scheduler_series_cancel(p_series uuid,p_reason text) returns integer language plpgsql security definer set search_path='' as $$
declare series public.booking_series; reason text; total integer; opening public.bookings; closing timestamptz; event bigint; facts jsonb; therapists jsonb; own jsonb;
begin
 perform public.require_scheduler();
 reason:=public.booking_reason(p_reason);
 perform pg_advisory_xact_lock(724020);
 select * into series from public.booking_series where id=p_series for update;
 if not found then raise exception 'booking_unavailable'; end if;
 if series.cancelled_at is not null then raise exception 'booking_state'; end if;
 select * into opening from public.bookings where series_id=series.id and status in ('pending','confirmed','rescheduled') and starts_at>now() order by starts_at,id limit 1;
 if not found then raise exception 'booking_state'; end if;
 select count(*),max(starts_at) into total,closing from public.bookings where series_id=series.id and status in ('pending','confirmed','rescheduled') and starts_at>now();
 -- A session can have changed hands, so each therapist hears about the ones that were theirs.
 select coalesce(jsonb_agg(jsonb_build_object('therapist',t.therapist_id,'sessions',t.sessions,'starts_at',t.starts_at,'ends_at',t.ends_at)),'[]'::jsonb) into therapists from (
  select therapist_id,count(*) as sessions,min(starts_at) as starts_at,min(ends_at) as ends_at from public.bookings
  where series_id=series.id and status in ('pending','confirmed','rescheduled') and starts_at>now() and therapist_id is not null group by therapist_id
 ) t;
 update public.booking_series set cancelled_at=now(),cancel_reason=reason where id=series.id;
 update public.bookings set status='cancelled',status_reason=reason where series_id=series.id and status in ('pending','confirmed','rescheduled') and starts_at>now();
 select max(e.id) into event from public.booking_events e join public.bookings b on b.id=e.booking_id where b.series_id=series.id;
 facts:=jsonb_build_object('reference_no',opening.reference_no,'starts_at',opening.starts_at,'ends_at',opening.ends_at,'last_starts_at',closing,'sessions',total,
  'patient_name',(select display_name from public.profiles where id=series.patient_id),'therapist_name',(select display_name from public.profiles where id=opening.therapist_id));
 -- The reason is written for the patient, as for any cancellation.
 perform public.notify(series.patient_id,'series_cancelled',opening.id,facts||jsonb_build_object('reason',reason),event,auth.uid());
 for own in select * from jsonb_array_elements(therapists) loop
  perform public.notify((own->>'therapist')::uuid,'session_series_cancelled',opening.id,facts||(own-'therapist'),event,auth.uid());
 end loop;
 return total;
end $$;

-- The table says which sessions belong to a series, so one can be cancelled from any of them.
create or replace function public.scheduler_bookings(p_search text default null,p_statuses text[] default null,p_from date default null,p_to date default null,
 p_therapist uuid default null,p_patient uuid default null,p_sort text default 'starts_at',p_descending boolean default false,p_limit integer default 25,p_offset integer default 0,p_attendance text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare settings public.center_settings; pattern text; sorted text; result jsonb;
begin
 perform public.require_scheduler();
 select * into strict settings from public.center_settings;
 pattern:=nullif(trim(coalesce(p_search,'')),'');
 if length(pattern)>100 then raise exception 'Search term too long'; end if;
 -- Escape LIKE wildcards so a search for "a_b" or "50%" matches literally.
 if pattern is not null then pattern:='%'||replace(replace(replace(pattern,'\','\\'),'%','\%'),'_','\_')||'%'; end if;
 -- Only these names can reach the query, so the sort cannot carry anything else.
 sorted:=case coalesce(p_sort,'starts_at') when 'starts_at' then 'b.starts_at' when 'created_at' then 'b.created_at' when 'reference_no' then 'b.reference_no' when 'status' then 'b.status'
  when 'patient' then 'lower(pp.display_name)' when 'therapist' then 'lower(tp.display_name)' when 'attendance' then 'b.attendance' else null end;
 if sorted is null then raise exception 'booking_invalid'; end if;
 if p_attendance is not null and p_attendance not in ('attended','no_show','unmarked') then raise exception 'booking_invalid'; end if;
 execute format($q$
  with found as (
   select b.id,b.reference_no,b.status,b.status_reason,b.starts_at,b.ends_at,b.previous_starts_at,b.patient_id,b.therapist_id,b.attendance,b.series_id,b.starts_at<=now() as started,b.created_at,
    pp.display_name as patient_name,tp.display_name as therapist_name,row_number() over(order by %s %s nulls last,b.id) as position
   from public.bookings b
   join public.profiles pp on pp.id=b.patient_id
   left join public.profiles tp on tp.id=b.therapist_id
   where ($1 is null or pp.display_name ilike $1 or tp.display_name ilike $1 or b.reference_no ilike $1)
    and ($2 is null or b.status=any($2))
    and ($3 is null or b.starts_at>=($3::timestamp at time zone $7))
    and ($4 is null or b.starts_at<(($4+1)::timestamp at time zone $7))
    and ($5 is null or b.therapist_id=$5)
    and ($6 is null or b.patient_id=$6)
    -- Not marked means a session that has started, because a session still to come needs nothing yet.
    and ($10 is null or b.attendance=$10 or ($10='unmarked' and b.attendance is null and b.starts_at<=now()))
  )
  select jsonb_build_object('total',(select count(*) from found),
   'rows',coalesce((select jsonb_agg(to_jsonb(f)-'position' order by f.position) from found f where f.position>$9 and f.position<=$9+$8),'[]'::jsonb))
 $q$,sorted,case when p_descending then 'desc' else 'asc' end)
 into result using pattern,p_statuses,p_from,p_to,p_therapist,p_patient,settings.time_zone,least(greatest(coalesce(p_limit,25),1),500),greatest(coalesce(p_offset,0),0),p_attendance;
 return result;
end $$;

create or replace function public.scheduler_booking_detail(p_booking uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target public.bookings;
begin
 perform public.require_scheduler();
 select * into target from public.bookings where id=p_booking;
 if not found then raise exception 'booking_unavailable'; end if;
 return public.booking_view(target)||jsonb_build_object(
  'patient_id',target.patient_id,'patient_name',(select display_name from public.profiles where id=target.patient_id),
  'series_id',target.series_id,
  'series_remaining',(select count(*) from public.bookings b join public.booking_series s on s.id=b.series_id
    where b.series_id=target.series_id and s.cancelled_at is null and b.status in ('pending','confirmed','rescheduled') and b.starts_at>now()),
  'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'actor_role',e.actor_role,'actor_name',a.display_name,'from_status',e.from_status,'to_status',e.to_status,
    'from_starts_at',e.from_starts_at,'to_starts_at',e.to_starts_at,'reason',e.reason,'to_attendance',e.to_attendance,'recorded_at',e.recorded_at) order by e.id desc)
   from public.booking_events e left join public.profiles a on a.id=e.actor_id where e.booking_id=target.id),'[]'::jsonb));
end $$;

revoke all on function public.series_dates(timestamptz,integer),public.series_problem(uuid,uuid,timestamptz,timestamptz),public.series_check(uuid,uuid,timestamptz,integer),public.series_view(uuid),
 public.scheduler_series_preview(uuid,uuid,timestamptz,integer),public.scheduler_series_create(uuid,uuid,uuid,timestamptz,integer),public.scheduler_series_cancel(uuid,text) from public,anon,authenticated;
grant execute on function public.scheduler_series_preview(uuid,uuid,timestamptz,integer),public.scheduler_series_create(uuid,uuid,uuid,timestamptz,integer),public.scheduler_series_cancel(uuid,text) to authenticated;
