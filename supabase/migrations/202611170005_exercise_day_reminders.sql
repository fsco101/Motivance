-- The daily practice reminder follows exercise schedules (#127). A patient is reminded only on a day with an exercise still to do:
-- never on a rest day, before a schedule starts or after it ends, and not once every exercise due today is done. An exercise without
-- a schedule is due every day, as before. Otherwise the rule is unchanged: once, in the two hours after the chosen time.
create or replace function public.enqueue_practice_reminders(p_now timestamptz default now()) returns integer language plpgsql security definer set search_path='' as $$
declare zone text; local_now timestamp; today date; day_start timestamptz; day_end timestamptz; person uuid; total integer:=0;
begin
 select time_zone into strict zone from public.center_settings;
 local_now:=p_now at time zone zone;
 today:=local_now::date;
 day_start:=today::timestamp at time zone zone;
 day_end:=(today+1)::timestamp at time zone zone;
 for person in
  select s.user_id from public.notification_settings s join public.profiles p on p.id=s.user_id and p.active
  where s.reminder_time is not null and local_now::time>=s.reminder_time and local_now<today+s.reminder_time+interval '2 hours'
   and exists(select 1 from public.exercise_assignments a
    join public.therapist_patients l on l.therapist_id=a.therapist_id and l.patient_id=a.patient_id and l.active
    left join public.exercise_schedules sc on sc.id=a.schedule_id
    where a.patient_id=s.user_id and a.active and (a.schedule_id is null or public.schedule_has_day(sc,today))
     and not public.assignment_done_between(a.id,a.patient_id,day_start,day_end))
  order by s.user_id
 loop
  if public.notify_person(person,'practice_reminder',null,jsonb_build_object('date',today),today::text,null) then total:=total+1; end if;
 end loop;
 return total;
end $$;

revoke all on function public.enqueue_practice_reminders(timestamptz) from public,anon,authenticated;
