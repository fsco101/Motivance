-- Push through FCM, ready for credentials. Each notification queues a push beside its email, and until FCM_SERVICE_ACCOUNT is set the dispatcher marks those skipped.
create table public.device_tokens (
 token text primary key check(length(token) between 20 and 4096),
 user_id uuid not null references public.profiles(id),
 platform text not null check(platform in ('android')),
 updated_at timestamptz not null default now()
);
create index device_tokens_user on public.device_tokens(user_id);
alter table public.device_tokens enable row level security;
revoke all on public.device_tokens from anon,authenticated;

alter table public.notification_deliveries drop constraint notification_deliveries_status_check;
alter table public.notification_deliveries add constraint notification_deliveries_status_check check(status in ('pending','sending','sent','failed','skipped'));

-- A phone belongs to whoever signed in last, so a token moves with the sign-in rather than staying with the person before.
create function public.register_device(p_token text,p_platform text default 'android') returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_token is null or length(p_token) not between 20 and 4096 or p_platform is null or p_platform not in ('android') then raise exception 'booking_invalid'; end if;
 insert into public.device_tokens(token,user_id,platform) values(p_token,auth.uid(),p_platform)
 on conflict(token) do update set user_id=excluded.user_id,platform=excluded.platform,updated_at=now();
end $$;

-- Signing out stops the phone hearing about the account. Only the owner's own token can go.
create function public.unregister_device(p_token text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 delete from public.device_tokens where token=p_token and user_id=auth.uid();
end $$;

create or replace function public.queue_notification_email() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.notification_deliveries(notification_id,channel) values(new.id,'email'),(new.id,'push') on conflict do nothing;
 return new;
end $$;

-- The same as before, with the devices a push can reach. A disabled account reaches none.
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
   'calendar_token',b.calendar_token,'location',settings.location,'center_name',settings.center_name,'time_zone',settings.time_zone,'booking_id',n.booking_id,
   'tokens',case when p.active then (select coalesce(jsonb_agg(t.token),'[]'::jsonb) from public.device_tokens t where t.user_id=n.user_id) else '[]'::jsonb end)),'[]'::jsonb) into result
 from public.notification_deliveries d join public.notifications n on n.id=d.notification_id join public.profiles p on p.id=n.user_id
 join auth.users u on u.id=n.user_id left join public.bookings b on b.id=n.booking_id where d.id=any(claimed);
 return result;
end $$;

-- Nothing to send it through, or nobody to send it to. These are not failures, so they never retry.
create function public.skip_push_deliveries(p_reason text) returns integer language plpgsql security definer set search_path='' as $$
declare total integer;
begin
 update public.notification_deliveries set status='skipped',last_error=left(p_reason,300),claimed_at=null
 where channel='push' and status in ('pending','sending') and (status='pending' or claimed_at<now()-interval '5 minutes');
 get diagnostics total=row_count;
 return total;
end $$;

create function public.skip_notification_delivery(p_id uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.notification_deliveries set status='skipped',last_error=left(p_reason,300),claimed_at=null where id=p_id;
end $$;

-- FCM says these phones are gone, so nothing should try them again.
create function public.remove_device_tokens(p_tokens text[]) returns integer language plpgsql security definer set search_path='' as $$
declare total integer;
begin
 delete from public.device_tokens where token=any(p_tokens);
 get diagnostics total=row_count;
 return total;
end $$;

revoke all on function public.register_device(text,text),public.unregister_device(text),public.skip_push_deliveries(text),public.skip_notification_delivery(uuid,text),public.remove_device_tokens(text[]) from public,anon,authenticated;
grant execute on function public.register_device(text,text),public.unregister_device(text) to authenticated;
grant execute on function public.skip_push_deliveries(text),public.skip_notification_delivery(uuid,text),public.remove_device_tokens(text[]) to service_role;
