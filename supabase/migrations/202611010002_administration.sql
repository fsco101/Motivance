-- Administrator operations use the signed-in JWT, never an APK service-role key.
create function public.require_admin() returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.has_role('admin') then raise exception 'Active administrator required' using errcode='42501'; end if;
end $$;

create function public.admin_accounts(p_after uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform public.require_admin();
 select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'::jsonb) into result from (
  select p.id,p.display_name,p.active,array(select r.role from public.user_roles r where r.user_id=p.id order by r.role) as roles
  from public.profiles p where p_after is null or p.id>p_after order by p.id limit 51
 ) a;
 return result;
end $$;

create function public.admin_set_account(p_user uuid,p_active boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(724010);
 perform public.require_admin();
 if p_active is null or p_user=auth.uid() then raise exception 'Cannot change your own account status'; end if;
 update public.profiles set active=p_active where id=p_user;
 if not found then raise exception 'Account unavailable'; end if;
 insert into public.audit_events(actor_id,action,target_type,target_id)
 values(auth.uid(),case when p_active then 'enable' else 'disable' end,'profiles',p_user::text);
end $$;

create function public.admin_set_role(p_user uuid,p_role text,p_granted boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(724010);
 perform public.require_admin();
 if p_role is null or p_role not in ('therapist','admin') or p_granted is null or p_user=auth.uid()
 then raise exception 'Invalid role change or self modification'; end if;
 if not exists(select 1 from public.profiles where id=p_user and active) then raise exception 'Active account required'; end if;
 if p_granted then
  insert into public.user_roles(user_id,role) values(p_user,p_role) on conflict do nothing;
 else
  delete from public.user_roles where user_id=p_user and role=p_role;
  if p_role='therapist' then
   update public.therapist_patients set active=false where therapist_id=p_user;
   update public.exercise_assignments set active=false where therapist_id=p_user;
   update public.patient_invitations set expires_at=least(expires_at,now()) where therapist_id=p_user;
  end if;
 end if;
end $$;

create function public.admin_set_link(p_therapist uuid,p_patient uuid,p_active boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(724010);
 perform public.require_admin();
 if p_active is null or p_therapist=p_patient then raise exception 'Invalid link'; end if;
 if not exists(select 1 from public.profiles p join public.user_roles r on r.user_id=p.id where p.id=p_therapist and p.active and r.role='therapist')
 or not exists(select 1 from public.patients a join public.profiles p on p.id=a.id where a.id=p_patient and p.active)
 then raise exception 'Active therapist and patient required'; end if;
 insert into public.therapist_patients(therapist_id,patient_id,active,assigned_by) values(p_therapist,p_patient,p_active,auth.uid())
 on conflict(therapist_id,patient_id) do update set active=excluded.active,assigned_by=excluded.assigned_by;
 if not p_active then
  update public.exercise_assignments set active=false where therapist_id=p_therapist and patient_id=p_patient;
  update public.patient_invitations set expires_at=least(expires_at,now()) where therapist_id=p_therapist
   and email=(select lower(email) from auth.users where id=p_patient);
 end if;
 -- Reactivation never silently reactivates an old prescription.
end $$;

create function public.admin_set_exercise(p_exercise uuid,p_active boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.require_admin();
 if p_active is null then raise exception 'Status required'; end if;
 update public.exercises set active=p_active where id=p_exercise;
 if not found then raise exception 'Exercise unavailable'; end if;
 insert into public.audit_events(actor_id,action,target_type,target_id)
 values(auth.uid(),case when p_active then 'activate' else 'deactivate' end,'exercises',p_exercise::text);
end $$;

create function public.admin_publish_exercise(p_exercise uuid,p_name text,p_english text,p_filipino text) returns uuid language plpgsql security definer set search_path='' as $$
declare previous public.exercise_versions; new_id uuid;
begin
 perform public.require_admin();
 if p_name is null or length(trim(p_name)) not between 1 and 120 or p_english is null or length(trim(p_english)) not between 1 and 4000
 or p_filipino is null or length(trim(p_filipino)) not between 1 and 4000 then raise exception 'Localized name/instructions required'; end if;
 perform 1 from public.exercises where id=p_exercise for update;
 if not found then raise exception 'Exercise unavailable'; end if;
 select * into previous from public.exercise_versions where exercise_id=p_exercise order by version desc limit 1;
 if not found or previous.algorithm_key not in ('elbow-flexion-v1','shoulder-abduction-v1') then raise exception 'Unsupported algorithm'; end if;
 insert into public.exercise_versions(exercise_id,version,algorithm_key,definition,published)
 values(p_exercise,previous.version+1,previous.algorithm_key,
 previous.definition || jsonb_build_object('name',trim(p_name),'instructions_en',trim(p_english),'instructions_fil',trim(p_filipino)),true) returning id into new_id;
 insert into public.audit_events(actor_id,action,target_type,target_id) values(auth.uid(),'publish','exercise_versions',new_id::text);
 return new_id;
end $$;

create policy admin_exercises_read on public.exercises for select to authenticated using(public.has_role('admin'));
create policy admin_versions_read on public.exercise_versions for select to authenticated using(public.has_role('admin'));
revoke all on function public.require_admin(),public.admin_accounts(uuid),public.admin_set_account(uuid,boolean),public.admin_set_role(uuid,text,boolean),
 public.admin_set_link(uuid,uuid,boolean),public.admin_set_exercise(uuid,boolean),public.admin_publish_exercise(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.admin_accounts(uuid),public.admin_set_account(uuid,boolean),public.admin_set_role(uuid,text,boolean),
 public.admin_set_link(uuid,uuid,boolean),public.admin_set_exercise(uuid,boolean),public.admin_publish_exercise(uuid,text,text,text) to authenticated;
