-- Exercise schedules (#124, #125). A therapist puts a patient's exercises on a calendar: a start date, an end date and rest days.
-- On each exercise day the patient does that day's exercises; a missed day is not carried over. An exercise without a schedule is
-- an every-day exercise, exactly as before, so older Android builds keep working. See docs/superpowers/specs/2026-11-17-exercise-schedule-design.md.

-- The calendar day at the center. Days, rest days and "done today" are all counted in the center's time zone, as bookings are.
create function public.center_date(p_at timestamptz default now()) returns date language sql stable security definer set search_path='' as $$
 select (p_at at time zone (select time_zone from public.center_settings limit 1))::date
$$;

create table public.exercise_schedules (
 -- Made by the client, so a save that is retried after a lost answer cannot create a second schedule.
 id uuid primary key,
 patient_id uuid not null references public.patients(id),
 therapist_id uuid not null references public.profiles(id),
 starts_on date not null,
 ends_on date not null,
 -- ISO weekdays: 1 is Monday and 7 is Sunday. Never all seven, or there would be no day to exercise.
 rest_weekdays smallint[] not null default '{}',
 rest_dates date[] not null default '{}',
 -- Set when a schedule is ended before it started. One that has started ends by moving its end date to today instead.
 cancelled_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(ends_on>=starts_on and ends_on<starts_on+366),
 check(rest_weekdays<@'{1,2,3,4,5,6,7}'::smallint[] and cardinality(rest_weekdays)<7),
 check(cardinality(rest_dates)<=366),
 unique(id,patient_id),
 foreign key(therapist_id,patient_id) references public.therapist_patients(therapist_id,patient_id)
);
create index exercise_schedules_patient on public.exercise_schedules(patient_id,ends_on) where cancelled_at is null;

-- Null is an every-day exercise. The pair keeps an exercise in a schedule of the same patient.
alter table public.exercise_assignments add column schedule_id uuid;
alter table public.exercise_assignments add constraint exercise_assignments_schedule_fkey foreign key(schedule_id,patient_id) references public.exercise_schedules(id,patient_id);
create index assignments_schedule on public.exercise_assignments(schedule_id) where schedule_id is not null;

alter table public.exercise_schedules enable row level security;
revoke all on public.exercise_schedules from anon,authenticated;
grant select on public.exercise_schedules to authenticated;
-- Read like assignments are. Every change goes through the functions below.
create policy exercise_schedules_read on public.exercise_schedules for select to authenticated using(public.can_read_patient(patient_id));

-- Whether a schedule asks for exercise on a day.
create function public.schedule_has_day(s public.exercise_schedules,p_day date) returns boolean language sql immutable set search_path='' as $$
 select s.cancelled_at is null and p_day between s.starts_on and s.ends_on and extract(isodow from p_day)::smallint<>all(s.rest_weekdays) and p_day<>all(s.rest_dates)
$$;

-- Exercise days from p_from to the end.
create function public.schedule_day_count(s public.exercise_schedules,p_from date) returns integer language sql immutable set search_path='' as $$
 select count(*)::integer from generate_series(greatest(s.starts_on,p_from)::timestamp,s.ends_on::timestamp,interval '1 day') d where public.schedule_has_day(s,d::date)
$$;

create function public.schedule_json(s public.exercise_schedules) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',s.id,'patient_id',s.patient_id,'therapist_id',s.therapist_id,'therapist_name',public.person_name(s.therapist_id),
  'starts_on',s.starts_on,'ends_on',s.ends_on,'rest_weekdays',to_jsonb(s.rest_weekdays),'rest_dates',to_jsonb(s.rest_dates),
  'exercise_days',public.schedule_day_count(s,s.starts_on),'rest_days',(s.ends_on-s.starts_on+1)-public.schedule_day_count(s,s.starts_on),
  'exercise_count',(select count(*) from public.exercise_assignments a where a.schedule_id=s.id and a.active))
$$;

