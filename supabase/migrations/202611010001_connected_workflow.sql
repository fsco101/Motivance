-- Connected workflow: all privileged writes pass through narrowly scoped RPCs.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create table public.patient_invitations (
 id uuid primary key default gen_random_uuid(), therapist_id uuid not null references public.profiles(id),
 email text not null, token_hash text unique not null, expires_at timestamptz not null,
 accepted_by uuid references public.patients(id), accepted_at timestamptz, created_at timestamptz not null default now()
);
alter table public.patient_invitations enable row level security;
revoke all on public.patient_invitations from anon, authenticated;
grant select(id,therapist_id,email,expires_at,accepted_by,accepted_at,created_at) on public.patient_invitations to authenticated;
create policy own_invitations on public.patient_invitations for select to authenticated
 using(public.is_active_user() and (therapist_id=auth.uid() or public.has_role('admin')));
create index invitations_therapist on public.patient_invitations(therapist_id,created_at);

alter table public.prescription_versions add column parameters jsonb not null default '{}';
alter table public.consents add column client_event_id uuid unique;
alter table public.consents add column occurred_at timestamptz not null default now();
alter table public.sessions add column consent_event_id uuid references public.consents(client_event_id);
alter table public.sessions add column payload_hash text;
alter table public.sessions add column duration_ms bigint not null default 0 check(duration_ms>=0);
alter table public.session_measurements alter column minimum_degrees drop not null;
alter table public.session_measurements alter column maximum_degrees drop not null;
alter table public.session_measurements add constraint paired_extrema check((minimum_degrees is null)=(maximum_degrees is null));
alter table public.session_measurements add column valid_frames integer not null default 0 check(valid_frames>=0);
alter table public.session_measurements add column invalid_frames integer not null default 0 check(invalid_frames>=0);
alter table public.session_measurements add column failure_reasons jsonb not null default '{}';
create index consent_patient_occurred on public.consents(patient_id,occurred_at);

create table public.data_requests (
 id uuid primary key, patient_id uuid not null references public.patients(id),
 kind text not null check(kind in ('export','delete')), status text not null default 'requested'
 check(status in ('requested','fulfilled','declined')), created_at timestamptz not null default now(), resolved_at timestamptz
);
alter table public.data_requests enable row level security;
revoke all on public.data_requests from anon,authenticated;
grant select on public.data_requests to authenticated;
create policy data_requests_read on public.data_requests for select to authenticated
 using(public.is_active_user() and (patient_id=auth.uid() or public.has_role('admin')));
-- Explicit development policy: no automatic historical deletion until a deployment owner enables a reviewed policy.
create table public.retention_policy (
 id boolean primary key default true check(id), automatic_deletion boolean not null default false,
 review_after_days integer not null default 365 check(review_after_days>0), policy_version text not null default 'development-v1'
);
insert into public.retention_policy(id) values(true);
alter table public.retention_policy enable row level security;
revoke all on public.retention_policy from anon,authenticated;
grant select on public.retention_policy to authenticated;
create policy policy_read on public.retention_policy for select to authenticated using(public.is_active_user());

create function public.audit_workflow_change() returns trigger language plpgsql security definer set search_path='' as $$
declare target text;
begin
 target:=case when tg_table_name='therapist_patients' then (to_jsonb(new)->>'therapist_id') || ':' || (to_jsonb(new)->>'patient_id')
              when tg_table_name='user_roles' then coalesce(to_jsonb(new)->>'user_id',to_jsonb(old)->>'user_id')
              else to_jsonb(new)->>'id' end;
 insert into public.audit_events(actor_id,action,target_type,target_id)
 values(auth.uid(),lower(tg_op),tg_table_name,coalesce(target,'unknown'));
 return coalesce(new,old);
end $$;
create trigger audit_links after insert or update on public.therapist_patients for each row execute function public.audit_workflow_change();
create trigger audit_roles after insert or delete or update on public.user_roles for each row execute function public.audit_workflow_change();
create trigger audit_prescriptions after insert on public.prescription_versions for each row execute function public.audit_workflow_change();
create trigger audit_data_requests after insert or update on public.data_requests for each row execute function public.audit_workflow_change();
create trigger audit_sessions after insert on public.sessions for each row execute function public.audit_workflow_change();
create trigger audit_consents after insert on public.consents for each row execute function public.audit_workflow_change();

