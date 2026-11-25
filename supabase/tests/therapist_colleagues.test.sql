begin;
create extension if not exists pgtap with schema extensions;
select plan(35);
-- #173: a therapist's colleague reads the progress of the other's patients who opted in, read-only and audited.
-- A = the patients' therapist, B = linked colleague, C = unlinked, D = asked but not accepted, E = link ended, F = B's own colleague.
-- P = A's patient who opted in, Q = A's patient who did not. X = administrator.
insert into auth.users(id,email,email_confirmed_at) values
 ('73000000-0000-0000-0000-00000000000a','a@colleague.test',now()),('73000000-0000-0000-0000-00000000000b','b@colleague.test',now()),
 ('73000000-0000-0000-0000-00000000000c','c@colleague.test',now()),('73000000-0000-0000-0000-00000000000d','d@colleague.test',now()),
 ('73000000-0000-0000-0000-00000000000e','e@colleague.test',now()),('73000000-0000-0000-0000-00000000000f','f@colleague.test',now()),
 ('73000000-0000-0000-0000-000000000001','p@colleague.test',now()),('73000000-0000-0000-0000-000000000002','q@colleague.test',now()),
 ('73000000-0000-0000-0000-000000000009','x@colleague.test',now());
insert into public.user_roles values('73000000-0000-0000-0000-00000000000a','therapist'),('73000000-0000-0000-0000-00000000000b','therapist'),
 ('73000000-0000-0000-0000-00000000000c','therapist'),('73000000-0000-0000-0000-00000000000d','therapist'),('73000000-0000-0000-0000-00000000000e','therapist'),
 ('73000000-0000-0000-0000-00000000000f','therapist'),('73000000-0000-0000-0000-000000000009','admin');
update public.profiles set display_name='Pia Patient' where id='73000000-0000-0000-0000-000000000001';
insert into public.therapist_patients(therapist_id,patient_id) values('73000000-0000-0000-0000-00000000000a','73000000-0000-0000-0000-000000000001'),('73000000-0000-0000-0000-00000000000a','73000000-0000-0000-0000-000000000002');
insert into public.exercises(id,code,active) values('73100000-0000-0000-0000-000000000001','colleague-test',true);
insert into public.exercise_versions(id,exercise_id,version,algorithm_key,definition,published) values('73100000-0000-0000-0000-000000000002','73100000-0000-0000-0000-000000000001',1,'colleague-test','{}',true);
insert into public.exercise_assignments(id,patient_id,therapist_id) values('73100000-0000-0000-0000-000000000003','73000000-0000-0000-0000-000000000001','73000000-0000-0000-0000-00000000000a'),
 ('73100000-0000-0000-0000-000000000013','73000000-0000-0000-0000-000000000002','73000000-0000-0000-0000-00000000000a');
insert into public.prescription_versions(id,assignment_id,patient_id,exercise_version_id,version,side,minimum_degrees,maximum_degrees,target_repetitions,created_by) values
 ('73100000-0000-0000-0000-000000000004','73100000-0000-0000-0000-000000000003','73000000-0000-0000-0000-000000000001','73100000-0000-0000-0000-000000000002',1,'left',10,90,5,'73000000-0000-0000-0000-00000000000a'),
 ('73100000-0000-0000-0000-000000000014','73100000-0000-0000-0000-000000000013','73000000-0000-0000-0000-000000000002','73100000-0000-0000-0000-000000000002',1,'left',10,90,5,'73000000-0000-0000-0000-00000000000a');
insert into public.sessions values('73100000-0000-0000-0000-000000000005','73000000-0000-0000-0000-000000000001','73100000-0000-0000-0000-000000000004',now(),now(),'completed','test','test','test'),
 ('73100000-0000-0000-0000-000000000015','73000000-0000-0000-0000-000000000002','73100000-0000-0000-0000-000000000014',now(),now(),'completed','test','test','test');
insert into public.session_measurements(session_id,metric_key,side,minimum_degrees,maximum_degrees,completed_repetitions,quality) values('73100000-0000-0000-0000-000000000005','elbow','left',10,90,5,'valid');
-- A patient's contact details, which a colleague must never read.
set local session_replication_role=replica;
insert into public.patient_profiles(user_id,username,full_name,gender,birthdate,address,contact,privacy_version,consented_at,updated_at)
 values('73000000-0000-0000-0000-000000000001','pia','Pia Patient','female','1990-01-01','12 Mabini Street','09170000000','v1',now(),now());
set local session_replication_role=origin;

set local role authenticated;
-- The patient opts in; the other patient does not.
select set_config('request.jwt.claim.sub','73000000-0000-0000-0000-000000000001',true);
select is(public.my_colleague_sharing()->>'granted','false','sharing with colleagues is off until the patient turns it on');
select is(public.set_colleague_sharing(true)->>'granted','true','the patient turns it on');

