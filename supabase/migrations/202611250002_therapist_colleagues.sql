-- #173: two therapists can link as colleagues, so each can follow the progress of the other's patients, read-only.
-- Owner decisions (2026-11-24): each patient opts in ("Let my therapist's colleagues see my progress", off by default);
-- therapists invite and accept, and administrators can also link and end links on both admin apps; a linked colleague
-- sees all of the other's patients who opted in, including the session videos those patients shared.
-- Seeing is not treating: can_prescribe, chat, contact details and the patient record keep their own checks. Every
-- colleague read is preceded by open_colleague_patient, which writes the audit event and opens a 30-minute window;
-- can_view_progress is true for a colleague only inside that window, so no read happens without an audited open.

-- The patient's own choice, kept as consent events like the other agreements.
create function public.colleague_sharing_version() returns text language sql immutable set search_path='' as $$ select 'colleague-sharing-v1' $$;

create function public.colleague_sharing_on(p_patient uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select c.event='granted' from public.consents c where c.patient_id=p_patient and c.consent_type='colleague-sharing'
  and c.version=public.colleague_sharing_version() order by c.occurred_at desc,c.recorded_at desc,c.id desc limit 1),false)
$$;

create function public.my_colleague_sharing() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare latest public.consents;
begin
 if not public.has_role('patient') then raise exception 'Patient access required' using errcode='42501'; end if;
 select * into latest from public.consents where patient_id=auth.uid() and consent_type='colleague-sharing' and version=public.colleague_sharing_version()
  order by occurred_at desc,recorded_at desc,id desc limit 1;
 return jsonb_build_object('version',public.colleague_sharing_version(),'granted',coalesce(latest.event='granted',false),'at',latest.occurred_at);
end $$;

-- The same answer twice records nothing. Turning it off ends every colleague's access at once.
create function public.set_colleague_sharing(p_granted boolean) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.has_role('patient') then raise exception 'Patient access required' using errcode='42501'; end if;
 if p_granted is null then raise exception 'colleague_invalid'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text,17));
 if public.colleague_sharing_on(auth.uid()) is distinct from p_granted then
  insert into public.consents(patient_id,consent_type,version,event,client_event_id,occurred_at)
  -- The wall clock, so two changes in one transaction still have an order.
  values(auth.uid(),'colleague-sharing',public.colleague_sharing_version(),case when p_granted then 'granted' else 'withdrawn' end,gen_random_uuid(),clock_timestamp());
 end if;
 return public.my_colleague_sharing();
end $$;

create table public.therapist_colleagues (
 id uuid primary key default gen_random_uuid(),
 -- The therapist who asked, and the one asked. Once active the link works both ways.
 requester_id uuid not null references public.profiles(id),
 invitee_id uuid not null references public.profiles(id),
 requested_by uuid not null references public.profiles(id),
 state text not null default 'requested' check(state in ('requested','active','declined','ended')),
 created_at timestamptz not null default now(),
 started_at timestamptz, ended_at timestamptz, ended_by uuid references public.profiles(id),
 check(requester_id<>invitee_id)
);
-- One open request or link per pair, whichever way round.
create unique index therapist_colleagues_pair on public.therapist_colleagues(least(requester_id,invitee_id),greatest(requester_id,invitee_id)) where state in ('requested','active');
create index therapist_colleagues_invitee on public.therapist_colleagues(invitee_id) where state in ('requested','active');
alter table public.therapist_colleagues enable row level security;
revoke all on public.therapist_colleagues from anon,authenticated;

-- When a colleague last opened a patient. It is what lets their reads through, for 30 minutes.
create table public.colleague_views (
 viewer_id uuid not null references public.profiles(id),
 patient_id uuid not null references public.patients(id),
 opened_at timestamptz not null default now(),
 primary key(viewer_id,patient_id)
);
alter table public.colleague_views enable row level security;
revoke all on public.colleague_views from anon,authenticated;

create function public.colleagues_linked(p_a uuid,p_b uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.therapist_colleagues l where l.state='active' and ((l.requester_id=p_a and l.invitee_id=p_b) or (l.requester_id=p_b and l.invitee_id=p_a)))
$$;

