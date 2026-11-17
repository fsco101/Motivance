-- A reason for each visit, and both people on every booking and schedule view.
--
-- A patient says why they are coming when they ask for a session; a Scheduler may add one to a weekly course. The reason
-- stays with the booking through every move. It is seen by the patient, the therapist assigned to the session and
-- Schedulers, and nowhere else: it is not in notifications, emails, pushes, calendar files or the administrators' feed,
-- because those can be read on a lock screen or by someone who is not part of the visit. Older bookings, and requests from
-- older app versions, have none.
--
-- Every view of a booking also names both people with their photos, so each app can show the session as a card with the
-- patient and the therapist side by side.

alter table public.bookings add column visit_reason text
 check(visit_reason is null or (visit_reason=btrim(visit_reason) and char_length(visit_reason) between 3 and 500));

-- Blank means none. Anything shorter than three characters or longer than 500 is refused, as each app's form says.
create function public.visit_reason(p_reason text) returns text language plpgsql immutable set search_path='' as $$
declare cleaned text:=nullif(btrim(coalesce(p_reason,'')),'');
begin
 if cleaned is not null and char_length(cleaned) not between 3 and 500 then raise exception 'booking_visit_reason'; end if;
 return cleaned;
end $$;

create or replace function public.booking_view(b public.bookings) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',b.id,'reference_no',b.reference_no,'status',b.status,'status_reason',b.status_reason,'starts_at',b.starts_at,'ends_at',b.ends_at,
  'previous_starts_at',b.previous_starts_at,'therapist_id',b.therapist_id,'therapist_name',(select display_name from public.profiles where id=b.therapist_id),
  'therapist_photo',(select photo_url from public.profiles where id=b.therapist_id),
  'patient_name',(select display_name from public.profiles where id=b.patient_id),'patient_photo',(select photo_url from public.profiles where id=b.patient_id),
  'visit_reason',b.visit_reason,'attendance',b.attendance,'created_at',b.created_at)
$$;

create or replace function public.schedule_view(b public.bookings,p_therapist boolean) returns jsonb language sql stable security definer set search_path='' as $$
 select case when p_therapist then jsonb_build_object('id',b.id,'reference_no',b.reference_no,'status',b.status,'starts_at',b.starts_at,'ends_at',b.ends_at,
   'attendance',b.attendance,'started',b.starts_at<=now(),'location',(select location from public.center_settings),'patient_id',b.patient_id,
   'patient_name',(select display_name from public.profiles where id=b.patient_id),
   'patient_photo',(select photo_url from public.profiles where id=b.patient_id),
   'therapist_name',(select display_name from public.profiles where id=b.therapist_id),
   'therapist_photo',(select photo_url from public.profiles where id=b.therapist_id),
   'visit_reason',b.visit_reason,
   'linked',exists(select 1 from public.therapist_patients where therapist_id=b.therapist_id and patient_id=b.patient_id and active))
  else public.my_booking_view(b) end
$$;

-- The same request as before, with the reason. A retry with the same request ID returns the booking already made.
drop function public.request_booking(uuid,timestamptz);
create function public.request_booking(p_request uuid,p_starts timestamptz,p_reason text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare settings public.center_settings; existing public.bookings; created public.bookings; problem text; ends timestamptz; reason text;
begin
 if not public.has_role('patient') then raise exception 'Patient access required' using errcode='42501'; end if;
 if p_request is null or p_starts is null then raise exception 'booking_invalid'; end if;
 reason:=public.visit_reason(p_reason);
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
 insert into public.bookings(reference_no,patient_id,starts_at,ends_at,client_request_id,visit_reason)
 values('BK-'||to_char(now() at time zone settings.time_zone,'YYYY')||'-'||lpad(nextval('public.booking_reference')::text,6,'0'),auth.uid(),p_starts,ends,p_request,reason)
 returning * into created;
 return public.booking_view(created);
end $$;

-- A weekly course may carry one reason, given to each of its sessions.
drop function public.scheduler_series_create(uuid,uuid,uuid,timestamptz,integer);
create function public.scheduler_series_create(p_request uuid,p_patient uuid,p_therapist uuid,p_starts timestamptz,p_weeks integer,p_reason text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare settings public.center_settings; series public.booking_series; made public.bookings; opening public.bookings; closing public.bookings; slot timestamptz; ends timestamptz; total integer:=0; facts jsonb; event bigint; reason text;
begin
 perform public.require_scheduler();
 if p_request is null then raise exception 'booking_invalid'; end if;
 reason:=public.visit_reason(p_reason);
 perform pg_advisory_xact_lock(724020);
 select * into series from public.booking_series where client_request_id=p_request;
 if found then return public.series_view(series.id); end if;
 perform public.series_check(p_patient,p_therapist,p_starts,p_weeks);
 select * into strict settings from public.center_settings;
 insert into public.booking_series(patient_id,therapist_id,weeks,client_request_id,created_by) values(p_patient,p_therapist,p_weeks,p_request,auth.uid()) returning * into series;
 for slot in select * from public.series_dates(p_starts,p_weeks) loop
  ends:=slot+make_interval(mins=>settings.slot_minutes);
  if public.series_problem(p_patient,p_therapist,slot,ends) is null then
   insert into public.bookings(reference_no,patient_id,therapist_id,series_id,starts_at,ends_at,status,visit_reason)
   values('BK-'||to_char(now() at time zone settings.time_zone,'YYYY')||'-'||lpad(nextval('public.booking_reference')::text,6,'0'),p_patient,p_therapist,series.id,slot,ends,'confirmed',reason) returning * into made;
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

-- The Scheduler's tables carry the reason, so a request can be judged without opening it. Unchanged apart from that column.
create or replace function public.scheduler_bookings(p_search text default null,p_statuses text[] default null,p_from date default null,p_to date default null,p_therapist uuid default null,
 p_patient uuid default null,p_sort text default 'starts_at',p_descending boolean default false,p_limit integer default 25,p_offset integer default 0,p_attendance text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
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
   select b.id,b.reference_no,b.status,b.status_reason,b.starts_at,b.ends_at,b.previous_starts_at,b.patient_id,b.therapist_id,b.attendance,b.series_id,b.starts_at<=now() as started,b.created_at,b.visit_reason,
    pp.display_name as patient_name,tp.display_name as therapist_name,pp.photo_url as patient_photo,tp.photo_url as therapist_photo,row_number() over(order by %s %s nulls last,b.id) as position
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
end $function$;

revoke all on function public.visit_reason(text) from public,anon,authenticated;
revoke all on function public.request_booking(uuid,timestamptz,text),public.scheduler_series_create(uuid,uuid,uuid,timestamptz,integer,text) from public,anon;
grant execute on function public.request_booking(uuid,timestamptz,text),public.scheduler_series_create(uuid,uuid,uuid,timestamptz,integer,text) to authenticated;
