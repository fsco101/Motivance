-- What a Scheduler needs to find and decide requests. Names, times and references only: nothing here opens a clinical record.

-- One calculation for both audiences. Patients are held to the notice and the horizon. Schedulers are not, so they can
-- book at short notice, and they see every open slot.
create function public.center_availability(p_from date,p_to date,p_staff boolean) returns jsonb
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
     'mine',not p_staff and exists(select 1 from public.bookings where patient_id=auth.uid() and status in ('pending','confirmed','rescheduled') and starts_at<slot+step and ends_at>slot));
    end if;
    slot:=slot+step;
   end loop;
   day_status:=case when jsonb_array_length(slots)>0 then 'open' when closed then 'closure' when far then 'too_far' when soon then 'too_soon' else 'closed' end;
  end if;
  days:=days||jsonb_build_object('date',day,'status',day_status,'holiday',holiday,'slots',slots);
 end loop;
 return jsonb_build_object('time_zone',settings.time_zone,'slot_minutes',settings.slot_minutes,'days',days);
end $$;

create or replace function public.booking_availability(p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 return public.center_availability(p_from,p_to,false);
end $$;

create function public.scheduler_availability(p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform public.require_scheduler();
 return public.center_availability(p_from,p_to,true);
end $$;

-- Search, filters, sorting and paging all happen here, so the table stays correct however many bookings there are.
create function public.scheduler_bookings(p_search text default null,p_statuses text[] default null,p_from date default null,p_to date default null,
 p_therapist uuid default null,p_patient uuid default null,p_sort text default 'starts_at',p_descending boolean default false,p_limit integer default 25,p_offset integer default 0)
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
  when 'patient' then 'lower(pp.display_name)' when 'therapist' then 'lower(tp.display_name)' else null end;
 if sorted is null then raise exception 'booking_invalid'; end if;
 execute format($q$
  with found as (
   select b.id,b.reference_no,b.status,b.status_reason,b.starts_at,b.ends_at,b.previous_starts_at,b.patient_id,b.therapist_id,b.attendance,b.created_at,
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
  )
  select jsonb_build_object('total',(select count(*) from found),
   'rows',coalesce((select jsonb_agg(to_jsonb(f)-'position' order by f.position) from found f where f.position>$9 and f.position<=$9+$8),'[]'::jsonb))
 $q$,sorted,case when p_descending then 'desc' else 'asc' end)
 into result using pattern,p_statuses,p_from,p_to,p_therapist,p_patient,settings.time_zone,least(greatest(coalesce(p_limit,25),1),500),greatest(coalesce(p_offset,0),0);
 return result;
end $$;

create function public.scheduler_booking_detail(p_booking uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target public.bookings;
begin
 perform public.require_scheduler();
 select * into target from public.bookings where id=p_booking;
 if not found then raise exception 'booking_unavailable'; end if;
 return public.booking_view(target)||jsonb_build_object(
  'patient_id',target.patient_id,'patient_name',(select display_name from public.profiles where id=target.patient_id),
  'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'actor_role',e.actor_role,'actor_name',a.display_name,'from_status',e.from_status,'to_status',e.to_status,
    'from_starts_at',e.from_starts_at,'to_starts_at',e.to_starts_at,'reason',e.reason,'recorded_at',e.recorded_at) order by e.id desc)
   from public.booking_events e left join public.profiles a on a.id=e.actor_id where e.booking_id=target.id),'[]'::jsonb));
end $$;

-- Who could take a session: therapists already linked to the patient first, and anyone busy at that time marked.
-- With no booking, every active therapist, which is what the table's filter needs.
create function public.scheduler_therapists(p_booking uuid default null,p_starts timestamptz default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target public.bookings; starts timestamptz; ends timestamptz; result jsonb;
begin
 perform public.require_scheduler();
 if p_booking is not null then
  select * into target from public.bookings where id=p_booking;
  if not found then raise exception 'booking_unavailable'; end if;
  starts:=coalesce(p_starts,target.starts_at);
  ends:=starts+(target.ends_at-target.starts_at);
 end if;
 select coalesce(jsonb_agg(to_jsonb(t) order by t.linked desc,lower(t.name),t.id),'[]'::jsonb) into result from (
  select p.id,p.display_name as name,
   exists(select 1 from public.therapist_patients l where l.therapist_id=p.id and l.patient_id=target.patient_id and l.active) as linked,
   exists(select 1 from public.bookings b where b.therapist_id=p.id and b.id<>target.id and b.status in ('pending','confirmed','rescheduled') and b.starts_at<ends and b.ends_at>starts) as busy
  from public.profiles p join public.user_roles r on r.user_id=p.id and r.role='therapist'
  where p.active
 ) t;
 return result;
end $$;

revoke all on function public.center_availability(date,date,boolean),public.scheduler_availability(date,date),public.scheduler_bookings(text,text[],date,date,uuid,uuid,text,boolean,integer,integer),
 public.scheduler_booking_detail(uuid),public.scheduler_therapists(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.scheduler_availability(date,date),public.scheduler_bookings(text,text[],date,date,uuid,uuid,text,boolean,integer,integer),
 public.scheduler_booking_detail(uuid),public.scheduler_therapists(uuid,timestamptz) to authenticated;