-- Creates a schedule, or changes one. Past days are never rewritten: once a schedule has started its start date and the rest dates
-- already behind it stay as they were, and the end date can only move to today or later.
create function public.save_exercise_schedule(p_id uuid,p_patient uuid,p_starts_on date,p_ends_on date,p_rest_weekdays integer[] default '{}',p_rest_dates date[] default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare today date:=public.center_date(); existing public.exercise_schedules; saved public.exercise_schedules; weekdays smallint[]; dates date[];
begin
 if p_patient is null or not public.can_prescribe(p_patient) then raise exception 'schedule_unavailable' using errcode='42501'; end if;
 if p_id is null or p_starts_on is null or p_ends_on is null or p_ends_on<p_starts_on or p_ends_on>=p_starts_on+366 or p_ends_on<today then raise exception 'schedule_dates'; end if;
 if exists(select 1 from unnest(coalesce(p_rest_weekdays,'{}')) w where w is null or w not between 1 and 7)
 or exists(select 1 from unnest(coalesce(p_rest_dates,'{}')) d where d is null or d not between p_starts_on and p_ends_on) then raise exception 'schedule_rest_days'; end if;
 select coalesce(array_agg(distinct w::smallint order by w::smallint),'{}') into weekdays from unnest(coalesce(p_rest_weekdays,'{}')) w;
 select coalesce(array_agg(distinct d order by d),'{}') into dates from unnest(coalesce(p_rest_dates,'{}')) d;
 if cardinality(weekdays)>=7 then raise exception 'schedule_rest_days'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,3));
 select * into existing from public.exercise_schedules where id=p_id;
 if found then
  if existing.therapist_id<>auth.uid() or existing.patient_id<>p_patient or existing.cancelled_at is not null then raise exception 'schedule_unavailable' using errcode='42501'; end if;
  if existing.ends_on<today then raise exception 'schedule_gone'; end if;
  if existing.starts_on<=today then
   if p_starts_on<>existing.starts_on then raise exception 'schedule_dates'; end if;
   if array(select d from unnest(dates) d where d<today order by d) is distinct from array(select d from unnest(existing.rest_dates) d where d<today order by d)
   then raise exception 'schedule_rest_days'; end if;
  elsif p_starts_on<today then raise exception 'schedule_dates';
  end if;
  update public.exercise_schedules set starts_on=p_starts_on,ends_on=p_ends_on,rest_weekdays=weekdays,rest_dates=dates,updated_at=now() where id=p_id returning * into saved;
 else
  if p_starts_on<today then raise exception 'schedule_dates'; end if;
  insert into public.exercise_schedules(id,patient_id,therapist_id,starts_on,ends_on,rest_weekdays,rest_dates)
  values(p_id,p_patient,auth.uid(),p_starts_on,p_ends_on,weekdays,dates) returning * into saved;
 end if;
 if public.schedule_day_count(saved,today)=0 then raise exception 'schedule_no_day'; end if;
 return public.schedule_json(saved);
end $$;

-- Publishes an exercise into a schedule, in one transaction. Later edits go through publish_prescription and keep the schedule.
create function public.publish_scheduled_prescription(p_schedule uuid,p_assignment uuid,p_version uuid,p_patient uuid,p_exercise uuid,p_side text,p_low numeric,p_high numeric,
 p_repetitions integer,p_parameters jsonb default '{}') returns uuid language plpgsql security definer set search_path='' as $$
declare s public.exercise_schedules; a public.exercise_assignments; result uuid;
begin
 select * into s from public.exercise_schedules where id=p_schedule for update;
 if not found or s.therapist_id<>auth.uid() or s.patient_id is distinct from p_patient or s.cancelled_at is not null or not public.can_prescribe(p_patient)
 then raise exception 'schedule_unavailable' using errcode='42501'; end if;
 if s.ends_on<public.center_date() then raise exception 'schedule_gone'; end if;
 select * into a from public.exercise_assignments where id=p_assignment;
 if found and a.schedule_id is distinct from p_schedule then raise exception 'schedule_unavailable' using errcode='42501'; end if;
 result:=public.publish_prescription(p_assignment,p_version,p_patient,p_exercise,p_side,p_low,p_high,p_repetitions,p_parameters);
 update public.exercise_assignments set schedule_id=p_schedule where id=p_assignment and schedule_id is null;
 return result;
end $$;

-- Takes one exercise off a patient's plan, in a schedule or not. Its sessions stay in history.
create function public.stop_exercise(p_assignment uuid) returns void language plpgsql security definer set search_path='' as $$
declare a public.exercise_assignments;
begin
 select * into a from public.exercise_assignments where id=p_assignment for update;
 if not found or a.therapist_id<>auth.uid() or not public.can_prescribe(a.patient_id) then raise exception 'schedule_unavailable' using errcode='42501'; end if;
 update public.exercise_assignments set active=false where id=p_assignment and active;
end $$;