-- Whether the signed-in therapist is a colleague of one of the patient's own therapists, and the patient opted in.
-- Not their own patient: that is can_read_patient. Never passed on: a colleague's colleague is nobody here.
create function public.colleague_may_view(p_patient uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.has_role('therapist') and public.colleague_sharing_on(p_patient)
  and exists(select 1 from public.therapist_patients t join public.profiles tp on tp.id=t.therapist_id and tp.active
   where t.patient_id=p_patient and t.active and t.therapist_id<>auth.uid() and public.colleagues_linked(auth.uid(),t.therapist_id))
$$;

create function public.colleague_viewing(p_patient uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.colleague_may_view(p_patient) and exists(select 1 from public.colleague_views v
  where v.viewer_id=auth.uid() and v.patient_id=p_patient and v.opened_at>now()-interval '30 minutes')
$$;

-- The one check the progress reads use. Everyone who could read before still can; a colleague can while viewing.
create function public.can_view_progress(p_patient uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.can_read_patient(p_patient) or public.colleague_viewing(p_patient)
$$;

-- Opening a colleague's patient: recorded in the audit trail every time, and the only way a colleague's reads get through.
create function public.open_colleague_patient(p_patient uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.colleague_may_view(p_patient) then raise exception 'colleague_unavailable' using errcode='42501'; end if;
 insert into public.colleague_views(viewer_id,patient_id,opened_at) values(auth.uid(),p_patient,now())
 on conflict(viewer_id,patient_id) do update set opened_at=excluded.opened_at;
 insert into public.audit_events(actor_id,action,target_type,target_id) values(auth.uid(),'colleague_viewed','patients',p_patient::text);
 return (select jsonb_build_object('id',p.id,'name',p.display_name,'photo',p.photo_url,
   'therapists',(select coalesce(jsonb_agg(tp.display_name order by tp.display_name),'[]'::jsonb) from public.therapist_patients t join public.profiles tp on tp.id=t.therapist_id
     where t.patient_id=p.id and t.active and public.colleagues_linked(auth.uid(),t.therapist_id)))
  from public.profiles p where p.id=p_patient);
end $$;

-- Colleagues' patients, apart from one's own: only name, photo and whose patient they are. Nothing about them is audited here,
-- because nothing about their progress is read.
create function public.colleague_patients() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.has_role('therapist') then raise exception 'Therapist access required' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'photo',x.photo,'therapist_id',x.therapist_id,'therapist_name',x.therapist_name) order by lower(x.name),x.id)
  from (select distinct on (p.id) p.id,p.display_name name,p.photo_url photo,tp.id therapist_id,tp.display_name therapist_name
   from public.therapist_patients t
   join public.profiles p on p.id=t.patient_id and p.active
   join public.profiles tp on tp.id=t.therapist_id and tp.active
   where t.active and t.therapist_id<>auth.uid() and public.colleagues_linked(auth.uid(),t.therapist_id) and public.colleague_sharing_on(t.patient_id)
    and not exists(select 1 from public.therapist_patients own where own.therapist_id=auth.uid() and own.patient_id=t.patient_id and own.active)
   order by p.id,tp.display_name) x),'[]'::jsonb);
end $$;

-- A therapist's colleagues and requests, each way round.
create function public.colleague_view(l public.therapist_colleagues) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',l.id,'state',l.state,'incoming',l.invitee_id=auth.uid(),
  'other_id',o.id,'other_name',o.display_name,'other_photo',o.photo_url,'created_at',l.created_at,'started_at',l.started_at)
 from public.profiles o where o.id=case when l.requester_id=auth.uid() then l.invitee_id else l.requester_id end
$$;

create function public.my_colleagues() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.has_role('therapist') then raise exception 'Therapist access required' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(public.colleague_view(l) order by l.state='active' desc,l.created_at desc)
  from public.therapist_colleagues l where auth.uid() in (l.requester_id,l.invitee_id) and l.state in ('requested','active')),'[]'::jsonb);
end $$;

-- An invitation by email, accepted in the app by the colleague. The answer never says more than whether a therapist was found.
create function public.invite_colleague(p_email text) returns jsonb language plpgsql security definer set search_path='' as $$
declare other uuid; created public.therapist_colleagues;
begin
 if not public.has_role('therapist') then raise exception 'Therapist access required' using errcode='42501'; end if;
 select u.id into other from auth.users u join public.profiles p on p.id=u.id and p.active join public.user_roles r on r.user_id=u.id and r.role='therapist'
  where lower(u.email)=lower(trim(coalesce(p_email,''))) limit 1;
 if other is null then raise exception 'colleague_not_found'; end if;
 if other=auth.uid() then raise exception 'colleague_self'; end if;
 perform pg_advisory_xact_lock(724030);
 if exists(select 1 from public.therapist_colleagues l where l.state in ('requested','active')
  and least(l.requester_id,l.invitee_id)=least(auth.uid(),other) and greatest(l.requester_id,l.invitee_id)=greatest(auth.uid(),other))
 then raise exception 'colleague_exists'; end if;
 insert into public.therapist_colleagues(requester_id,invitee_id,requested_by) values(auth.uid(),other,auth.uid()) returning * into created;
 insert into public.audit_events(actor_id,action,target_type,target_id) values(auth.uid(),'colleague_invited','therapist_colleagues',created.id::text);
 return public.colleague_view(created);