create function public.invite_patient(p_email text) returns jsonb language plpgsql security definer set search_path='' as $$
declare code text; invitation uuid;
begin
 if not public.has_role('therapist') then raise exception 'Therapist access required' using errcode='42501'; end if;
 if length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Invalid email'; end if;
 code:=encode(extensions.gen_random_bytes(24),'hex');
 insert into public.patient_invitations(therapist_id,email,token_hash,expires_at)
 values(auth.uid(),lower(trim(p_email)),encode(extensions.digest(code,'sha256'),'hex'),now()+interval '7 days') returning id into invitation;
 insert into public.audit_events(actor_id,action,target_type,target_id) values(auth.uid(),'invite','patient_invitations',invitation::text);
 return jsonb_build_object('id',invitation,'code',code,'expires_at',now()+interval '7 days');
end $$;

create function public.accept_patient_invitation(p_code text) returns uuid language plpgsql security definer set search_path='' as $$
declare invitation public.patient_invitations;
begin
 if not public.has_role('patient') then raise exception 'Patient access required' using errcode='42501'; end if;
 select * into invitation from public.patient_invitations where token_hash=encode(extensions.digest(trim(p_code),'sha256'),'hex') for update;
 if not found or invitation.expires_at<=now() or invitation.email<>lower(auth.jwt()->>'email')
 or not exists(select 1 from public.user_roles r join public.profiles p on p.id=r.user_id where r.user_id=invitation.therapist_id and r.role='therapist' and p.active)
 then raise exception 'Invitation unavailable or email does not match' using errcode='42501'; end if;
 if invitation.accepted_by is not null then
   if invitation.accepted_by=auth.uid() then return invitation.therapist_id; end if;
   raise exception 'Invitation already used' using errcode='42501';
 end if;
 insert into public.therapist_patients(therapist_id,patient_id,assigned_by) values(invitation.therapist_id,auth.uid(),invitation.therapist_id)
 on conflict(therapist_id,patient_id) do update set active=true,assigned_by=excluded.assigned_by;
 update public.patient_invitations set accepted_by=auth.uid(),accepted_at=now() where id=invitation.id;
 return invitation.therapist_id;
end $$;

