-- When the center can see patients. Times are timestamptz (UTC) and are read in the center's own zone, so a phone set to
-- another zone still sees the right slots. Clients only read here: Schedulers change these rows through their functions.
create table public.center_settings (
 id boolean primary key default true check(id),
 center_name text not null default 'Motivance Therapy Center' check(length(trim(center_name)) between 1 and 120),
 location text not null default '' check(length(location)<=300),
 time_zone text not null default 'Asia/Manila',
 slot_minutes integer not null default 60 check(slot_minutes between 15 and 240),
 slot_capacity integer not null default 3 check(slot_capacity between 1 and 100),
 cancel_cutoff_hours integer not null default 24 check(cancel_cutoff_hours between 0 and 336),
 reschedule_cutoff_hours integer not null default 24 check(reschedule_cutoff_hours between 0 and 336),
 minimum_notice_hours integer not null default 24 check(minimum_notice_hours between 0 and 336),
 booking_horizon_days integer not null default 60 check(booking_horizon_days between 1 and 365),
 max_active_bookings integer not null default 5 check(max_active_bookings between 1 and 50),
 max_self_reschedules integer not null default 2 check(max_self_reschedules between 0 and 10),
 updated_by uuid references public.profiles(id),
 updated_at timestamptz not null default now()
);
insert into public.center_settings(id) values(true);

create table public.center_hours (
 weekday smallint primary key check(weekday between 1 and 7), -- ISO: 1 is Monday.
 is_open boolean not null default false,
 opens_at time not null default '09:00',
 closes_at time not null default '17:00',
 check(opens_at<closes_at)
);
insert into public.center_hours(weekday,is_open) values(1,true),(2,true),(3,true),(4,true),(5,true),(6,false),(7,false);

create table public.center_holidays (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) between 1 and 120),
 kind text not null check(kind in ('regular','special','seasonal')),
 starts_on date not null,
 ends_on date not null,
 source text not null default 'scheduler' check(source in ('seed','scheduler')),
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(ends_on>=starts_on)
);
create index center_holidays_dates on public.center_holidays(starts_on,ends_on);

-- Proclamation 1006 (2026) and Proclamation 1427 (2027). February 25 is a special working day in both, so it stays bookable.
-- Eid'l Fitr and Eid'l Adha are proclaimed separately, so a Scheduler adds them once their dates are known.
insert into public.center_holidays(name,kind,starts_on,ends_on,source)
select name,kind,day,day,'seed' from (values
 ('New Year''s Day','regular','2026-01-01'::date),('Chinese New Year','special','2026-02-17'),('Maundy Thursday','regular','2026-04-02'),
 ('Good Friday','regular','2026-04-03'),('Black Saturday','special','2026-04-04'),('Araw ng Kagitingan','regular','2026-04-09'),
 ('Labor Day','regular','2026-05-01'),('Independence Day','regular','2026-06-12'),('Ninoy Aquino Day','special','2026-08-21'),
 ('National Heroes Day','regular','2026-08-31'),('All Saints'' Day','special','2026-11-01'),('All Souls'' Day','special','2026-11-02'),
 ('Bonifacio Day','regular','2026-11-30'),('Feast of the Immaculate Conception of Mary','special','2026-12-08'),('Christmas Eve','special','2026-12-24'),
 ('Christmas Day','regular','2026-12-25'),('Rizal Day','regular','2026-12-30'),('Last Day of the Year','special','2026-12-31'),
 ('New Year''s Day','regular','2027-01-01'),('Chinese New Year','special','2027-02-06'),('Maundy Thursday','regular','2027-03-25'),
 ('Good Friday','regular','2027-03-26'),('Black Saturday','special','2027-03-27'),('Araw ng Kagitingan','regular','2027-04-09'),
 ('Labor Day','regular','2027-05-01'),('Independence Day','regular','2027-06-12'),('Ninoy Aquino Day','special','2027-08-21'),
 ('National Heroes Day','regular','2027-08-30'),('All Saints'' Day','special','2027-11-01'),('All Souls'' Day','special','2027-11-02'),
 ('Bonifacio Day','regular','2027-11-30'),('Feast of the Immaculate Conception of Mary','special','2027-12-08'),('Christmas Eve','special','2027-12-24'),
 ('Christmas Day','regular','2027-12-25'),('Rizal Day','regular','2027-12-30'),('Last Day of the Year','special','2027-12-31')
) as seeded(name,kind,day);

create table public.center_closures (
 id uuid primary key default gen_random_uuid(),
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 all_day boolean not null default false,
 reason text not null check(length(trim(reason)) between 3 and 300),
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(ends_at>starts_at)
);
create index center_closures_times on public.center_closures(starts_at,ends_at);

alter table public.center_settings enable row level security;
alter table public.center_hours enable row level security;
alter table public.center_holidays enable row level security;
alter table public.center_closures enable row level security;
revoke all on public.center_settings,public.center_hours,public.center_holidays,public.center_closures from anon,authenticated;
grant select on public.center_settings,public.center_hours,public.center_holidays,public.center_closures to authenticated;
create policy center_settings_read on public.center_settings for select to authenticated using(public.is_active_user());
create policy center_hours_read on public.center_hours for select to authenticated using(public.is_active_user());
create policy center_holidays_read on public.center_holidays for select to authenticated using(public.is_active_user());
-- A closure's reason is internal. Patients see the slots disappear, not why.
create policy center_closures_read on public.center_closures for select to authenticated using(public.has_role('scheduler'));

