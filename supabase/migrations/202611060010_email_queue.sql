-- Email leaves through a queue. A booking only writes a row here, so it can never wait for Gmail or fail because of it.

-- Email has no app to choose its language, so the server has to know each person's.
alter table public.profiles add column preferred_language text not null default 'en' check(preferred_language in ('en','fil'));

create function public.set_my_language(p_language text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_language is null or p_language not in ('en','fil') then raise exception 'booking_invalid'; end if;
 update public.profiles set preferred_language=p_language where id=auth.uid() and preferred_language<>p_language;
end $$;

create table public.notification_deliveries (
 id uuid primary key default gen_random_uuid(),
 notification_id uuid not null references public.notifications(id),
 channel text not null check(channel in ('email','push')),
 status text not null default 'pending' check(status in ('pending','sending','sent','failed')),
 attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(),
 claimed_at timestamptz,
 last_error text,
 sent_at timestamptz,
 created_at timestamptz not null default now(),
 unique(notification_id,channel)
);
create index notification_deliveries_due on public.notification_deliveries(channel,next_attempt_at) where status in ('pending','sending');
alter table public.notification_deliveries enable row level security;
revoke all on public.notification_deliveries from anon,authenticated;

create function public.queue_notification_email() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.notification_deliveries(notification_id,channel) values(new.id,'email') on conflict do nothing;
 return new;
end $$;
create trigger queue_notification_email after insert on public.notifications for each row execute function public.queue_notification_email();

-- Takes rows for one run. A row being sent is invisible to any other run, so two runs cannot send one email twice.
-- A run that died partway leaves its rows claimed, and they return after a few minutes.
create function public.claim_notification_deliveries(p_channel text default 'email',p_limit integer default 20) returns jsonb
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
   'calendar_token',b.calendar_token,'location',settings.location,'center_name',settings.center_name,'time_zone',settings.time_zone)),'[]'::jsonb) into result
 from public.notification_deliveries d join public.notifications n on n.id=d.notification_id join public.profiles p on p.id=n.user_id
 join auth.users u on u.id=n.user_id left join public.bookings b on b.id=n.booking_id where d.id=any(claimed);
 return result;
end $$;

-- Waits longer after each failure, then stops, so a bad address cannot retry forever.
create function public.finish_notification_delivery(p_id uuid,p_sent boolean,p_error text default null) returns text
language plpgsql security definer set search_path='' as $$
declare target public.notification_deliveries; outcome text;
begin
 select * into target from public.notification_deliveries where id=p_id for update;
 if not found then raise exception 'booking_unavailable'; end if;
 outcome:=case when p_sent then 'sent' when target.attempts>=5 then 'failed' else 'pending' end;
 update public.notification_deliveries set status=outcome,sent_at=case when p_sent then now() end,last_error=case when p_sent then null else left(p_error,300) end,
  claimed_at=null,next_attempt_at=now()+make_interval(mins=>(2^least(target.attempts,5))::integer) where id=p_id;
 return outcome;
end $$;

-- A calendar link is public and carries only an unguessable token, so this says nothing about who the patient is.
create function public.booking_calendar(p_token text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare settings public.center_settings; b public.bookings;
begin
 select * into strict settings from public.center_settings;
 select * into b from public.bookings where calendar_token=p_token;
 if not found then return null; end if;
 return jsonb_build_object('id',b.id,'reference_no',b.reference_no,'status',b.status,'starts_at',b.starts_at,'ends_at',b.ends_at,'center_name',settings.center_name,'location',settings.location,
  -- Calendars replace an entry when this rises, so a moved session updates the one already there.
  'sequence',(select count(*) from public.booking_events e where e.booking_id=b.id and e.action in ('rescheduled','cancelled','rejected')),
  'updated_at',(select max(recorded_at) from public.booking_events e where e.booking_id=b.id));
end $$;

revoke all on function public.queue_notification_email(),public.claim_notification_deliveries(text,integer),public.finish_notification_delivery(uuid,boolean,text),public.booking_calendar(text),public.set_my_language(text) from public,anon,authenticated;
grant execute on function public.claim_notification_deliveries(text,integer),public.finish_notification_delivery(uuid,boolean,text),public.booking_calendar(text) to service_role;
grant execute on function public.set_my_language(text) to authenticated;

-- pg_cron drains the queue by calling the function. The address and secret live in Vault, so until they are set this does nothing.
create extension if not exists pg_cron with schema pg_catalog;
create function public.dispatch_notifications() returns void language plpgsql security definer set search_path='' as $$
declare target text; secret text;
begin
 select decrypted_secret into target from vault.decrypted_secrets where name='notification_dispatch_url';
 select decrypted_secret into secret from vault.decrypted_secrets where name='notification_dispatch_secret';
 if target is null or secret is null then return; end if;
 if not exists(select 1 from public.notification_deliveries where status in ('pending','sending') and next_attempt_at<=now()) then return; end if;
 perform net.http_post(url:=target,headers:=jsonb_build_object('Content-Type','application/json','x-dispatch-secret',secret),body:='{}'::jsonb,timeout_milliseconds:=30000);
end $$;
revoke all on function public.dispatch_notifications() from public,anon,authenticated;
select cron.schedule('notification-dispatch','* * * * *','select public.dispatch_notifications()');