end $$;

create function public.respond_colleague(p_link uuid,p_accept boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare link public.therapist_colleagues;
begin
 if not public.has_role('therapist') then raise exception 'Therapist access required' using errcode='42501'; end if;
 if p_accept is null then raise exception 'colleague_invalid'; end if;
 select * into link from public.therapist_colleagues where id=p_link and invitee_id=auth.uid() for update;
 if not found then raise exception 'colleague_unavailable' using errcode='42501'; end if;
 if link.state<>'requested' then raise exception 'colleague_state'; end if;
 update public.therapist_colleagues set state=case when p_accept then 'active' else 'declined' end,
  started_at=case when p_accept then now() end,ended_at=case when p_accept then null else now() end,ended_by=case when p_accept then null else auth.uid() end
 where id=link.id returning * into link;
 insert into public.audit_events(actor_id,action,target_type,target_id) values(auth.uid(),case when p_accept then 'colleague_linked' else 'colleague_declined' end,'therapist_colleagues',link.id::text);
 return public.colleague_view(link);
end $$;

-- Either therapist may end it at any time, or withdraw a request. Access ends with it.
create function public.end_colleague(p_link uuid) returns void language plpgsql security definer set search_path='' as $$
declare link public.therapist_colleagues;
begin
 if not public.has_role('therapist') then raise exception 'Therapist access required' using errcode='42501'; end if;
 select * into link from public.therapist_colleagues where id=p_link and auth.uid() in (requester_id,invitee_id) for update;
 if not found then raise exception 'colleague_unavailable' using errcode='42501'; end if;
 if link.state not in ('requested','active') then raise exception 'colleague_state'; end if;
 update public.therapist_colleagues set state='ended',ended_at=now(),ended_by=auth.uid() where id=link.id;
 insert into public.audit_events(actor_id,action,target_type,target_id) values(auth.uid(),'colleague_ended','therapist_colleagues',link.id::text);
end $$;

-- What a patient's own therapist sees: whether the patient opted in, who can see their progress, and when each last looked.
create function public.patient_colleague_access(p_patient uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.can_prescribe(p_patient) then raise exception 'Therapist access required' using errcode='42501'; end if;
 return jsonb_build_object('sharing',public.colleague_sharing_on(p_patient),
  'colleagues',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.display_name,'photo',c.photo_url,
     'last_viewed_at',(select v.opened_at from public.colleague_views v where v.viewer_id=c.id and v.patient_id=p_patient)) order by lower(c.display_name))
   from public.profiles c where c.active and c.id<>auth.uid() and exists(select 1 from public.therapist_patients t
    where t.patient_id=p_patient and t.active and t.therapist_id<>c.id and public.colleagues_linked(c.id,t.therapist_id))
    and not exists(select 1 from public.therapist_patients own where own.patient_id=p_patient and own.therapist_id=c.id and own.active)),'[]'::jsonb));
end $$;

-- Administrators can link two therapists, and end any link, on Android and the web alike.
create function public.admin_colleague_links() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform public.require_admin();
 return coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'state',l.state,'first_id',l.requester_id,'first_name',a.display_name,'second_id',l.invitee_id,
   'second_name',b.display_name,'created_at',l.created_at,'started_at',l.started_at) order by l.state='active' desc,lower(a.display_name),lower(b.display_name))
  from public.therapist_colleagues l join public.profiles a on a.id=l.requester_id join public.profiles b on b.id=l.invitee_id
  where l.state in ('requested','active')),'[]'::jsonb);
end $$;