-- How many active bookings overlap a time. Bookings arrive in the next migration, which replaces this.
create function public.slot_load(p_starts timestamptz,p_ends timestamptz) returns integer language sql stable security definer set search_path='' as $$
 select 0
$$;

-- Why the center itself cannot see a patient at this time, or null. These rules bind everyone, Schedulers included.
create function public.center_problem(p_starts timestamptz,p_ends timestamptz) returns text
language plpgsql stable security definer set search_path='' as $$
declare settings public.center_settings; hours public.center_hours; local_start timestamp; local_end timestamp;
begin
 select * into strict settings from public.center_settings;
 local_start:=p_starts at time zone settings.time_zone;
 local_end:=p_ends at time zone settings.time_zone;
 select * into hours from public.center_hours where weekday=extract(isodow from local_start)::integer;
 if not found or not hours.is_open then return 'closed_day'; end if;
 if local_start::date<>local_end::date or local_start::time<hours.opens_at or local_end::time>hours.closes_at then return 'outside_hours'; end if;
 if exists(select 1 from public.center_holidays where local_start::date between starts_on and ends_on) then return 'holiday'; end if;
 if exists(select 1 from public.center_closures where starts_at<p_ends and ends_at>p_starts) then return 'closure'; end if;
 return null;
end $$;

-- Why a patient cannot request this start time, or null. Schedulers skip the notice and horizon, and can book at short notice.
create function public.slot_problem(p_starts timestamptz) returns text
language plpgsql stable security definer set search_path='' as $$
declare settings public.center_settings; hours public.center_hours; step interval; offset_minutes numeric;
begin
 select * into strict settings from public.center_settings;
 step:=make_interval(mins=>settings.slot_minutes);
 if p_starts<=now() then return 'past'; end if;
 if p_starts<now()+make_interval(hours=>settings.minimum_notice_hours) then return 'too_soon'; end if;
 if p_starts>now()+make_interval(days=>settings.booking_horizon_days) then return 'too_far'; end if;
 select * into hours from public.center_hours where weekday=extract(isodow from p_starts at time zone settings.time_zone)::integer;
 if found then
  offset_minutes:=extract(epoch from ((p_starts at time zone settings.time_zone)::time-hours.opens_at))/60;
  if offset_minutes<0 or mod(offset_minutes,settings.slot_minutes)<>0 then return 'off_grid'; end if;
 end if;
 return public.center_problem(p_starts,p_starts+step);
end $$;

-- Each date in the range, and the specific times a patient could choose on it, with the places left.
create function public.booking_availability(p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare settings public.center_settings; hours public.center_hours; today date; earliest timestamptz; latest timestamptz; step interval;
 day date; holiday text; slot timestamptz; closes timestamptz; slots jsonb; days jsonb:='[]'::jsonb; status text; closed boolean; soon boolean; far boolean;
begin
 if not public.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>62 then raise exception 'booking_invalid_range'; end if;
 select * into strict settings from public.center_settings;
 today:=(now() at time zone settings.time_zone)::date;
 earliest:=now()+make_interval(hours=>settings.minimum_notice_hours);
 latest:=now()+make_interval(days=>settings.booking_horizon_days);
 step:=make_interval(mins=>settings.slot_minutes);
 for day in select generate_series(p_from,p_to,interval '1 day')::date loop
  slots:='[]'::jsonb; closed:=false; soon:=false; far:=false;
  select name into holiday from public.center_holidays where day between starts_on and ends_on order by starts_on,name limit 1;
  select * into hours from public.center_hours where weekday=extract(isodow from day)::integer;
  if day<today then status:='past';
  elsif not found or not hours.is_open then status:='closed';
  elsif holiday is not null then status:='holiday';
  else
   slot:=(day+hours.opens_at) at time zone settings.time_zone;
   closes:=(day+hours.closes_at) at time zone settings.time_zone;
   while slot+step<=closes loop
    if slot<=now() or slot<earliest then soon:=true;
    elsif slot>latest then far:=true;
    elsif exists(select 1 from public.center_closures where starts_at<slot+step and ends_at>slot) then closed:=true;
    else slots:=slots||jsonb_build_object('starts_at',slot,'ends_at',slot+step,'remaining',greatest(settings.slot_capacity-public.slot_load(slot,slot+step),0));
    end if;
    slot:=slot+step;
   end loop;
   status:=case when jsonb_array_length(slots)>0 then 'open' when closed then 'closure' when far then 'too_far' when soon then 'too_soon' else 'closed' end;
  end if;
  days:=days||jsonb_build_object('date',day,'status',status,'holiday',holiday,'slots',slots);
 end loop;
 return jsonb_build_object('time_zone',settings.time_zone,'slot_minutes',settings.slot_minutes,'days',days);
end $$;

revoke all on function public.slot_load(timestamptz,timestamptz),public.center_problem(timestamptz,timestamptz),public.slot_problem(timestamptz),
 public.booking_availability(date,date) from public,anon,authenticated;
grant execute on function public.booking_availability(date,date) to authenticated;
