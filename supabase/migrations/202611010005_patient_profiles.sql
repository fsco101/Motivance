-- Optional for legacy accounts; every new detailed profile requires explicit consent.
create table public.patient_profiles (
 user_id uuid primary key references public.profiles(id),
 username text not null check(username ~ '^[A-Za-z0-9_]{3,30}$'),
 full_name text not null check(length(trim(full_name)) between 2 and 120),
 gender text not null check(gender in ('female','male','nonbinary','prefer_not_to_say')),
 birthdate date not null,
 address text not null check(length(trim(address)) between 5 and 500),
 contact text not null check(contact ~ '^[+0-9 ()-]{7,25}$' and length(regexp_replace(contact,'[^0-9]','','g'))>=7),
 avatar text not null check(avatar in ('person','star','heart')),
 privacy_version text not null default 'system-purpose-v1',
 consented_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index patient_username_unique on public.patient_profiles(lower(username));
alter table public.patient_profiles enable row level security;
revoke all on public.patient_profiles from anon,authenticated;
grant select on public.patient_profiles to authenticated;
create policy scoped_profile_read on public.patient_profiles for select to authenticated
 using(public.can_read_patient(user_id));

create function public.write_patient_profile(p_user uuid,p_details jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare dob date;
begin
 if coalesce((p_details->>'consent')::boolean,false) is not true then raise exception 'Privacy agreement required'; end if;
 dob=(p_details->>'birthdate')::date;
 if dob is null or dob>current_date or dob<(current_date-interval '120 years')::date then raise exception 'Invalid birthdate'; end if;
 insert into public.patient_profiles(user_id,username,full_name,gender,birthdate,address,contact,avatar)
 values(p_user,trim(p_details->>'username'),trim(p_details->>'full_name'),p_details->>'gender',dob,
 trim(p_details->>'address'),trim(p_details->>'contact'),p_details->>'avatar')
 on conflict(user_id) do update set username=excluded.username,full_name=excluded.full_name,gender=excluded.gender,
 birthdate=excluded.birthdate,address=excluded.address,contact=excluded.contact,avatar=excluded.avatar,updated_at=now();
 update public.profiles set display_name=trim(p_details->>'full_name') where id=p_user;
end $$;
revoke all on function public.write_patient_profile(uuid,jsonb) from public,anon,authenticated;

create function public.save_my_profile(p_details jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 perform public.write_patient_profile(auth.uid(),p_details);
 insert into public.audit_events(actor_id,action,target_type,target_id) values(auth.uid(),'update_profile','patient_profiles',auth.uid()::text);
end $$;
revoke all on function public.save_my_profile(jsonb) from public,anon;
grant execute on function public.save_my_profile(jsonb) to authenticated;

create or replace function public.on_user_created() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id) values(new.id);
 insert into public.user_roles(user_id,role) values(new.id,'patient');
 insert into public.patients(id) values(new.id);
 if new.raw_user_meta_data ? 'patient_profile' then
  perform public.write_patient_profile(new.id,new.raw_user_meta_data->'patient_profile');
 end if;
 return new;
end $$;
