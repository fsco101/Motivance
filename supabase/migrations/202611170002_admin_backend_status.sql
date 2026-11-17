-- Backend status for administrators: how much of the plan's database and file storage is used and what remains, the
-- largest tables and buckets, the notification delivery queue, the scheduled jobs, sign-ins and daily activity.
--
-- Supabase does not expose a project's plan limits to SQL, so they are kept in backend_plan, one row seeded with the Free
-- plan (500 MB database, 1 GB file storage). A project on a larger plan updates that row with SQL; see
-- docs/operations/BACKEND-STATUS.md. Only sizes and counts leave this function: no names, messages or file paths.

create table public.backend_plan (
 id boolean primary key default true check(id),
 name text not null check(char_length(name) between 1 and 60),
 database_bytes bigint not null check(database_bytes>0),
 storage_bytes bigint not null check(storage_bytes>0),
 updated_at timestamptz not null default now()
);
insert into public.backend_plan(name,database_bytes,storage_bytes) values('Supabase Free',524288000,1073741824);
alter table public.backend_plan enable row level security;
revoke all on public.backend_plan from anon,authenticated;

create function public.admin_backend() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare zone text; jobs jsonb;
begin
 perform public.require_admin();
 -- Days are counted in the center's own time zone, as the schedule is.
 select time_zone into zone from public.center_settings limit 1;
 zone:=coalesce(zone,'UTC');
 -- pg_cron lives outside the application schema; a database without it, such as the migration verifier, reports no jobs.
 begin
  select coalesce(jsonb_agg(jsonb_build_object('name',j.jobname,'schedule',j.schedule,'last_status',l.status,'last_run',l.start_time,
    'failures_day',f.failures) order by j.jobname),'[]'::jsonb) into jobs
  from cron.job j
  left join lateral (select d.status,d.start_time from cron.job_run_details d where d.jobid=j.jobid order by d.start_time desc limit 1) l on true
  left join lateral (select count(*) as failures from cron.job_run_details d where d.jobid=j.jobid and d.status='failed'
    and d.start_time>now()-interval '1 day') f on true;
 exception when undefined_table or undefined_column or invalid_schema_name or insufficient_privilege then
  jobs:=null;
 end;
 return jsonb_build_object(
  'generated_at',now(),
  'plan',(select jsonb_build_object('name',p.name,'database_bytes',p.database_bytes,'storage_bytes',p.storage_bytes) from public.backend_plan p),
  'database',jsonb_build_object(
   'bytes',pg_catalog.pg_database_size(pg_catalog.current_database()),
   'tables',(select coalesce(jsonb_agg(jsonb_build_object('name',t.relname,'bytes',t.bytes) order by t.bytes desc,t.relname),'[]'::jsonb) from (
     select c.relname::text as relname,pg_catalog.pg_total_relation_size(c.oid) as bytes
     from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind='r' order by 2 desc,1 limit 6) t)),
  'storage',(select jsonb_build_object('bytes',coalesce(sum(b.bytes),0),'files',coalesce(sum(b.files),0),
    'buckets',coalesce(jsonb_agg(jsonb_build_object('bucket',b.id,'files',b.files,'bytes',b.bytes) order by b.bytes desc,b.id),'[]'::jsonb)) from (
     select k.id,count(o.id) as files,coalesce(sum((o.metadata->>'size')::bigint),0) as bytes
     from storage.buckets k left join storage.objects o on o.bucket_id=k.id group by k.id) b),
  'deliveries',(select jsonb_build_object(
    'waiting',count(*) filter (where d.status in ('pending','sending')),
    'oldest_waiting',min(d.created_at) filter (where d.status in ('pending','sending')),
    'failed_week',count(*) filter (where d.status='failed' and d.created_at>now()-interval '7 days'),
    'sent_day',count(*) filter (where d.status='sent' and d.sent_at>now()-interval '1 day'))
   from public.notification_deliveries d),
  'accounts',jsonb_build_object(
   'signed_in_week',(select count(*) from auth.users u where u.last_sign_in_at>now()-interval '7 days'),
   'new_week',(select count(*) from auth.users u where u.created_at>now()-interval '7 days'),
   'devices',(select count(*) from public.device_tokens)),
  -- The last 14 days, today included. Each table is read once, over a range its index can use.
  'activity',(with
    days as (select pg_catalog.generate_series((now() at time zone zone)::date-13,(now() at time zone zone)::date,interval '1 day')::date as day),
    s as (select (x.started_at at time zone zone)::date as day,count(*) as n from public.sessions x where x.started_at>=now()-interval '15 days' group by 1),
    m as (select (x.created_at at time zone zone)::date as day,count(*) as n from public.chat_messages x where x.created_at>=now()-interval '15 days' group by 1),
    b as (select (x.created_at at time zone zone)::date as day,count(*) as n from public.bookings x where x.created_at>=now()-interval '15 days' group by 1),
    a as (select (x.created_at at time zone zone)::date as day,count(*) as n from auth.users x where x.created_at>=now()-interval '15 days' group by 1)
   select jsonb_agg(jsonb_build_object('day',d.day,'sessions',coalesce(s.n,0),'messages',coalesce(m.n,0),'bookings',coalesce(b.n,0),'accounts',coalesce(a.n,0)) order by d.day)
   from days d left join s on s.day=d.day left join m on m.day=d.day left join b on b.day=d.day left join a on a.day=d.day),
  'jobs',jobs
 );
end $$;

revoke all on function public.admin_backend() from public,anon,authenticated;
grant execute on function public.admin_backend() to authenticated;