-- Making the links: A invites B, B accepts. A invites D, D never answers. A and E link, then E ends it. B and F link.
select set_config('request.jwt.claim.sub','73000000-0000-0000-0000-00000000000a',true);
select throws_ok($$select public.invite_colleague('nobody@colleague.test')$$,'P0001','colleague_not_found','only a therapist can be invited');
select throws_ok($$select public.invite_colleague('p@colleague.test')$$,'P0001','colleague_not_found','a patient cannot be invited');
select throws_ok($$select public.invite_colleague('A@colleague.test')$$,'P0001','colleague_self','nobody links to themselves');
select is(public.invite_colleague('b@colleague.test')->>'state','requested','an invitation waits for the colleague');
select throws_ok($$select public.invite_colleague('b@colleague.test')$$,'P0001','colleague_exists','one open request per pair');
select lives_ok($$select public.invite_colleague('d@colleague.test')$$,'a second invitation to someone else');
select lives_ok($$select public.invite_colleague('e@colleague.test')$$,'a third');
select throws_ok($$select public.respond_colleague((select (x->>'id')::uuid from jsonb_array_elements(public.my_colleagues()) x where x->>'other_name' is null limit 1),true)$$,'42501',null,'the one who asked cannot accept for the other');
select set_config('request.jwt.claim.sub','73000000-0000-0000-0000-00000000000b',true);
select is(public.respond_colleague((select (x->>'id')::uuid from jsonb_array_elements(public.my_colleagues()) x where (x->>'incoming')::boolean),true)->>'state','active','the colleague accepts');
select set_config('request.jwt.claim.sub','73000000-0000-0000-0000-00000000000e',true);
select lives_ok($$select public.respond_colleague((select (x->>'id')::uuid from jsonb_array_elements(public.my_colleagues()) x),true)$$,'E accepts');
select lives_ok($$select public.end_colleague((select (x->>'id')::uuid from jsonb_array_elements(public.my_colleagues()) x))$$,'and E ends it at any time');
reset role;
insert into public.therapist_colleagues(requester_id,invitee_id,requested_by,state,started_at) values('73000000-0000-0000-0000-00000000000b','73000000-0000-0000-0000-00000000000f','73000000-0000-0000-0000-00000000000b','active',now());
set local role authenticated;

-- B, the linked colleague: sees P listed, reads nothing until opening P, then reads P's progress and the plan, and the open is audited.
select set_config('request.jwt.claim.sub','73000000-0000-0000-0000-00000000000b',true);
select is((select array_agg(x->>'name') from jsonb_array_elements(public.colleague_patients()) x),array['Pia Patient'],'only the patient who opted in is listed');
select is((select count(*)::int from public.sessions where patient_id='73000000-0000-0000-0000-000000000001'),0,'nothing is read before the patient is opened');
select is(public.open_colleague_patient('73000000-0000-0000-0000-000000000001')->>'name','Pia Patient','opening the patient is allowed');
select is((select count(*)::int from public.sessions where patient_id='73000000-0000-0000-0000-000000000001'),1,'a linked colleague reads progress');
select is((select count(*)::int from public.session_measurements m join public.sessions s on s.id=m.session_id where s.patient_id='73000000-0000-0000-0000-000000000001'),1,'and range-of-motion results');
select is((select count(*)::int from public.prescription_versions where patient_id='73000000-0000-0000-0000-000000000001'),1,'and the current plan');
select throws_ok($$select public.open_colleague_patient('73000000-0000-0000-0000-000000000002')$$,'42501',null,'a patient who did not opt in cannot be opened');
select is((select count(*)::int from public.sessions where patient_id='73000000-0000-0000-0000-000000000002'),0,'nor read');
-- Seeing is not treating.
select is(public.can_prescribe('73000000-0000-0000-0000-000000000001'),false,'a colleague cannot prescribe');
select is(public.can_read_patient('73000000-0000-0000-0000-000000000001'),false,'nor open the patient record');
select is((select count(*)::int from public.patient_profiles where user_id='73000000-0000-0000-0000-000000000001'),0,'nor read the contact details or address');
select throws_ok($$select public.exercise_day('73000000-0000-0000-0000-000000000001')$$,'42501',null,'nor manage the exercise schedule');
select is((select count(*)::int from jsonb_array_elements(public.my_conversations()) c where c->>'other_id'='73000000-0000-0000-0000-000000000001'),0,'nor has a conversation with the patient');

-- Nobody else: an unlinked therapist, a request not accepted, an ended link, and a colleague's colleague.
select set_config('request.jwt.claim.sub','73000000-0000-0000-0000-00000000000c',true);
select throws_ok($$select public.open_colleague_patient('73000000-0000-0000-0000-000000000001')$$,'42501',null,'an unlinked therapist cannot open the patient');
select is((select count(*)::int from public.sessions where patient_id='73000000-0000-0000-0000-000000000001'),0,'nor read anything');
select set_config('request.jwt.claim.sub','73000000-0000-0000-0000-00000000000d',true);
select throws_ok($$select public.open_colleague_patient('73000000-0000-0000-0000-000000000001')$$,'42501',null,'a request not yet accepted gives nothing');
select set_config('request.jwt.claim.sub','73000000-0000-0000-0000-00000000000e',true);
select throws_ok($$select public.open_colleague_patient('73000000-0000-0000-0000-000000000001')$$,'42501',null,'an ended link gives nothing');
select set_config('request.jwt.claim.sub','73000000-0000-0000-0000-00000000000f',true);
select is(jsonb_array_length(public.colleague_patients()),0,'access is never passed on to a colleague''s colleague');

-- The patient's own therapist sees who has access and when they last looked; the patient turning it off ends it.
select set_config('request.jwt.claim.sub','73000000-0000-0000-0000-00000000000a',true);
select ok((select x->>'last_viewed_at' is not null from jsonb_array_elements(public.patient_colleague_access('73000000-0000-0000-0000-000000000001')->'colleagues') x where x->>'id'='73000000-0000-0000-0000-00000000000b'),'the own therapist sees the colleague and when they looked');
select set_config('request.jwt.claim.sub','73000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.set_colleague_sharing(false)$$,'the patient turns sharing off');
select set_config('request.jwt.claim.sub','73000000-0000-0000-0000-00000000000b',true);
select is((select count(*)::int from public.sessions where patient_id='73000000-0000-0000-0000-000000000001'),0,'and the colleague reads nothing more, even inside the window');

reset role;
select is((select count(*)::int from public.audit_events where action='colleague_viewed' and actor_id='73000000-0000-0000-0000-00000000000b' and target_id='73000000-0000-0000-0000-000000000001'),1,'every colleague open is audited');
select * from finish();
rollback;
