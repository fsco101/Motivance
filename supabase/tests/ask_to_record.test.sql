begin;
create extension if not exists pgtap with schema extensions;
select plan(5);
-- #175: whether a patient has ever shared a session video, asked by their own therapist only.
insert into auth.users(id,email_confirmed_at) values('75000000-0000-0000-0000-000000000001',now()),('75000000-0000-0000-0000-000000000002',now()),('75000000-0000-0000-0000-000000000003',now());
insert into public.user_roles values('75000000-0000-0000-0000-000000000002','therapist'),('75000000-0000-0000-0000-000000000003','therapist');
insert into public.therapist_patients(therapist_id,patient_id) values('75000000-0000-0000-0000-000000000002','75000000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub','75000000-0000-0000-0000-000000000002',true);
select is(public.patient_ever_shared_video('75000000-0000-0000-0000-000000000001'),false,'a patient who never shared a video');

reset role;
-- Fixture only: the video's session is not needed for this answer, so foreign keys are skipped for this one row.
set local session_replication_role=replica;
insert into public.session_videos(id,session_id,patient_id,therapist_id,width,height,duration_ms,media_path,preview_path,shared_at,expires_at,removed_at)
 values(gen_random_uuid(),gen_random_uuid(),'75000000-0000-0000-0000-000000000001','75000000-0000-0000-0000-000000000002',480,270,1000,'p/a.mp4','p/a.jpg',now()-interval '20 days',now()-interval '5 days',now()-interval '5 days');
set local session_replication_role=origin;
set local role authenticated;
select set_config('request.jwt.claim.sub','75000000-0000-0000-0000-000000000002',true);
select is(public.patient_ever_shared_video('75000000-0000-0000-0000-000000000001'),true,'an expired shared video still counts');

select set_config('request.jwt.claim.sub','75000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.patient_ever_shared_video('75000000-0000-0000-0000-000000000001')$$,'42501',null,'another therapist cannot ask');
select set_config('request.jwt.claim.sub','75000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.patient_ever_shared_video('75000000-0000-0000-0000-000000000001')$$,'42501',null,'the patient is not asked through this');
set local role anon;
select throws_ok($$select public.patient_ever_shared_video('75000000-0000-0000-0000-000000000001')$$,'42501',null,'nobody signed out can ask');
select * from finish();
rollback;