create function public.revoke_patient_link(p_patient uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.has_role('therapist') then raise exception 'Therapist access required' using errcode='42501'; end if;
 update public.therapist_patients set active=false where therapist_id=auth.uid() and patient_id=p_patient;
 if not found then raise exception 'Link unavailable' using errcode='42501'; end if;
 update public.exercise_assignments set active=false where therapist_id=auth.uid() and patient_id=p_patient;
 update public.patient_invitations set expires_at=least(expires_at,now()) where therapist_id=auth.uid()
 and email=(select lower(email) from auth.users where id=p_patient);
end $$;

create function public.publish_prescription(p_assignment uuid,p_version uuid,p_patient uuid,p_exercise uuid,p_side text,p_low numeric,p_high numeric,p_repetitions integer,p_parameters jsonb default '{}')
returns uuid language plpgsql security definer set search_path='' as $$
declare exercise public.exercise_versions; existing public.prescription_versions; assignment public.exercise_assignments; next_version integer;
begin
 if not public.can_prescribe(p_patient) then raise exception 'Assigned therapist required' using errcode='42501'; end if;
 if p_side is null or p_side not in ('left','right') or p_low is null or p_high is null or p_low<0 or p_high>180 or p_high<=p_low+10
 or p_low='NaN'::numeric or p_high='NaN'::numeric or p_repetitions is null or p_repetitions not between 1 and 1000
 or jsonb_typeof(p_parameters) is distinct from 'object' then raise exception 'Invalid prescription parameters'; end if;
 select v.* into exercise from public.exercise_versions v join public.exercises e on e.id=v.exercise_id where v.id=p_exercise and v.published and e.active;
 if not found or exercise.algorithm_key not in ('elbow-flexion-v1','shoulder-abduction-v1')
 or exercise.definition->>'measurement_convention'<>(case when exercise.algorithm_key='elbow-flexion-v1' then '2d_flexion_degrees' else '2d_abduction_degrees' end)
 then raise exception 'Unsupported exercise'; end if;
 if coalesce((p_parameters->>'minimum_cycle_ms')::integer,600) not between 100 and 30000
 or coalesce((p_parameters->>'maximum_cycle_ms')::integer,30000)<=coalesce((p_parameters->>'minimum_cycle_ms')::integer,600)
 or coalesce((p_parameters->>'maximum_cycle_ms')::integer,30000)>300000
 or coalesce((p_parameters->>'peak_hold_ms')::integer,100) not between 0 and 5000
 or coalesce((p_parameters->>'max_trunk_lean_degrees')::numeric,20) not between 0 and 90
 or coalesce((p_parameters->>'confidence')::numeric,.7) not between .1 and 1
 or exists(select 1 from jsonb_object_keys(p_parameters) k where k not in ('minimum_cycle_ms','maximum_cycle_ms','peak_hold_ms','max_trunk_lean_degrees','confidence'))
 then raise exception 'Unsupported form/timing parameters'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_assignment::text,0));
 select * into existing from public.prescription_versions where id=p_version;
 if found then
   if existing.created_by=auth.uid() and existing.assignment_id=p_assignment and existing.patient_id=p_patient and existing.exercise_version_id=p_exercise
      and existing.side=p_side and existing.minimum_degrees=p_low and existing.maximum_degrees=p_high and existing.target_repetitions=p_repetitions and existing.parameters=p_parameters
   then return existing.id; end if;
   raise exception 'Prescription request ID conflict' using errcode='23505';
 end if;
 select * into assignment from public.exercise_assignments where id=p_assignment;
 if found then
   if assignment.therapist_id<>auth.uid() or assignment.patient_id<>p_patient or not assignment.active then raise exception 'Assignment unavailable' using errcode='42501'; end if;
 else
   insert into public.exercise_assignments(id,patient_id,therapist_id) values(p_assignment,p_patient,auth.uid());
 end if;
 select coalesce(max(version),0)+1 into next_version from public.prescription_versions where assignment_id=p_assignment;
 insert into public.prescription_versions(id,assignment_id,patient_id,exercise_version_id,version,side,minimum_degrees,maximum_degrees,target_repetitions,created_by,parameters)
 values(p_version,p_assignment,p_patient,p_exercise,next_version,p_side,p_low,p_high,p_repetitions,auth.uid(),p_parameters);
 return p_version;
end $$;

create function public.record_consent(p_id uuid,p_event text,p_version text,p_occurred_at timestamptz) returns uuid language plpgsql security definer set search_path='' as $$
declare previous public.consents;
begin
 if not public.has_role('patient') then raise exception 'Patient access required' using errcode='42501'; end if;
 if p_event not in ('granted','withdrawn') or p_version<>'movement-summary-v1' or p_occurred_at>now()+interval '5 minutes' then raise exception 'Invalid consent event'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,1));
 select * into previous from public.consents where client_event_id=p_id;
 if found then
   if previous.patient_id=auth.uid() and previous.event=p_event and previous.version=p_version and previous.occurred_at=p_occurred_at then return p_id; end if;
   raise exception 'Consent ID conflict' using errcode='23505';
 end if;
 insert into public.consents(patient_id,consent_type,version,event,client_event_id,occurred_at) values(auth.uid(),'movement-summary',p_version,p_event,p_id,p_occurred_at);
 return p_id;
end $$;