-- A schedule that has started ends today, and today stays an exercise day if it was one. One that has not started is cancelled.
create function public.end_exercise_schedule(p_schedule uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare today date:=public.center_date(); s public.exercise_schedules;
begin
 select * into s from public.exercise_schedules where id=p_schedule for update;
 if not found or s.therapist_id<>auth.uid() or not public.can_prescribe(s.patient_id) then raise exception 'schedule_unavailable' using errcode='42501'; end if;
 if s.cancelled_at is null and s.starts_on>today then
  update public.exercise_schedules set cancelled_at=now(),updated_at=now() where id=s.id returning * into s;
  update public.exercise_assignments set active=false where schedule_id=s.id and active;
 elsif s.cancelled_at is null and s.ends_on>today then
  update public.exercise_schedules set ends_on=today,rest_dates=array(select d from unnest(s.rest_dates) d where d<=today order by d),updated_at=now() where id=s.id returning * into s;
 end if;
 return public.schedule_json(s);
end $$;

-- Whether an exercise was finished between two instants. A both-sides exercise needs both sides; which kind it is follows its newest version.
create function public.assignment_done_between(p_assignment uuid,p_patient uuid,p_from timestamptz,p_to timestamptz) returns boolean language sql stable security definer set search_path='' as $$
 select case when (select p.side from public.prescription_versions p where p.assignment_id=p_assignment order by p.version desc limit 1)='bilateral'
  then (select count(distinct m.side) from public.sessions x join public.prescription_versions p on p.id=x.prescription_version_id join public.session_measurements m on m.session_id=x.id
        where x.patient_id=p_patient and p.assignment_id=p_assignment and x.started_at>=p_from and x.started_at<p_to and m.side in ('left','right'))=2
  else exists(select 1 from public.sessions x join public.prescription_versions p on p.id=x.prescription_version_id
        where x.patient_id=p_patient and p.assignment_id=p_assignment and x.started_at>=p_from and x.started_at<p_to) end
$$;

-- A patient's exercise day: each active exercise with its schedule, whether it is due and whether it is done, and each current or
-- coming schedule with its state that day and its next exercise day. For the patient and their linked therapists only.
create function public.exercise_day(p_patient uuid,p_day date default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare day date:=coalesce(p_day,public.center_date()); zone text; day_start timestamptz; day_end timestamptz;
begin
 if p_patient is null or not public.is_active_user() or not ((p_patient=auth.uid() and public.has_role('patient')) or public.can_prescribe(p_patient))
 then raise exception 'schedule_unavailable' using errcode='42501'; end if;
 select time_zone into strict zone from public.center_settings;
 day_start:=day::timestamp at time zone zone; day_end:=(day+1)::timestamp at time zone zone;
 return jsonb_build_object('day',day,
  'exercises',coalesce((select jsonb_agg(jsonb_build_object('assignment_id',a.id,'schedule_id',a.schedule_id,'therapist_id',a.therapist_id,
     'due',case when a.schedule_id is null then true else public.schedule_has_day(s,day) end,
     'done',public.assignment_done_between(a.id,a.patient_id,day_start,day_end)) order by a.created_at,a.id)
   from public.exercise_assignments a left join public.exercise_schedules s on s.id=a.schedule_id
   where a.patient_id=p_patient and a.active),'[]'::jsonb),
  'schedules',coalesce((select jsonb_agg(public.schedule_json(s) || jsonb_build_object(
     'state',case when day<s.starts_on then 'upcoming' when day>s.ends_on then 'ended' when public.schedule_has_day(s,day) then 'exercise' else 'rest' end,
     'days_left',public.schedule_day_count(s,day),
     'next_day',(select min(d)::date from generate_series(greatest(day+1,s.starts_on)::timestamp,s.ends_on::timestamp,interval '1 day') d where public.schedule_has_day(s,d::date)))
    order by s.starts_on,s.created_at)
   from public.exercise_schedules s where s.patient_id=p_patient and s.cancelled_at is null and s.ends_on>=day),'[]'::jsonb));
end $$;

revoke all on function public.center_date(timestamptz),public.schedule_has_day(public.exercise_schedules,date),public.schedule_day_count(public.exercise_schedules,date),
 public.schedule_json(public.exercise_schedules),public.save_exercise_schedule(uuid,uuid,date,date,integer[],date[]),
 public.publish_scheduled_prescription(uuid,uuid,uuid,uuid,uuid,text,numeric,numeric,integer,jsonb),public.stop_exercise(uuid),public.end_exercise_schedule(uuid),
 public.assignment_done_between(uuid,uuid,timestamptz,timestamptz),public.exercise_day(uuid,date) from public,anon,authenticated;
grant execute on function public.save_exercise_schedule(uuid,uuid,date,date,integer[],date[]),public.publish_scheduled_prescription(uuid,uuid,uuid,uuid,uuid,text,numeric,numeric,integer,jsonb),
 public.stop_exercise(uuid),public.end_exercise_schedule(uuid),public.exercise_day(uuid,date) to authenticated;
