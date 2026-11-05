-- Therapist-authored exercises. A custom exercise names one of the joints the app can already measure and reuses the
-- existing repetition rules, so no new measurement model is introduced. Each belongs to the therapist who wrote it:
-- instructions are free text, so they are readable only by that therapist and by accounts with access to a patient
-- it was prescribed to. Built-in exercises have no owner and stay readable by every active user.

alter table public.exercises add column owner_id uuid references public.profiles(id);
create index exercises_owner_id_idx on public.exercises(owner_id) where owner_id is not null;
create index prescription_versions_exercise_version_idx on public.prescription_versions(exercise_version_id);

create function public.can_read_exercise(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.exercises e where e.id=target and (e.owner_id is null or e.owner_id=auth.uid()))
 or exists(select 1 from public.exercise_versions v join public.prescription_versions p on p.exercise_version_id=v.id
  where v.exercise_id=target and public.can_read_patient(p.patient_id))
$$;
revoke all on function public.can_read_exercise(uuid) from public,anon,authenticated;
grant execute on function public.can_read_exercise(uuid) to authenticated;

drop policy exercises_read on public.exercises;
create policy exercises_read on public.exercises for select to authenticated using(public.is_active_user() and active and public.can_read_exercise(id));
drop policy versions_read on public.exercise_versions;
create policy versions_read on public.exercise_versions for select to authenticated using(public.is_active_user() and published and public.can_read_exercise(exercise_id));

-- p_id is chosen by the client so a retry after a lost response returns the same exercise instead of a duplicate.
create function public.create_custom_exercise(p_id uuid,p_name text,p_joint text,p_english text,p_filipino text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare existing public.exercises; version_id uuid; definition jsonb; stored jsonb;
begin
 if not public.has_role('therapist') then raise exception 'Therapist access required' using errcode='42501'; end if;
 if p_id is null or p_name is null or length(trim(p_name)) not between 1 and 120 or p_english is null or length(trim(p_english)) not between 1 and 4000
 or length(trim(coalesce(p_filipino,'')))>4000 or p_joint is null or p_joint not in ('SHOULDER','ELBOW','WRIST','HIP','KNEE','ANKLE')
 then raise exception 'Invalid custom exercise'; end if;
 definition:=jsonb_build_object('name',trim(p_name),'validation_status','therapist_defined','measurement_convention','2d_joint_degrees',
  'measured_joint',p_joint,'instructions_en',trim(p_english))
  ||case when length(trim(coalesce(p_filipino,'')))>0 then jsonb_build_object('instructions_fil',trim(p_filipino)) else '{}'::jsonb end;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,3));
 select * into existing from public.exercises where id=p_id;
 if found then
  select v.id,v.definition into version_id,stored from public.exercise_versions v where v.exercise_id=p_id and v.version=1;
  if existing.owner_id is distinct from auth.uid() or stored is distinct from definition then raise exception 'Exercise request ID conflict' using errcode='23505'; end if;
  return version_id;
 end if;
 insert into public.exercises(id,code,active,owner_id) values(p_id,'custom-'||p_id::text,true,auth.uid());
 insert into public.exercise_versions(exercise_id,version,algorithm_key,definition,published) values(p_id,1,'joint-angle-v1',definition,true) returning id into version_id;
 insert into public.audit_events(actor_id,action,target_type,target_id) values(auth.uid(),'publish','exercise_versions',version_id::text);
 return version_id;
end $$;

