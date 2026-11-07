-- Who came, so no-shows are visible. Attendance is a fact about a session that has started, recorded by the people who were there to see it.
alter table public.booking_events add column from_attendance text,add column to_attendance text;

-- The same record as before, now saying what a mark was, so a correction can be told from the mark it replaced.
create or replace function public.record_booking_event() returns trigger language plpgsql security definer set search_path='' as $$
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
 insert into public.booking_events(booking_id,actor_id,actor_role,action,from_status,to_status,from_starts_at,to_starts_at,from_therapist,to_therapist,reason,from_attendance,to_attendance)
 values(new.id,actor,acting,what,old.status,new.status,old.starts_at,new.starts_at,old.therapist_id,new.therapist_id,new.status_reason,old.attendance,new.attendance);
 insert into public.audit_events(actor_id,action,target_type,target_id) values(actor,what,'bookings',new.id::text);
 return new;
end $$;

-- A mark describes the time a session had. Moved to another time, nobody has attended it yet.
create function public.clear_moved_attendance() returns trigger language plpgsql set search_path='' as $$
begin
 if new.starts_at is distinct from old.starts_at then
  new.attendance:=null; new.attendance_by:=null; new.attendance_at:=null;
 end if;
 return new;
end $$;
create trigger clear_moved_attendance before update on public.bookings for each row execute function public.clear_moved_attendance();

-- The assigned therapist or a Scheduler, once the session has started. Marking again corrects it, and the same mark again changes nothing.
create function public.mark_attendance(p_booking uuid,p_attendance text) returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.bookings;
begin
 if not (public.has_role('scheduler') or public.has_role('therapist')) then raise exception 'Staff access required' using errcode='42501'; end if;
 if p_attendance is null or p_attendance not in ('attended','no_show') then raise exception 'booking_invalid'; end if;
 select * into target from public.bookings where id=p_booking for update;
 if not found then raise exception 'booking_unavailable'; end if;
 if not public.has_role('scheduler') and target.therapist_id is distinct from auth.uid() then raise exception 'Assigned therapist required' using errcode='42501'; end if;
 if target.status not in ('confirmed','rescheduled') then raise exception 'booking_state'; end if;
 if target.starts_at>now() then raise exception 'booking_not_started'; end if;
 update public.bookings set attendance=p_attendance,attendance_by=auth.uid(),attendance_at=now() where id=target.id and attendance is distinct from p_attendance returning * into target;
 return jsonb_build_object('id',p_booking,'attendance',p_attendance);
end $$;

-- The server says when a session has started, so the apps cannot disagree with it about the moment attendance opens.
create or replace function public.schedule_view(b public.bookings,p_therapist boolean) returns jsonb language sql stable security definer set search_path='' as $$
 select case when p_therapist then jsonb_build_object('id',b.id,'reference_no',b.reference_no,'status',b.status,'starts_at',b.starts_at,'ends_at',b.ends_at,
   'attendance',b.attendance,'started',b.starts_at<=now(),'location',(select location from public.center_settings),'patient_id',b.patient_id,
   'patient_name',(select display_name from public.profiles where id=b.patient_id),
   'linked',exists(select 1 from public.therapist_patients where therapist_id=b.therapist_id and patient_id=b.patient_id and active))
  else public.my_booking_view(b) end
$$;

-- Search, filters, sorting and paging all happen here, so the table stays correct however many bookings there are.
drop function public.scheduler_bookings(text,text[],date,date,uuid,uuid,text,boolean,integer,integer);
create function public.scheduler_bookings(p_search text default null,p_statuses text[] default null,p_from date default null,p_to date default null,
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
   select b.id,b.reference_no,b.status,b.status_reason,b.starts_at,b.ends_at,b.previous_starts_at,b.patient_id,b.therapist_id,b.attendance,b.starts_at<=now() as started,b.created_at,
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
  'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'actor_role',e.actor_role,'actor_name',a.display_name,'from_status',e.from_status,'to_status',e.to_status,
    'from_starts_at',e.from_starts_at,'to_starts_at',e.to_starts_at,'reason',e.reason,'to_attendance',e.to_attendance,'recorded_at',e.recorded_at) order by e.id desc)
   from public.booking_events e left join public.profiles a on a.id=e.actor_id where e.booking_id=target.id),'[]'::jsonb));
end $$;

revoke all on function public.clear_moved_attendance(),public.mark_attendance(uuid,text),public.scheduler_bookings(text,text[],date,date,uuid,uuid,text,boolean,integer,integer,text) from public,anon,authenticated;
grant execute on function public.mark_attendance(uuid,text),public.scheduler_bookings(text,text[],date,date,uuid,uuid,text,boolean,integer,integer,text) to authenticated;
