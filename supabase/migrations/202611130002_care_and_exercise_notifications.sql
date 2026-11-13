-- Exercise plans, finished sessions, a daily practice reminder, inactivity and care-team changes reach the bell on both apps, and push
-- on Android. They ride the same table and queue as booking notifications, so retries, dedupe and dead-phone cleanup come with them.
-- Only booking kinds send email: a daily reminder or one email per finished session would be noise.

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check(kind in (
 'confirmed','rejected','cancelled','rescheduled','therapist_changed','returned_to_pending',
 'session_assigned','session_moved','session_cancelled','session_removed',
 'request_received','patient_cancelled','needs_therapist','reminder','session_reminder','place_open','patient_rescheduled',
 'series_booked','series_assigned','series_cancelled','session_series_cancelled',
 'plan_updated','session_finished','practice_reminder','patient_inactive','care_linked','care_unlinked','patient_linked','patient_unlinked'));

-- Which switch a kind answers to. Everything that is not one of the new kinds is about a booking.
create function public.notification_group(p_kind text) returns text language sql immutable set search_path='' as $$
 select case p_kind
  when 'plan_updated' then 'exercise_plan'
  when 'session_finished' then 'session_results'
  when 'patient_inactive' then 'inactivity'
  when 'practice_reminder' then 'practice'
  when 'care_linked' then 'care_team' when 'care_unlinked' then 'care_team' when 'patient_linked' then 'care_team' when 'patient_unlinked' then 'care_team'
  else 'bookings' end
$$;

-- What each person wants pushed to their phone. No row means every switch on and no daily reminder. The bell always shows everything.
create table public.notification_settings (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 bookings boolean not null default true,
 exercise_plan boolean not null default true,
 session_results boolean not null default true,
 inactivity boolean not null default true,
 care_team boolean not null default true,
 -- In the center's time zone. Null means no daily reminder.
 reminder_time time check(reminder_time is null or extract(second from reminder_time)=0),
 updated_at timestamptz not null default now()
);
alter table public.notification_settings enable row level security;
revoke all on public.notification_settings from anon,authenticated;

create function public.my_notification_settings() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.notification_settings;
begin
 if not public.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 select * into s from public.notification_settings where user_id=auth.uid();
 return jsonb_build_object('bookings',coalesce(s.bookings,true),'exercise_plan',coalesce(s.exercise_plan,true),'session_results',coalesce(s.session_results,true),
  'inactivity',coalesce(s.inactivity,true),'care_team',coalesce(s.care_team,true),'reminder_time',to_char(s.reminder_time,'HH24:MI'));
end $$;