create function public.admin_set_colleagues(p_first uuid,p_second uuid,p_active boolean) returns void language plpgsql security definer set search_path='' as $$
declare link public.therapist_colleagues;
begin
 perform public.require_admin();
 if p_active is null or p_first is null or p_second is null or p_first=p_second then raise exception 'colleague_invalid'; end if;
 perform pg_advisory_xact_lock(724030);
 select * into link from public.therapist_colleagues l where l.state in ('requested','active')
  and least(l.requester_id,l.invitee_id)=least(p_first,p_second) and greatest(l.requester_id,l.invitee_id)=greatest(p_first,p_second) for update;
 if p_active then
  if (select count(*) from public.profiles p join public.user_roles r on r.user_id=p.id and r.role='therapist' where p.id in (p_first,p_second) and p.active)<>2
  then raise exception 'colleague_not_found'; end if;
  if found then update public.therapist_colleagues set state='active',started_at=coalesce(started_at,now()) where id=link.id returning * into link;
  else insert into public.therapist_colleagues(requester_id,invitee_id,requested_by,state,started_at) values(p_first,p_second,auth.uid(),'active',now()) returning * into link;
  end if;
  insert into public.audit_events(actor_id,action,target_type,target_id) values(auth.uid(),'colleague_linked','therapist_colleagues',link.id::text);
 elsif found then
  update public.therapist_colleagues set state='ended',ended_at=now(),ended_by=auth.uid() where id=link.id;
  insert into public.audit_events(actor_id,action,target_type,target_id) values(auth.uid(),'colleague_ended','therapist_colleagues',link.id::text);
 end if;
end $$;

-- Only the progress reads change. The record, contact details, prescribing and chat keep their own checks.
drop policy sessions_read on public.sessions;
create policy sessions_read on public.sessions for select to authenticated using(public.can_view_progress(patient_id));
drop policy measurements_read on public.session_measurements;
create policy measurements_read on public.session_measurements for select to authenticated using(exists(select 1 from public.sessions s where s.id=session_id and public.can_view_progress(s.patient_id)));
drop policy prescriptions_read on public.prescription_versions;
create policy prescriptions_read on public.prescription_versions for select to authenticated using(public.can_view_progress(patient_id));
drop policy assignments_read on public.exercise_assignments;
create policy assignments_read on public.exercise_assignments for select to authenticated using(public.can_view_progress(patient_id));
drop policy exercise_schedules_read on public.exercise_schedules;
create policy exercise_schedules_read on public.exercise_schedules for select to authenticated using(public.can_view_progress(patient_id));
drop policy exercise_day_results_read on public.exercise_day_results;
create policy exercise_day_results_read on public.exercise_day_results for select to authenticated using(public.can_view_progress(patient_id));

-- The exercise names in a plan a colleague may see.
create or replace function public.can_read_exercise(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.exercises e where e.id=target and (e.owner_id is null or e.owner_id=auth.uid()))
 or exists(select 1 from public.exercise_versions v join public.prescription_versions p on p.exercise_version_id=v.id
  where v.exercise_id=target and public.can_view_progress(p.patient_id))
$$;

-- Shared session videos: the patient, the exercise's therapist, and (owner's decision) a colleague while viewing. Not administrators.
create or replace function public.session_video_viewer(v public.session_videos) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_active_user() and (v.patient_id=auth.uid() or (v.therapist_id=auth.uid() and public.has_role('therapist')
  and exists(select 1 from public.therapist_patients l where l.therapist_id=v.therapist_id and l.patient_id=v.patient_id and l.active))
  or public.colleague_viewing(v.patient_id))
$$;

revoke all on function public.colleague_sharing_version(),public.colleague_sharing_on(uuid),public.colleagues_linked(uuid,uuid),public.colleague_may_view(uuid),
 public.colleague_viewing(uuid),public.colleague_view(public.therapist_colleagues) from public,anon,authenticated;
grant execute on function public.colleague_may_view(uuid),public.colleague_viewing(uuid) to authenticated;
revoke all on function public.can_view_progress(uuid),public.open_colleague_patient(uuid),public.colleague_patients(),public.my_colleagues(),public.invite_colleague(text),
 public.respond_colleague(uuid,boolean),public.end_colleague(uuid),public.patient_colleague_access(uuid),public.my_colleague_sharing(),public.set_colleague_sharing(boolean),
 public.admin_colleague_links(),public.admin_set_colleagues(uuid,uuid,boolean) from public,anon;
grant execute on function public.can_view_progress(uuid),public.open_colleague_patient(uuid),public.colleague_patients(),public.my_colleagues(),public.invite_colleague(text),
 public.respond_colleague(uuid,boolean),public.end_colleague(uuid),public.patient_colleague_access(uuid),public.my_colleague_sharing(),public.set_colleague_sharing(boolean),
 public.admin_colleague_links(),public.admin_set_colleagues(uuid,uuid,boolean) to authenticated;
