-- A sign-up becomes a Motivance account only once its email code is entered.
-- Supabase Auth has to keep a pending record to check the code. Motivance makes nothing from that record before confirmation,
-- and deletes it as soon as its code expires. Unconfirmed accounts made before this change keep their records.

-- How long a code works. Auth's otp_expiry in config.toml and mailer_otp_exp in scripts/configure_auth_email.py must match;
-- scripts/test_configure_auth_email.py checks that they do.
create function public.signup_code_lifetime() returns interval language sql immutable set search_path='' as $$
 select interval '10 minutes'
$$;

-- Sign-up refuses details a saved profile could not hold, before any code is sent. Writing them and undoing the write applies
-- exactly the rules a saved profile meets, table checks and the unique username included.
create function public.check_signup_details(p_user uuid,p_details jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 begin
  insert into public.profiles(id) values(p_user);
  perform public.write_patient_profile(p_user,p_details);
  raise exception 'Sign-up details checked' using errcode='MVCHK';
 exception when sqlstate 'MVCHK' then null;
 end;
 -- A sign-up still waiting for its code holds its username, so the person who chose it first can finish.
 if exists(select 1 from auth.users u where u.id<>p_user and u.email_confirmed_at is null
  and coalesce(u.confirmation_sent_at,u.created_at)>now()-public.signup_code_lifetime()
  and lower(trim(u.raw_user_meta_data->'patient_profile'->>'username'))=lower(trim(p_details->>'username')))
 then raise exception 'Username already in use' using errcode='23505';
 end if;
end $$;

create function public.provision_account(p_user uuid,p_metadata jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id) values(p_user) on conflict do nothing;
 -- Ignore role claims in signup metadata; only trusted backend provisioning adds staff.
 insert into public.user_roles(user_id,role) values(p_user,'patient') on conflict do nothing;
 insert into public.patients(id) values(p_user) on conflict do nothing;
 if p_metadata ? 'patient_profile' and not exists(select 1 from public.patient_profiles where user_id=p_user) then
  begin
   perform public.write_patient_profile(p_user,p_metadata->'patient_profile');
  exception when unique_violation then
   -- Someone confirmed the same username first. The code still works, and Profile asks for the details.
   null;
  end;
 end if;
end $$;

create or replace function public.on_user_created() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.raw_user_meta_data ? 'patient_profile' then
  perform public.check_signup_details(new.id,new.raw_user_meta_data->'patient_profile');
 end if;
 -- An account an administrator creates already confirmed is ready at once; a sign-up waits for its code.
 if new.email_confirmed_at is not null then
  perform public.provision_account(new.id,new.raw_user_meta_data);
 end if;
 return new;
end $$;

create function public.on_email_confirmed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform public.provision_account(new.id,new.raw_user_meta_data);
 return new;
end $$;
create trigger provision_confirmed_account after update on auth.users for each row
 when (old.email_confirmed_at is null and new.email_confirmed_at is not null) execute function public.on_email_confirmed();

-- Never-confirmed sign-ups go once their latest code expires. A resent code moves confirmation_sent_at, which keeps the sign-up
-- for another lifetime. Invitations and unconfirmed accounts that already own Motivance records are left alone.
create function public.delete_expired_signups() returns integer language plpgsql security definer set search_path='' as $$
declare removed integer;
begin
 delete from auth.users u where u.email_confirmed_at is null and u.email is not null and u.invited_at is null
  and coalesce(u.confirmation_sent_at,u.created_at)<now()-public.signup_code_lifetime()
  and not exists(select 1 from public.profiles p where p.id=u.id);
 get diagnostics removed=row_count;
 return removed;
end $$;

revoke all on function public.signup_code_lifetime(),public.check_signup_details(uuid,jsonb),public.provision_account(uuid,jsonb),
 public.on_email_confirmed(),public.delete_expired_signups() from public,anon,authenticated;
select cron.schedule('delete-expired-signups','* * * * *','select public.delete_expired_signups()');