-- Only ever the caller's own. The reminder is "HH:MM" on a 24-hour clock, or null for none.
create function public.save_notification_settings(p_bookings boolean,p_exercise_plan boolean,p_session_results boolean,p_inactivity boolean,p_care_team boolean,
 p_reminder_time text default null) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_bookings is null or p_exercise_plan is null or p_session_results is null or p_inactivity is null or p_care_team is null
 or (p_reminder_time is not null and p_reminder_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then raise exception 'booking_invalid'; end if;
 insert into public.notification_settings(user_id,bookings,exercise_plan,session_results,inactivity,care_team,reminder_time,updated_at)
 values(auth.uid(),p_bookings,p_exercise_plan,p_session_results,p_inactivity,p_care_team,p_reminder_time::time,now())
 on conflict(user_id) do update set bookings=excluded.bookings,exercise_plan=excluded.exercise_plan,session_results=excluded.session_results,
  inactivity=excluded.inactivity,care_team=excluded.care_team,reminder_time=excluded.reminder_time,updated_at=now();
 return public.my_notification_settings();
end $$;

-- One notification for one person, about one other. The key makes a retry, or a job that runs twice, add nothing.
-- Returns whether anything was added.
create function public.notify_person(p_user uuid,p_kind text,p_subject uuid,p_data jsonb,p_key text,p_actor uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare added integer;
begin
 -- Nobody needs telling what they have just done themselves.
 if p_user is null or p_user is not distinct from p_actor then return false; end if;
 insert into public.notifications(user_id,kind,subject_id,data,dedupe_key) values(p_user,p_kind,p_subject,coalesce(p_data,'{}'::jsonb),p_kind||':'||p_key)
 on conflict(user_id,dedupe_key) do nothing;
 get diagnostics added=row_count;
 return added>0;
exception when foreign_key_violation then
 return false;
end $$;

create function public.person_name(p_person uuid) returns text language sql stable security definer set search_path='' as $$
 select coalesce((select display_name from public.profiles where id=p_person),'')
$$;

-- A therapist often publishes several exercises in a row, so a quarter of an hour of publishing is one notification.
-- A notification is never allowed to stop the change that caused it, so a failure here is only logged.
create function public.notify_plan_updated() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform public.notify_person(new.patient_id,'plan_updated',new.created_by,jsonb_build_object('therapist_name',public.person_name(new.created_by)),
  new.created_by::text||':'||floor(extract(epoch from now())/900)::bigint::text,auth.uid());
 return new;
exception when others then
 raise warning 'plan_updated notification skipped: %',sqlerrm;
 return new;
end $$;
create trigger notify_plan_updated after insert on public.prescription_versions for each row execute function public.notify_plan_updated();

-- The measurement is written in the same transaction as its session, and it holds the repetitions, so this waits for it.
-- Only the therapist the plan belongs to hears, and only while that link is active.
create function public.notify_session_finished() returns trigger language plpgsql security definer set search_path='' as $$
declare s public.sessions; p public.prescription_versions; a public.exercise_assignments;
begin
 select * into s from public.sessions where id=new.session_id;
 if not found then return new; end if;
 select * into p from public.prescription_versions where id=s.prescription_version_id;
 select * into a from public.exercise_assignments where id=p.assignment_id;
 if a.id is null or not a.active or not exists(select 1 from public.therapist_patients where therapist_id=a.therapist_id and patient_id=s.patient_id and active) then return new; end if;
 perform public.notify_person(a.therapist_id,'session_finished',s.patient_id,jsonb_build_object('patient_name',public.person_name(s.patient_id),
  'completed',new.completed_repetitions,'target',p.target_repetitions,'side',new.side,'started_at',s.started_at),s.id::text,coalesce(auth.uid(),s.patient_id));
 return new;
exception when others then
 raise warning 'session_finished notification skipped: %',sqlerrm;
 return new;
end $$;
create trigger notify_session_finished after insert on public.session_measurements for each row execute function public.notify_session_finished();

-- A link made, made again or ended, however it happened: an accepted invitation, an administrator, or the therapist.
-- Taking away the therapist role ends every link at once, so the former therapist is not sent one notification per patient.
create function public.notify_care_change() returns trigger language plpgsql security definer set search_path='' as $$
declare linked boolean; facts jsonb; change_key text;
begin
 if tg_op='INSERT' then
  if not new.active then return new; end if;
  linked:=true;
 elsif new.active is distinct from old.active then
  linked:=new.active;
 else
  return new;
 end if;
 facts:=jsonb_build_object('therapist_name',public.person_name(new.therapist_id),'patient_name',public.person_name(new.patient_id));
 change_key:=new.therapist_id::text||':'||new.patient_id::text||':'||floor(extract(epoch from now())*1000)::bigint::text;
 perform public.notify_person(new.patient_id,case when linked then 'care_linked' else 'care_unlinked' end,new.therapist_id,facts,change_key,auth.uid());
 if exists(select 1 from public.user_roles where user_id=new.therapist_id and role='therapist') then
  perform public.notify_person(new.therapist_id,case when linked then 'patient_linked' else 'patient_unlinked' end,new.patient_id,facts,change_key,auth.uid());
 end if;
 return new;
exception when others then
 raise warning 'care notification skipped: %',sqlerrm;
 return new;
end $$;
create trigger notify_care_change after insert or update of active on public.therapist_patients for each row execute function public.notify_care_change();

-- A patient who chose a time, has a plan to do and has not started a session today is reminded once, in the two hours after it.
-- The window ends at midnight too, so a late time never spills into the next day.
-- p_now exists for tests. The scheduled job always uses the real time.
create function public.enqueue_practice_reminders(p_now timestamptz default now()) returns integer language plpgsql security definer set search_path='' as $$
declare zone text; local_now timestamp; today date; day_start timestamptz; person uuid; total integer:=0;
begin
 select time_zone into strict zone from public.center_settings;
 local_now:=p_now at time zone zone;
 today:=local_now::date;
 day_start:=today::timestamp at time zone zone;
 for person in
  select s.user_id from public.notification_settings s join public.profiles p on p.id=s.user_id and p.active
  where s.reminder_time is not null and local_now::time>=s.reminder_time and local_now<today+s.reminder_time+interval '2 hours'
   and exists(select 1 from public.exercise_assignments a join public.therapist_patients l on l.therapist_id=a.therapist_id and l.patient_id=a.patient_id and l.active
    where a.patient_id=s.user_id and a.active)
   and not exists(select 1 from public.sessions x where x.patient_id=s.user_id and x.started_at>=day_start)
  order by s.user_id
 loop
  if public.notify_person(person,'practice_reminder',null,jsonb_build_object('date',today),today::text,null) then total:=total+1; end if;
 end loop;
 return total;
end $$;

-- A patient with a plan who has not exercised for three days. The count starts at their last session, or at the plan if that is
-- later, so a new plan or a new link starts afresh. One alert per quiet stretch: the anchor is in the key, and it only moves when they
-- exercise again. Only in the day, because nobody needs this at night.
create function public.enqueue_inactivity_alerts(p_now timestamptz default now()) returns integer language plpgsql security definer set search_path='' as $$
declare zone text; local_hour integer; item record; total integer:=0;
begin
 select time_zone into strict zone from public.center_settings;
 local_hour:=extract(hour from p_now at time zone zone)::integer;
 if local_hour<8 or local_hour>=20 then return 0; end if;
 for item in
  select q.therapist_id,q.patient_id,q.last_session,greatest(q.plan_start,q.last_session) as anchor from (
   select l.therapist_id,l.patient_id,min(a.created_at) as plan_start,(select max(x.started_at) from public.sessions x where x.patient_id=l.patient_id) as last_session
   from public.therapist_patients l
   join public.exercise_assignments a on a.therapist_id=l.therapist_id and a.patient_id=l.patient_id and a.active
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

-- Email only for bookings. Push for everything, and a switch that is off records the push as skipped, so it can be seen and is
-- never sent later. A daily reminder only exists when the person asked for one, so it has no switch here.
create or replace function public.queue_notification_email() returns trigger language plpgsql security definer set search_path='' as $$
declare kind_group text:=public.notification_group(new.kind); s public.notification_settings; allowed boolean;
begin
 if kind_group='bookings' then
  insert into public.notification_deliveries(notification_id,channel) values(new.id,'email') on conflict do nothing;
 end if;
 select * into s from public.notification_settings where user_id=new.user_id;
 allowed:=case kind_group when 'bookings' then coalesce(s.bookings,true) when 'exercise_plan' then coalesce(s.exercise_plan,true)
  when 'session_results' then coalesce(s.session_results,true) when 'inactivity' then coalesce(s.inactivity,true) when 'care_team' then coalesce(s.care_team,true) else true end;
 if allowed then
  insert into public.notification_deliveries(notification_id,channel) values(new.id,'push') on conflict do nothing;
 else
  insert into public.notification_deliveries(notification_id,channel,status,last_error) values(new.id,'push','skipped','Turned off') on conflict do nothing;
 end if;
 return new;
end $$;

-- The same as before, with whose notification it is: the phone uses that to drop a practice reminder for a session it has not uploaded yet.
create or replace function public.claim_notification_deliveries(p_channel text default 'email',p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path='' as $$
declare settings public.center_settings; claimed uuid[]; result jsonb;
begin
 select * into strict settings from public.center_settings;
 with due as (
  select id from public.notification_deliveries
  where channel=p_channel and ((status='pending' and next_attempt_at<=now()) or (status='sending' and claimed_at<now()-interval '5 minutes'))
  order by next_attempt_at,id limit least(greatest(coalesce(p_limit,20),1),100) for update skip locked
 ), taken as (
  update public.notification_deliveries d set status='sending',claimed_at=now(),attempts=d.attempts+1 from due where d.id=due.id returning d.id
 ) select coalesce(array_agg(id),'{}') into claimed from taken;
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'attempts',d.attempts,'kind',n.kind,'data',n.data,'email',u.email,'name',p.display_name,'language',p.preferred_language,
   'calendar_token',b.calendar_token,'location',settings.location,'center_name',settings.center_name,'time_zone',settings.time_zone,'booking_id',n.booking_id,'user_id',n.user_id,
   'tokens',case when p.active then (select coalesce(jsonb_agg(t.token),'[]'::jsonb) from public.device_tokens t where t.user_id=n.user_id) else '[]'::jsonb end)),'[]'::jsonb) into result
 from public.notification_deliveries d join public.notifications n on n.id=d.notification_id join public.profiles p on p.id=n.user_id
 join auth.users u on u.id=n.user_id left join public.bookings b on b.id=n.booking_id where d.id=any(claimed);
 return result;
end $$;

revoke all on function public.notification_group(text),public.my_notification_settings(),public.save_notification_settings(boolean,boolean,boolean,boolean,boolean,text),
 public.notify_person(uuid,text,uuid,jsonb,text,uuid),public.person_name(uuid),public.notify_plan_updated(),public.notify_session_finished(),public.notify_care_change(),
 public.enqueue_practice_reminders(timestamptz),public.enqueue_inactivity_alerts(timestamptz) from public,anon,authenticated;
grant execute on function public.my_notification_settings(),public.save_notification_settings(boolean,boolean,boolean,boolean,boolean,text) to authenticated;

select cron.schedule('practice-reminders','*/5 * * * *','select public.enqueue_practice_reminders()');
select cron.schedule('inactivity-alerts','*/30 * * * *','select public.enqueue_inactivity_alerts()');
