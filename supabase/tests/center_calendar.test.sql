begin;
create extension if not exists pgtap with schema extensions;
select plan(25);
insert into auth.users(id) values('50000000-0000-0000-0000-000000000001'),('50000000-0000-0000-0000-000000000002');
insert into public.user_roles values('50000000-0000-0000-0000-000000000002','scheduler');

-- Seeds.
select is((select slot_minutes from public.center_settings),60,'slots default to an hour');
select is((select slot_capacity from public.center_settings),3,'capacity defaults to three');
select is((select cancel_cutoff_hours from public.center_settings),24,'cancellation defaults to 24 hours');
select is((select count(*)::integer from public.center_hours where is_open),5,'five working days are seeded');
select is((select count(*)::integer from public.center_hours where is_open and weekday>5),0,'weekends are closed by default');
select is((select count(*)::integer from public.center_holidays where source='seed' and extract(year from starts_on)=2026),18,'all 2026 proclaimed holidays are seeded');
select is((select count(*)::integer from public.center_holidays where source='seed' and extract(year from starts_on)=2027),18,'all 2027 proclaimed holidays are seeded');
select is((select count(*)::integer from public.center_holidays where to_char(starts_on,'MM-DD')='02-25'),0,'February 25 is a special working day, so it is not closed');

-- The center's own rules, at fixed dates. The zone below proves the answers do not depend on the session's zone.
set local timezone='America/New_York';
select is(public.center_problem('2026-12-07 09:00+08','2026-12-07 10:00+08'),null,'a working Monday at nine in Manila is open');
select is(public.center_problem('2026-12-07 01:00+00','2026-12-07 02:00+00'),null,'the same slot written in UTC is open');
select is(public.center_problem('2026-12-05 09:00+08','2026-12-05 10:00+08'),'closed_day','Saturday is closed');
select is(public.center_problem('2026-12-06 09:00+08','2026-12-06 10:00+08'),'closed_day','Sunday is closed');
select is(public.center_problem('2026-12-07 08:00+08','2026-12-07 09:00+08'),'outside_hours','before opening is refused');
select is(public.center_problem('2026-12-07 16:30+08','2026-12-07 17:30+08'),'outside_hours','running past closing is refused');
select is(public.center_problem('2026-11-30 09:00+08','2026-11-30 10:00+08'),'holiday','a national holiday is closed');
select is(public.center_problem('2026-11-30 01:00+00','2026-11-30 02:00+00'),'holiday','the holiday follows Manila time, though it is still November 29 in this session');

insert into public.center_holidays(name,kind,starts_on,ends_on) values('Year-end break','seasonal','2026-12-14','2026-12-18');
select is(public.center_problem('2026-12-16 09:00+08','2026-12-16 10:00+08'),'holiday','every day of a seasonal break is closed');

insert into public.center_closures(starts_at,ends_at,reason) values('2026-12-09 13:00+08','2026-12-09 15:00+08','Staff training');
select is(public.center_problem('2026-12-09 13:30+08','2026-12-09 14:30+08'),'closure','a closure blocks what it overlaps');
select is(public.center_problem('2026-12-09 12:00+08','2026-12-09 13:00+08'),null,'the slot before a closure stays open');
select is(public.center_problem('2026-12-09 15:00+08','2026-12-09 16:00+08'),null,'the slot after a closure stays open');
reset timezone;

-- Who can see what.
set local role authenticated;
select set_config('request.jwt.claim.sub','50000000-0000-0000-0000-000000000001',true);
select is((select count(*)::integer from public.center_hours),7,'patients read the hours');
select is((select count(*)::integer from public.center_closures),0,'patients do not read closure reasons');
select throws_ok($$update public.center_settings set slot_capacity=99$$,'42501',null,'clients cannot change settings');
select throws_ok($$insert into public.center_holidays(name,kind,starts_on,ends_on) values('x','regular','2026-12-20','2026-12-20')$$,'42501',null,'clients cannot add holidays');
select set_config('request.jwt.claim.sub','50000000-0000-0000-0000-000000000002',true);
select is((select count(*)::integer from public.center_closures),1,'Schedulers read closures');
select * from finish();
rollback;
