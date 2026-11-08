begin;
create extension if not exists pgtap with schema extensions;
select plan(15);
-- Confirmed accounts: Motivance makes an account only once its email is confirmed.
insert into auth.users(id,email_confirmed_at) values('60000000-0000-0000-0000-000000000001',now()),('60000000-0000-0000-0000-000000000002',now()),('60000000-0000-0000-0000-000000000003',now());
insert into public.user_roles values('60000000-0000-0000-0000-000000000003','therapist');
insert into public.bookings(id,reference_no,patient_id,therapist_id,starts_at,ends_at,status) values
 ('61000000-0000-0000-0000-000000000001','BK-A','60000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000003','2026-12-07 09:00+08','2026-12-07 10:00+08','confirmed');

select throws_ok($$insert into public.bookings(reference_no,patient_id,starts_at,ends_at) values('BK-B','60000000-0000-0000-0000-000000000001','2026-12-07 09:30+08','2026-12-07 10:30+08')$$,'23P01',null,'one patient cannot hold overlapping bookings');
select lives_ok($$insert into public.bookings(reference_no,patient_id,starts_at,ends_at) values('BK-C','60000000-0000-0000-0000-000000000001','2026-12-07 10:00+08','2026-12-07 11:00+08')$$,'back-to-back bookings do not overlap');
select throws_ok($$insert into public.bookings(reference_no,patient_id,therapist_id,starts_at,ends_at) values('BK-D','60000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000003','2026-12-07 09:30+08','2026-12-07 10:30+08')$$,'23P01',null,'one therapist cannot hold overlapping bookings');
select lives_ok($$insert into public.bookings(reference_no,patient_id,therapist_id,starts_at,ends_at,status) values('BK-E','60000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000003','2026-12-07 09:00+08','2026-12-07 10:00+08','cancelled')$$,'a cancelled booking blocks nobody');
select throws_ok($$insert into public.bookings(reference_no,patient_id,starts_at,ends_at) values('BK-F','60000000-0000-0000-0000-000000000002','2026-12-08 10:00+08','2026-12-08 09:00+08')$$,'23514',null,'a booking must end after it starts');
select throws_ok($$insert into public.bookings(reference_no,patient_id,starts_at,ends_at,status) values('BK-G','60000000-0000-0000-0000-000000000002','2026-12-08 09:00+08','2026-12-08 10:00+08','maybe')$$,'23514',null,'only known statuses can be stored');

select is(public.slot_load('2026-12-07 09:00+08','2026-12-07 10:00+08'),1,'capacity counts active bookings only');
select is(public.slot_on_grid('2026-12-07 09:00+08'),true,'an hour from opening is on the grid');
select is(public.slot_on_grid('2026-12-07 09:30+08'),false,'half past is not, with hourly slots');

select is((select action||'/'||actor_role from public.booking_events where booking_id='61000000-0000-0000-0000-000000000001'),'requested/system','a change with no signed-in user is recorded as the system');
update public.bookings set status='cancelled',status_reason='Testing' where id='61000000-0000-0000-0000-000000000001';
select is((select count(*)::integer from public.booking_events where booking_id='61000000-0000-0000-0000-000000000001'),2,'each change adds an event');
select is((select from_status||'>'||to_status from public.booking_events where booking_id='61000000-0000-0000-0000-000000000001' order by id desc limit 1),'confirmed>cancelled','the event records both statuses');
select throws_ok($$delete from public.booking_events$$,'P0001',null,'events cannot be deleted');

set local role authenticated;
select set_config('request.jwt.claim.sub','60000000-0000-0000-0000-000000000001',true);
select throws_ok($$select * from public.bookings$$,'42501',null,'clients cannot read bookings directly');
select throws_ok($$select * from public.booking_events$$,'42501',null,'clients cannot read the audit trail directly');
select * from finish();
rollback;