create function public.ingest_session(p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid; owner uuid; version_id uuid; consent_id uuid; fingerprint text; prior public.sessions;
 prescription public.prescription_versions; assignment public.exercise_assignments; exercise public.exercise_versions; consent public.consents;
 rules jsonb; metrics jsonb; started timestamptz; ended timestamptz; low numeric; high numeric; valid integer; invalid integer;
begin
 if not public.has_role('patient') then raise exception 'Patient access required' using errcode='42501'; end if;
 if (p_payload->>'schemaVersion')::integer is distinct from 2 or not p_payload ?& array['sessionId','ownerId','consentId','startedAt','endedAt','rules','metrics'] then raise exception 'Unsupported payload version'; end if;
 sid:=(p_payload->>'sessionId')::uuid; owner:=(p_payload->>'ownerId')::uuid;
 if owner is distinct from auth.uid() then raise exception 'Session owner mismatch' using errcode='42501'; end if;
 fingerprint:=encode(extensions.digest(p_payload::text,'sha256'),'hex');
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(sid::text,2));
 select * into prior from public.sessions where id=sid;
 if found then
   if prior.patient_id=owner and prior.payload_hash=fingerprint then return jsonb_build_object('sessionId',sid,'duplicate',true); end if;
   raise exception 'Session UUID conflict' using errcode='23505';
 end if;
 rules:=p_payload->'rules'; metrics:=p_payload->'metrics';
 if jsonb_typeof(rules) is distinct from 'object' or jsonb_typeof(metrics) is distinct from 'object'
 or not rules ?& array['prescription','demo','version','side','low','high','target','kind','minimumCycleMs','maximumCycleMs','peakHoldMs','maxTrunkLean','confidence','stableFrames','maxSpeed']
 or exists(select 1 from jsonb_each(rules) where value='null'::jsonb) then raise exception 'Incomplete recorded rules'; end if;
 version_id:=(rules->>'prescription')::uuid; consent_id:=(p_payload->>'consentId')::uuid;
 select * into prescription from public.prescription_versions where id=version_id and patient_id=owner;
 if not found then raise exception 'Prescription ownership mismatch' using errcode='42501'; end if;
 select * into assignment from public.exercise_assignments where id=prescription.assignment_id;
 if not assignment.active or not exists(select 1 from public.therapist_patients where therapist_id=assignment.therapist_id and patient_id=owner and active)
 then raise exception 'Assignment access revoked' using errcode='42501'; end if;
 select * into exercise from public.exercise_versions where id=prescription.exercise_version_id;
 if (rules->>'demo')::boolean is distinct from false or rules->>'version'<>exercise.id::text
 or rules->>'side'<>upper(prescription.side) or (rules->>'low')::numeric<>prescription.minimum_degrees
 or (rules->>'high')::numeric<>prescription.maximum_degrees or (rules->>'target')::integer<>prescription.target_repetitions
 or rules->>'kind'<>(case when exercise.algorithm_key='elbow-flexion-v1' then 'ELBOW_FLEXION' else 'SHOULDER_ABDUCTION' end)
 then raise exception 'Recorded prescription parameters do not match'; end if;
 if (rules->>'minimumCycleMs')::bigint<>coalesce((prescription.parameters->>'minimum_cycle_ms')::bigint,600)
 or (rules->>'maximumCycleMs')::bigint<>coalesce((prescription.parameters->>'maximum_cycle_ms')::bigint,30000)
 or (rules->>'peakHoldMs')::bigint<>coalesce((prescription.parameters->>'peak_hold_ms')::bigint,100)
 or (rules->>'maxTrunkLean')::numeric<>coalesce((prescription.parameters->>'max_trunk_lean_degrees')::numeric,20)
 or abs((rules->>'confidence')::numeric-coalesce((prescription.parameters->>'confidence')::numeric,.7))>.00001
 or (rules->>'stableFrames')::integer<>5 or (rules->>'maxSpeed')::numeric<>600
 then raise exception 'Recorded form/timing parameters do not match'; end if;
 started:=to_timestamp((p_payload->>'startedAt')::numeric/1000); ended:=to_timestamp((p_payload->>'endedAt')::numeric/1000);
 if started is null or ended is null or ended<started or ended>now()+interval '5 minutes' then raise exception 'Invalid session time'; end if;
 select * into consent from public.consents where client_event_id=consent_id and patient_id=owner and event='granted' and version='movement-summary-v1';
 if not found or consent.occurred_at>started or exists(select 1 from public.consents where patient_id=owner and event='withdrawn' and occurred_at>=consent.occurred_at and occurred_at<=ended)
 then raise exception 'Valid recording consent required' using errcode='42501'; end if;
 low:=(metrics->>'min')::numeric; high:=(metrics->>'max')::numeric;
 valid:=(metrics->>'valid')::integer; invalid:=(metrics->>'invalid')::integer;
 if valid is null or invalid is null or (metrics->>'completed') is null or (metrics->>'incomplete') is null or (metrics->>'duration') is null
 or valid<0 or invalid<0 or (low is null)<>(high is null) or low<0 or high>180 or high<low or low='NaN'::numeric or high='NaN'::numeric
 or (valid=0 and low is not null) or (valid>0 and low is null) or (metrics->>'duration')::bigint<0
 or (metrics->>'duration')::numeric>(p_payload->>'endedAt')::numeric-(p_payload->>'startedAt')::numeric+1000
 then raise exception 'Invalid measurement summary'; end if;
 if jsonb_typeof(coalesce(metrics->'reasons','{}')) is distinct from 'object'
 or exists(select 1 from jsonb_each(coalesce(metrics->'reasons','{}')) where key not in ('INCOMPLETE_RANGE','TOO_FAST','TIMED_OUT') or jsonb_typeof(value)<>'number' or (value::text)::integer<0)
 or (select coalesce(sum((value::text)::integer),0) from jsonb_each(coalesce(metrics->'reasons','{}')))<>(metrics->>'incomplete')::integer
 then raise exception 'Invalid incomplete repetition reasons'; end if;
 insert into public.sessions(id,patient_id,prescription_version_id,started_at,ended_at,status,app_version,model_version,algorithm_version,consent_event_id,payload_hash,duration_ms)
 values(sid,owner,version_id,started,ended,'completed','0.3.0','pose-landmarker-lite-float16-v1',exercise.algorithm_key,consent_id,fingerprint,(metrics->>'duration')::bigint);
 insert into public.session_measurements(session_id,metric_key,side,minimum_degrees,maximum_degrees,completed_repetitions,incomplete_repetitions,quality,valid_frames,invalid_frames,failure_reasons)
 values(sid,exercise.algorithm_key,prescription.side,low,high,(metrics->>'completed')::integer,(metrics->>'incomplete')::integer,
 case when valid=0 then 'invalid' when invalid>valid then 'limited' else 'valid' end,valid,invalid,coalesce(metrics->'reasons','{}'));
 return jsonb_build_object('sessionId',sid,'duplicate',false);
