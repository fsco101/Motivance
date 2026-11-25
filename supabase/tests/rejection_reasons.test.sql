begin;
create extension if not exists pgtap with schema extensions;
select plan(20);
-- #172: a Scheduler rejects with a common reason (a code), with an optional note, or with their own words ("Other").
insert into auth.users(id,email_confirmed_at) values('72000000-0000-0000-0000-000000000001',now()),('72000000-0000-0000-0000-000000000002',now()),('72000000-0000-0000-0000-000000000003',now());
insert into public.user_roles values('72000000-0000-0000-0000-000000000002','scheduler'),('72000000-0000-0000-0000-000000000003','therapist');
update public.profiles set display_name='Sam Scheduler' where id='72000000-0000-0000-0000-000000000002';
insert into public.bookings(id,reference_no,patient_id,starts_at,ends_at) values
 ('72100000-0000-0000-0000-000000000001','RJ-1','72000000-0000-0000-0000-000000000001','2027-01-04 09:00+08','2027-01-04 10:00+08'),
 ('72100000-0000-0000-0000-000000000002','RJ-2','72000000-0000-0000-0000-000000000001','2027-01-04 11:00+08','2027-01-04 12:00+08'),
 ('72100000-0000-0000-0000-000000000003','RJ-3','72000000-0000-0000-0000-000000000001','2027-01-04 13:00+08','2027-01-04 14:00+08'),
 ('72100000-0000-0000-0000-000000000004','RJ-4','72000000-0000-0000-0000-000000000001','2027-01-04 15:00+08','2027-01-04 16:00+08'),
 ('72100000-0000-0000-0000-000000000005','RJ-5','72000000-0000-0000-0000-000000000001','2027-01-05 09:00+08','2027-01-05 10:00+08'),
 ('72100000-0000-0000-0000-000000000006','RJ-6','72000000-0000-0000-0000-000000000001','2027-01-05 11:00+08','2027-01-05 12:00+08');

-- The helpers the functions use, read as the owner.
select is((select array_agg(c order by c) from unnest(public.rejection_codes()) c),
 array['call_center','duplicate_request','outside_hours','slot_unavailable','therapist_away'],'five common reasons exist');
select is((public.rejection('outside_hours',null,'   ')).note,null,'an empty note is no note');
select is((public.rejection('duplicate_request',null,null)).reason,'duplicate_request','duplicate request is a code');
select is((public.rejection('call_center',null,null)).reason,'call_center','call the center is a code');

set local role authenticated;
select set_config('request.jwt.claim.sub','72000000-0000-0000-0000-000000000002',true);

-- Each common reason is stored as its code.
select is(public.scheduler_reject('72100000-0000-0000-0000-000000000001',p_code=>'slot_unavailable')->>'status_reason','slot_unavailable','a chosen reason is stored as its code');
select is(public.scheduler_reject('72100000-0000-0000-0000-000000000002',p_code=>'therapist_away',p_note=>'  Back on the 12th.  ')->>'status_note','Back on the 12th.','a note goes with a chosen reason, trimmed');
select throws_ok($$select public.scheduler_reject('72100000-0000-0000-0000-000000000003',p_code=>'call_center',p_note=>repeat('x',301))$$,'P0001','booking_note_too_long','a note keeps the 300-character limit');
select lives_ok($$select public.scheduler_reject('72100000-0000-0000-0000-000000000003',p_code=>'call_center',p_note=>repeat('x',300))$$,'a 300-character note is accepted');

-- "Other" keeps the 3-300 rule for the Scheduler's own words, and an older client's call still works as "Other".
select throws_ok($$select public.scheduler_reject('72100000-0000-0000-0000-000000000004',p_reason=>'no',p_code=>'other')$$,'P0001','booking_reason_required','Other needs at least 3 characters');
select throws_ok($$select public.scheduler_reject('72100000-0000-0000-0000-000000000004',p_reason=>repeat('x',301))$$,'P0001','booking_reason_required','Other allows at most 300 characters');
select is(public.scheduler_reject('72100000-0000-0000-0000-000000000004','The room is being repaired.')->>'status_reason','The room is being repaired.','free text is stored as typed');
select is(public.scheduler_booking_detail('72100000-0000-0000-0000-000000000004')->>'status_note',null,'Other carries no separate note');

-- An unknown code is refused, alone and in bulk.
select throws_ok($$select public.scheduler_reject('72100000-0000-0000-0000-000000000005',p_code=>'bad_weather')$$,'P0001','booking_reason_unknown','an unknown code is refused');
select throws_ok($$select public.scheduler_bulk_reject(array['72100000-0000-0000-0000-000000000005'::uuid],p_code=>'bad_weather')$$,'P0001','booking_reason_unknown','bulk refuses an unknown code');
select is(public.scheduler_bulk_reject(array['72100000-0000-0000-0000-000000000005','72100000-0000-0000-0000-000000000006']::uuid[],p_code=>'outside_hours',p_note=>'Open 8 to 5.'),2,'bulk reject takes a code and a note');

-- The patient's notification and the audit trail carry the code, the note and who gave them.
reset role;
select is((select data->>'reason'||'|'||coalesce(data->>'note','') from public.notifications where booking_id='72100000-0000-0000-0000-000000000002' and kind='rejected'),
 'therapist_away|Back on the 12th.','the rejected notification carries the code and note');
select is((select reason||'|'||note||'|'||actor_role from public.booking_events where booking_id='72100000-0000-0000-0000-000000000006' and action='rejected'),
 'outside_hours|Open 8 to 5.|scheduler','the audit trail records the reason, note and who gave them');
set local role authenticated;
select set_config('request.jwt.claim.sub','72000000-0000-0000-0000-000000000002',true);
select is((select e->>'actor_name'||'|'||(e->>'reason')||'|'||(e->>'note') from jsonb_array_elements(public.scheduler_booking_detail('72100000-0000-0000-0000-000000000002')->'events') e where e->>'action'='rejected'),
 'Sam Scheduler|therapist_away|Back on the 12th.','the request detail shows the reason, note and Scheduler');

-- The patient reads the code and note on their own booking.
select set_config('request.jwt.claim.sub','72000000-0000-0000-0000-000000000001',true);
select is((select b->>'status_reason'||'|'||(b->>'status_note') from jsonb_array_elements(public.my_bookings()) b where b->>'reference_no'='RJ-2'),'therapist_away|Back on the 12th.','My bookings shows the code and note');

-- Nobody else can reject.
select set_config('request.jwt.claim.sub','72000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.scheduler_reject('72100000-0000-0000-0000-000000000001',p_code=>'slot_unavailable')$$,'42501',null,'a therapist cannot reject a request');
select * from finish();
rollback;
