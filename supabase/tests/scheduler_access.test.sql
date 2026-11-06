begin;
create extension if not exists pgtap with schema extensions;
select plan(11);
insert into auth.users(id) values
 ('40000000-0000-0000-0000-000000000001'),('40000000-0000-0000-0000-000000000002'),('40000000-0000-0000-0000-000000000003'),('40000000-0000-0000-0000-000000000004');
insert into public.user_roles values('40000000-0000-0000-0000-000000000002','scheduler'),('40000000-0000-0000-0000-000000000003','admin'),('40000000-0000-0000-0000-000000000004','therapist');
insert into public.therapist_patients(therapist_id,patient_id) values('40000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000001');
insert into public.consents(patient_id,consent_type,version,event) values('40000000-0000-0000-0000-000000000001','movement-summary','movement-summary-v1','granted');

select throws_ok($$insert into public.user_roles values('40000000-0000-0000-0000-000000000001','clerk')$$,'23514',null,'only known roles can be stored');

set local role authenticated;
select set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000002',true);
select is(public.has_role('scheduler'),true,'the role is recognised');
select is(public.can_read_patient('40000000-0000-0000-0000-000000000001'),false,'the role opens no patient record');
select is((select count(*)::integer from public.consents),0,'a Scheduler reads no consents');
select is((select count(*)::integer from public.therapist_patients),0,'a Scheduler reads no care links directly');
select is((select count(*)::integer from public.user_roles),2,'a Scheduler reads only their own roles');
select lives_ok($$select public.scheduler_patients(null,5)$$,'a Scheduler can search patients');

select set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.scheduler_patients(null,5)$$,'42501',null,'an administrator is not a Scheduler');
select throws_ok($$select public.admin_set_role('40000000-0000-0000-0000-000000000003','scheduler',true)$$,'P0001',null,'an administrator cannot change their own roles');

select set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.scheduler_patients(null,5)$$,'42501',null,'a therapist is not a Scheduler');

reset role;
update public.profiles set active=false where id='40000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.scheduler_patients(null,5)$$,'42501',null,'a disabled Scheduler loses access at once');
select * from finish();
rollback;
