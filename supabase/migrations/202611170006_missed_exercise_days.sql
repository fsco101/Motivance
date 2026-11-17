-- Missed exercise days (#128). A missed day is never carried over to the patient: each day lists only its own exercises. The
-- therapist hears about it instead. Each finished exercise day is recorded once per patient and therapist, and a day with
-- something left undone sends the therapist one notification the next morning, inside the usual 08:00-20:00 window. It has its own
-- push switch, and like the other care kinds it never sends email. See docs/superpowers/specs/2026-11-17-exercise-schedule-design.md.

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check(kind in (
 'confirmed','rejected','cancelled','rescheduled','therapist_changed','returned_to_pending',
 'session_assigned','session_moved','session_cancelled','session_removed',
 'request_received','patient_cancelled','needs_therapist','reminder','session_reminder','place_open','patient_rescheduled',
 'series_booked','series_assigned','series_cancelled','session_series_cancelled',
 'plan_updated','session_finished','practice_reminder','patient_inactive','care_linked','care_unlinked','patient_linked','patient_unlinked',
 'chat_message','exercise_missed'));

create or replace function public.notification_group(p_kind text) returns text language sql immutable set search_path='' as $$
 select case p_kind
  when 'plan_updated' then 'exercise_plan'
  when 'session_finished' then 'session_results'
  when 'patient_inactive' then 'inactivity'
  when 'practice_reminder' then 'practice'
  when 'care_linked' then 'care_team' when 'care_unlinked' then 'care_team' when 'patient_linked' then 'care_team' when 'patient_unlinked' then 'care_team'
  when 'chat_message' then 'messages'
  when 'exercise_missed' then 'missed_days'
  else 'bookings' end
$$;

alter table public.notification_settings add column missed_days boolean not null default true;

create or replace function public.my_notification_settings() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.notification_settings;
begin
 if not public.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 select * into s from public.notification_settings where user_id=auth.uid();
 return jsonb_build_object('bookings',coalesce(s.bookings,true),'exercise_plan',coalesce(s.exercise_plan,true),'session_results',coalesce(s.session_results,true),
  'inactivity',coalesce(s.inactivity,true),'care_team',coalesce(s.care_team,true),'messages',coalesce(s.messages,true),'missed_days',coalesce(s.missed_days,true),
  'reminder_time',to_char(s.reminder_time,'HH24:MI'));
end $$;

-- One more switch. An app that does not send it leaves it as it was, so an older build cannot reset it.
drop function public.save_notification_settings(boolean,boolean,boolean,boolean,boolean,text,boolean);
create function public.save_notification_settings(p_bookings boolean,p_exercise_plan boolean,p_session_results boolean,p_inactivity boolean,p_care_team boolean,
 p_reminder_time text default null,p_messages boolean default null,p_missed_days boolean default null) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_bookings is null or p_exercise_plan is null or p_session_results is null or p_inactivity is null or p_care_team is null
 or (p_reminder_time is not null and p_reminder_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then raise exception 'booking_invalid'; end if;
 insert into public.notification_settings(user_id,bookings,exercise_plan,session_results,inactivity,care_team,reminder_time,messages,missed_days,updated_at)
 values(auth.uid(),p_bookings,p_exercise_plan,p_session_results,p_inactivity,p_care_team,p_reminder_time::time,coalesce(p_messages,true),coalesce(p_missed_days,true),now())
 on conflict(user_id) do update set bookings=excluded.bookings,exercise_plan=excluded.exercise_plan,session_results=excluded.session_results,
  inactivity=excluded.inactivity,care_team=excluded.care_team,reminder_time=excluded.reminder_time,
  messages=coalesce(p_messages,public.notification_settings.messages),missed_days=coalesce(p_missed_days,public.notification_settings.missed_days),updated_at=now();
 return public.my_notification_settings();
end $$;

-- Push for everything but bookings' email, as before, with the missed-days switch as well.
create or replace function public.queue_notification_email() returns trigger language plpgsql security definer set search_path='' as $$
declare kind_group text:=public.notification_group(new.kind); s public.notification_settings; allowed boolean; muted boolean:=false;
begin
 if kind_group='bookings' then
  insert into public.notification_deliveries(notification_id,channel) values(new.id,'email') on conflict do nothing;
 end if;
 select * into s from public.notification_settings where user_id=new.user_id;
 if kind_group='messages' then
  muted:=exists(select 1 from public.chat_mutes m where m.user_id=new.user_id and m.conversation_id::text=new.data->>'conversation_id');
 end if;
 allowed:=case kind_group when 'bookings' then coalesce(s.bookings,true) when 'exercise_plan' then coalesce(s.exercise_plan,true)
  when 'session_results' then coalesce(s.session_results,true) when 'inactivity' then coalesce(s.inactivity,true) when 'care_team' then coalesce(s.care_team,true)
  when 'messages' then coalesce(s.messages,true) and not muted when 'missed_days' then coalesce(s.missed_days,true) else true end;
 if allowed then
  insert into public.notification_deliveries(notification_id,channel) values(new.id,'push') on conflict do nothing;
 else
  insert into public.notification_deliveries(notification_id,channel,status,last_error) values(new.id,'push','skipped',case when muted then 'Muted' else 'Turned off' end) on conflict do nothing;
 end if;
 return new;
end $$;

-- What happened on each finished exercise day, per patient and therapist: how many exercises were due, how many were done, and which
-- were missed. Recorded once, so later changes to a schedule never rewrite a day already past.
create table public.exercise_day_results (
 patient_id uuid not null references public.patients(id),
 therapist_id uuid not null references public.profiles(id),
 day date not null,
 due integer not null check(due>0),
 done integer not null check(done between 0 and due),
 missed uuid[] not null default '{}',
 recorded_at timestamptz not null default now(),
 notified_at timestamptz,
 primary key(patient_id,therapist_id,day)
);
create index exercise_day_results_unsent on public.exercise_day_results(day) where notified_at is null and done<due;
alter table public.exercise_day_results enable row level security;
revoke all on public.exercise_day_results from anon,authenticated;
grant select on public.exercise_day_results to authenticated;
create policy exercise_day_results_read on public.exercise_day_results for select to authenticated using(public.can_read_patient(patient_id));

-- Records the last three days once each, so a job that missed a run catches up, and tells each therapist about a day with something
-- left undone. Only scheduled exercises count: an every-day exercise is followed by the inactivity alert, as before. A day counts from
-- the day after the exercise was added, so one added in the evening is never reported missed that same day.
-- p_now exists for tests. The scheduled job always uses the real time.
create function public.record_exercise_days(p_now timestamptz default now()) returns integer language plpgsql security definer set search_path='' as $$
declare zone text; today date; local_hour integer; item record; total integer:=0;
begin
 select time_zone into strict zone from public.center_settings;
 today:=(p_now at time zone zone)::date;
 local_hour:=extract(hour from p_now at time zone zone)::integer;
 insert into public.exercise_day_results(patient_id,therapist_id,day,due,done,missed)
 select patient_id,therapist_id,day,count(*)::integer,(count(*) filter (where done))::integer,coalesce(array_agg(id order by created_at,id) filter (where not done),'{}')
 from (
  select a.id,a.patient_id,a.therapist_id,a.created_at,d.day,
   public.assignment_done_between(a.id,a.patient_id,d.day::timestamp at time zone zone,(d.day+1)::timestamp at time zone zone) as done
  from public.exercise_assignments a
  join public.exercise_schedules s on s.id=a.schedule_id
  join public.therapist_patients l on l.therapist_id=a.therapist_id and l.patient_id=a.patient_id and l.active
  join public.profiles p on p.id=a.patient_id and p.active
  cross join lateral (select (today-g)::date as day from generate_series(1,3) g) d
  where a.active and public.schedule_has_day(s,d.day) and d.day>(a.created_at at time zone zone)::date
 ) due
 group by patient_id,therapist_id,day
 on conflict do nothing;
 -- Nobody needs this at night: the morning brings it.
 if local_hour<8 or local_hour>=20 then return 0; end if;
 for item in
  select r.patient_id,r.therapist_id,r.day,r.due,r.done from public.exercise_day_results r
  where r.notified_at is null and r.done<r.due and r.day>=today-3
   and exists(select 1 from public.therapist_patients l where l.therapist_id=r.therapist_id and l.patient_id=r.patient_id and l.active)
  order by r.day,r.patient_id,r.therapist_id for update skip locked
 loop
  if public.notify_person(item.therapist_id,'exercise_missed',item.patient_id,
   jsonb_build_object('patient_name',public.person_name(item.patient_id),'day',item.day,'due',item.due,'done',item.done),
   item.patient_id::text||':'||item.day::text,null) then total:=total+1; end if;
  update public.exercise_day_results set notified_at=now() where patient_id=item.patient_id and therapist_id=item.therapist_id and day=item.day;
 end loop;
 return total;
end $$;

-- The inactivity alert now follows every-day exercises only. A patient whose exercises with a therapist are all scheduled is followed
-- day by day instead, so the therapist is not told twice. Otherwise unchanged from 202611130002.
create or replace function public.enqueue_inactivity_alerts(p_now timestamptz default now()) returns integer language plpgsql security definer set search_path='' as $$
declare zone text; local_hour integer; item record; total integer:=0;
begin
 select time_zone into strict zone from public.center_settings;
 local_hour:=extract(hour from p_now at time zone zone)::integer;
 if local_hour<8 or local_hour>=20 then return 0; end if;
 for item in
  select q.therapist_id,q.patient_id,q.last_session,greatest(q.plan_start,q.last_session) as anchor from (
   select l.therapist_id,l.patient_id,min(a.created_at) as plan_start,(select max(x.started_at) from public.sessions x where x.patient_id=l.patient_id) as last_session
   from public.therapist_patients l
   join public.exercise_assignments a on a.therapist_id=l.therapist_id and a.patient_id=l.patient_id and a.active and a.schedule_id is null
   join public.profiles p on p.id=l.patient_id and p.active
   where l.active
   group by l.therapist_id,l.patient_id
  ) q order by q.therapist_id,q.patient_id
 loop
  if item.anchor<=p_now-interval '3 days' and public.notify_person(item.therapist_id,'patient_inactive',item.patient_id,
   jsonb_build_object('patient_name',public.person_name(item.patient_id),'days',floor(extract(epoch from p_now-item.anchor)/86400)::integer,'last_session_at',item.last_session),
   item.patient_id::text||':'||floor(extract(epoch from item.anchor)*1000)::bigint::text,null) then
   total:=total+1;
  end if;
 end loop;
 return total;
end $$;

-- The day as before, with the missed days of the last 30 so the record can mark them. The day is on_day here, because the results
-- table has a column named day.
create or replace function public.exercise_day(p_patient uuid,p_day date default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare on_day date:=coalesce(p_day,public.center_date()); zone text; day_start timestamptz; day_end timestamptz;
begin
 if p_patient is null or not public.is_active_user() or not ((p_patient=auth.uid() and public.has_role('patient')) or public.can_prescribe(p_patient))
 then raise exception 'schedule_unavailable' using errcode='42501'; end if;
 select time_zone into strict zone from public.center_settings;
 day_start:=on_day::timestamp at time zone zone; day_end:=(on_day+1)::timestamp at time zone zone;
 return jsonb_build_object('day',on_day,
  'exercises',coalesce((select jsonb_agg(jsonb_build_object('assignment_id',a.id,'schedule_id',a.schedule_id,'therapist_id',a.therapist_id,
     'due',case when a.schedule_id is null then true else public.schedule_has_day(s,on_day) end,
     'done',public.assignment_done_between(a.id,a.patient_id,day_start,day_end)) order by a.created_at,a.id)
   from public.exercise_assignments a left join public.exercise_schedules s on s.id=a.schedule_id
   where a.patient_id=p_patient and a.active),'[]'::jsonb),
  'schedules',coalesce((select jsonb_agg(public.schedule_json(s) || jsonb_build_object(
     'state',case when on_day<s.starts_on then 'upcoming' when on_day>s.ends_on then 'ended' when public.schedule_has_day(s,on_day) then 'exercise' else 'rest' end,
     'days_left',public.schedule_day_count(s,on_day),
     'next_day',(select min(d)::date from generate_series(greatest(on_day+1,s.starts_on)::timestamp,s.ends_on::timestamp,interval '1 day') d where public.schedule_has_day(s,d::date)))
    order by s.starts_on,s.created_at)
   from public.exercise_schedules s where s.patient_id=p_patient and s.cancelled_at is null and s.ends_on>=on_day),'[]'::jsonb),
  'missed',coalesce((select jsonb_agg(jsonb_build_object('day',r.day,'therapist_id',r.therapist_id,'due',r.due,'done',r.done) order by r.day desc,r.therapist_id)
   from public.exercise_day_results r where r.patient_id=p_patient and r.done<r.due and r.day>=on_day-30 and r.day<on_day),'[]'::jsonb));
end $$;

revoke all on function public.save_notification_settings(boolean,boolean,boolean,boolean,boolean,text,boolean,boolean),public.record_exercise_days(timestamptz),
 public.enqueue_inactivity_alerts(timestamptz),public.exercise_day(uuid,date) from public,anon,authenticated;
grant execute on function public.save_notification_settings(boolean,boolean,boolean,boolean,boolean,text,boolean,boolean),public.exercise_day(uuid,date) to authenticated;

select cron.schedule('missed-exercise-days','*/30 * * * *','select public.record_exercise_days()');
