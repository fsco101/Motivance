-- The web app now measures exercise sessions too (#137). Record which app measured each one, so validation can
-- compare them. Existing sessions and Android, which sends no client, are phones. Nothing else about ingestion changes.
alter table public.sessions add column client text not null default 'android' check (client in ('android','web'));
comment on column public.sessions.client is 'The app that measured the session: android or web.';

create or replace function public.ingest_session(p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid; owner uuid; version_id uuid; consent_id uuid; fingerprint text; prior public.sessions;
 prescription public.prescription_versions; assignment public.exercise_assignments; exercise public.exercise_versions; consent public.consents;
 rules jsonb; metrics jsonb; app_client text; started timestamptz; ended timestamptz; low numeric; high numeric; valid integer; invalid integer; measured_joint text;
begin
 if not public.has_role('patient') then raise exception 'Patient access required' using errcode='42501'; end if;
 if (p_payload->>'schemaVersion')::integer is distinct from 2 or not p_payload ?& array['sessionId','ownerId','consentId','startedAt','endedAt','rules','metrics'] then raise exception 'Unsupported payload version'; end if;
 sid:=(p_payload->>'sessionId')::uuid; owner:=(p_payload->>'ownerId')::uuid;
 -- Which app measured the session, for validation. Android sends none, so a missing value is a phone.
 app_client:=coalesce(p_payload->>'client','android');
 if app_client not in ('android','web') then raise exception 'Unknown client'; end if;
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
 -- A Both plan records the side actually measured, flagged as part of the set; a single-side plan keeps its exact side.
 or (case when prescription.side='bilateral' then rules->>'side' not in ('LEFT','RIGHT') or coalesce((rules->>'bilateral')::boolean,false) is distinct from true
     else rules->>'side'<>upper(prescription.side) or coalesce((rules->>'bilateral')::boolean,false) end)
 or (rules->>'low')::numeric<>prescription.minimum_degrees
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
 or (rules->>'sideSeconds')::integer is distinct from (prescription.parameters->>'side_seconds')::integer
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
 insert into public.sessions(id,patient_id,prescription_version_id,started_at,ended_at,status,app_version,model_version,algorithm_version,consent_event_id,payload_hash,duration_ms,client)
 values(sid,owner,version_id,started,ended,'completed','0.3.0','pose-landmarker-lite-float16-v1',exercise.algorithm_key,consent_id,fingerprint,(metrics->>'duration')::bigint,app_client);
 insert into public.session_measurements(session_id,metric_key,side,minimum_degrees,maximum_degrees,completed_repetitions,incomplete_repetitions,quality,valid_frames,invalid_frames,failure_reasons)
 values(sid,exercise.algorithm_key,case when prescription.side='bilateral' then lower(rules->>'side') else prescription.side end,low,high,(metrics->>'completed')::integer,(metrics->>'incomplete')::integer,
 case when valid=0 then 'invalid' when invalid>valid then 'limited' else 'valid' end,valid,invalid,coalesce(metrics->'reasons','{}'));
 return jsonb_build_object('sessionId',sid,'duplicate',false);
end $$;
