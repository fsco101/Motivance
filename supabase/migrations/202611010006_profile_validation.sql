-- Existing full names are retained; users confirm their split names on next edit.
alter table public.patient_profiles add column first_name text, add column last_name text;
create function public.username_allowed(value text) returns boolean language sql immutable set search_path='' as $$
 select coalesce(value ~ '^[A-Za-z0-9_]{3,30}$' and
 regexp_replace(translate(lower(value),'01345789','oieastbg'),'_','','g') !~ 'fuck|shit|bitch|cunt|motherfucker|putangina|tangina|gago|tanga|ulol|putang|pakyu|puta|puto|mierda|pendejo|cabron|cojones|joder|merde|putain|salope|connard|scheisse|arschloch|ficken|fotze|caralho|porra|buceta|cazzo|vaffanculo|stronzo|anjing|bangsat|kontol|memek|goblok|bhenchod|madarchod|chutiya|harami|orospu|siktir',false)
$$;
create or replace function public.write_patient_profile(p_user uuid,p_details jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare dob date; first_name text=trim(p_details->>'first_name'); last_name text=trim(p_details->>'last_name');
begin
 if coalesce((p_details->>'consent')::boolean,false) is not true then raise exception 'Privacy agreement required'; end if;
 if not public.username_allowed(p_details->>'username') then raise exception 'Username contains prohibited wording or invalid characters'; end if;
 if first_name is null or last_name is null or length(first_name) not between 1 and 60 or length(last_name) not between 1 and 60
 or replace(first_name,chr(8217),chr(39)) !~ '^[[:alpha:]][[:alpha:] .''-]*$' or replace(last_name,chr(8217),chr(39)) !~ '^[[:alpha:]][[:alpha:] .''-]*$'
 then raise exception 'Valid first and last names required'; end if;
 if coalesce(p_details->>'contact','') !~ '^\+?[0-9 ()-]{7,25}$' or length(regexp_replace(p_details->>'contact','[^0-9]','','g')) not between 7 and 15 then raise exception 'Invalid contact number'; end if;
 dob=(p_details->>'birthdate')::date;
 if dob is null or dob>current_date or dob<(current_date-interval '120 years')::date then raise exception 'Invalid birthdate'; end if;
 insert into public.patient_profiles(user_id,username,full_name,first_name,last_name,gender,birthdate,address,contact,avatar)
 values(p_user,trim(p_details->>'username'),first_name||' '||last_name,first_name,last_name,p_details->>'gender',dob,
 trim(p_details->>'address'),trim(p_details->>'contact'),p_details->>'avatar')
 on conflict(user_id) do update set username=excluded.username,full_name=excluded.full_name,first_name=excluded.first_name,last_name=excluded.last_name,gender=excluded.gender,
 birthdate=excluded.birthdate,address=excluded.address,contact=excluded.contact,avatar=excluded.avatar,updated_at=now();
 update public.profiles set display_name=first_name||' '||last_name where id=p_user;
end $$;
revoke all on function public.write_patient_profile(uuid,jsonb) from public,anon,authenticated;