end $$;

create function public.request_patient_data(p_id uuid,p_kind text) returns uuid language plpgsql security definer set search_path='' as $$
begin
 if not public.has_role('patient') then raise exception 'Patient access required' using errcode='42501'; end if;
 if p_kind not in ('export','delete') then raise exception 'Unsupported request type'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,3));
 if exists(select 1 from public.data_requests where id=p_id and (patient_id<>auth.uid() or kind<>p_kind)) then raise exception 'Request ID conflict'; end if;
 insert into public.data_requests(id,patient_id,kind) values(p_id,auth.uid(),p_kind) on conflict(id) do nothing;
 return p_id;
end $$;

-- Direct inserts would bypass validation/consent/idempotency: the RPCs replace them.
revoke insert on public.exercise_assignments,public.prescription_versions,public.sessions,public.session_measurements,public.consents from authenticated;
revoke all on function public.audit_workflow_change(),public.invite_patient(text),public.accept_patient_invitation(text),public.revoke_patient_link(uuid),
 public.publish_prescription(uuid,uuid,uuid,uuid,text,numeric,numeric,integer,jsonb),public.record_consent(uuid,text,text,timestamptz),public.ingest_session(jsonb),public.request_patient_data(uuid,text) from public,anon,authenticated;
grant execute on function public.invite_patient(text),public.accept_patient_invitation(text),public.revoke_patient_link(uuid),
 public.publish_prescription(uuid,uuid,uuid,uuid,text,numeric,numeric,integer,jsonb),public.record_consent(uuid,text,text,timestamptz),public.ingest_session(jsonb),public.request_patient_data(uuid,text) to authenticated;

-- Usable engineering catalogue; clinician/physical validation is a later checklist, not a development gate.
insert into public.exercises(id,code,active) values
 ('20000000-0000-0000-0000-000000000001','elbow-flexion',true),('20000000-0000-0000-0000-000000000002','shoulder-abduction',true);
insert into public.exercise_versions(id,exercise_id,version,algorithm_key,definition,published) values
 ('21000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1,'elbow-flexion-v1',
 '{"name":"Elbow flexion","validation_status":"development","measurement_convention":"2d_flexion_degrees","instructions_en":"Place the camera side-on on a stable support. Keep the selected shoulder, elbow, wrist and hip visible. Begin with a comfortable straight arm; bend and return within your assigned targets."}',true),
 ('21000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002',1,'shoulder-abduction-v1',
 '{"name":"Shoulder abduction","validation_status":"development","measurement_convention":"2d_abduction_degrees","instructions_en":"Face the camera on a stable support. Keep your hip, shoulder and elbow visible. Begin with your arm by your side; raise and lower it within your assigned targets. Keep your torso upright."}',true);