-- Removes the exercise from new prescriptions only: published versions stay readable, so existing assignments and history keep working.
create function public.archive_custom_exercise(p_exercise uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.has_role('therapist') then raise exception 'Therapist access required' using errcode='42501'; end if;
 update public.exercises set active=false where id=p_exercise and owner_id=auth.uid();
 if not found then raise exception 'Custom exercise unavailable' using errcode='42501'; end if;
 insert into public.audit_events(actor_id,action,target_type,target_id) values(auth.uid(),'deactivate','exercises',p_exercise::text);
end $$;
revoke all on function public.create_custom_exercise(uuid,text,text,text,text),public.archive_custom_exercise(uuid) from public,anon,authenticated;
grant execute on function public.create_custom_exercise(uuid,text,text,text,text),public.archive_custom_exercise(uuid) to authenticated;

-- Administrators can correct custom exercises through the existing catalogue tools.
create or replace function public.admin_publish_exercise(p_exercise uuid,p_name text,p_english text,p_filipino text) returns uuid language plpgsql security definer set search_path='' as $$
declare previous public.exercise_versions; new_id uuid;
begin
 perform public.require_admin();
 if p_name is null or length(trim(p_name)) not between 1 and 120 or p_english is null or length(trim(p_english)) not between 1 and 4000
 or p_filipino is null or length(trim(p_filipino)) not between 1 and 4000 then raise exception 'Localized name/instructions required'; end if;
 perform 1 from public.exercises where id=p_exercise for update;
 if not found then raise exception 'Exercise unavailable'; end if;
 select * into previous from public.exercise_versions where exercise_id=p_exercise order by version desc limit 1;
 if not found or previous.algorithm_key not in ('elbow-flexion-v1','shoulder-abduction-v1','joint-angle-v1') then raise exception 'Unsupported algorithm'; end if;
 insert into public.exercise_versions(exercise_id,version,algorithm_key,definition,published)
 values(p_exercise,previous.version+1,previous.algorithm_key,
 previous.definition || jsonb_build_object('name',trim(p_name),'instructions_en',trim(p_english),'instructions_fil',trim(p_filipino)),true) returning id into new_id;
 insert into public.audit_events(actor_id,action,target_type,target_id) values(auth.uid(),'publish','exercise_versions',new_id::text);
 return new_id;
end $$;

-- Prescribing and session upload accept custom exercises; the uploaded joint must match the one prescribed.
create or replace function public.publish_prescription(p_assignment uuid,p_version uuid,p_patient uuid,p_exercise uuid,p_side text,p_low numeric,p_high numeric,p_repetitions integer,p_parameters jsonb default '{}')
returns uuid language plpgsql security definer set search_path='' as $$
declare exercise public.exercise_versions; existing public.prescription_versions; assignment public.exercise_assignments; next_version integer;
begin
 if not public.can_prescribe(p_patient) then raise exception 'Assigned therapist required' using errcode='42501'; end if;
 if p_side is null or p_side not in ('left','right') or p_low is null or p_high is null or p_low<0 or p_high>180 or p_high<=p_low+10
 or p_low='NaN'::numeric or p_high='NaN'::numeric or p_repetitions is null or p_repetitions not between 1 and 1000
 or jsonb_typeof(p_parameters) is distinct from 'object' then raise exception 'Invalid prescription parameters'; end if;
 select v.* into exercise from public.exercise_versions v join public.exercises e on e.id=v.exercise_id where v.id=p_exercise and v.published and e.active;
 if not found or exercise.algorithm_key not in ('elbow-flexion-v1','shoulder-abduction-v1','joint-angle-v1')
 or exercise.definition->>'measurement_convention' is distinct from (case exercise.algorithm_key when 'elbow-flexion-v1' then '2d_flexion_degrees' when 'shoulder-abduction-v1' then '2d_abduction_degrees' else '2d_joint_degrees' end)
 then raise exception 'Unsupported exercise'; end if;
 -- A custom exercise can only be prescribed by the therapist who wrote it, and must name a joint the app can measure.
 if exercise.algorithm_key='joint-angle-v1' and (coalesce(exercise.definition->>'measured_joint','') not in ('SHOULDER','ELBOW','WRIST','HIP','KNEE','ANKLE')
 or not exists(select 1 from public.exercises e where e.id=exercise.exercise_id and e.owner_id=auth.uid()))
 then raise exception 'Custom exercise unavailable' using errcode='42501'; end if;
 if coalesce((p_parameters->>'minimum_cycle_ms')::integer,600) not between 100 and 30000
 or coalesce((p_parameters->>'maximum_cycle_ms')::integer,30000)<=coalesce((p_parameters->>'minimum_cycle_ms')::integer,600)
 or coalesce((p_parameters->>'maximum_cycle_ms')::integer,30000)>300000
 or coalesce((p_parameters->>'peak_hold_ms')::integer,100) not between 0 and 5000
 or coalesce((p_parameters->>'max_trunk_lean_degrees')::numeric,20) not between 0 and 90
 or coalesce((p_parameters->>'confidence')::numeric,.7) not between .1 and 1
 or exists(select 1 from jsonb_object_keys(p_parameters) k where k not in ('minimum_cycle_ms','maximum_cycle_ms','peak_hold_ms','max_trunk_lean_degrees','confidence','focus_joint'))
 or (p_parameters ? 'focus_joint' and (jsonb_typeof(p_parameters->'focus_joint') is distinct from 'string' or p_parameters->>'focus_joint' not in ('SHOULDER','ELBOW','WRIST','HIP','KNEE','ANKLE')))
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

create or replace function public.ingest_session(p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid; owner uuid; version_id uuid; consent_id uuid; fingerprint text; prior public.sessions;
 prescription public.prescription_versions; assignment public.exercise_assignments; exercise public.exercise_versions; consent public.consents;
 rules jsonb; metrics jsonb; started timestamptz; ended timestamptz; low numeric; high numeric; valid integer; invalid integer; measured_joint text;
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
 -- The visual focus is pinned to the immutable prescription; legacy payloads use their original exercise joint.
 measured_joint:=case exercise.algorithm_key when 'elbow-flexion-v1' then 'ELBOW' when 'shoulder-abduction-v1' then 'SHOULDER' else exercise.definition->>'measured_joint' end;
 if coalesce(rules->>'focusJoint',measured_joint) is distinct from coalesce(prescription.parameters->>'focus_joint',measured_joint)
 then raise exception 'Recorded focus does not match prescription'; end if;

 if (rules->>'demo')::boolean is distinct from false or rules->>'version'<>exercise.id::text
 or rules->>'side'<>upper(prescription.side) or (rules->>'low')::numeric<>prescription.minimum_degrees
 or (rules->>'high')::numeric<>prescription.maximum_degrees or (rules->>'target')::integer<>prescription.target_repetitions
 or rules->>'kind'<>(case exercise.algorithm_key when 'elbow-flexion-v1' then 'ELBOW_FLEXION' when 'shoulder-abduction-v1' then 'SHOULDER_ABDUCTION' else 'CUSTOM' end)
 or coalesce(rules->>'measuredJoint',measured_joint) is distinct from measured_joint
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
