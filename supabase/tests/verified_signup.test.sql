begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

-- A sign-up as Auth records it: details in the metadata, a code just sent, nothing confirmed yet. Role claims must be ignored.
insert into auth.users(id,email,raw_user_meta_data,created_at,confirmation_sent_at) values('70000000-0000-0000-0000-000000000001','pending@example.test',
 '{"role":"admin","patient_profile":{"role":"admin","username":"pending_one","first_name":"Ana","last_name":"Cruz","gender":"female","birthdate":"1990-02-14","address":"12 Mabini Street","contact":"+63 912 345 6789","consent":true}}',now(),now());
select is((select count(*)::integer from public.profiles where id='70000000-0000-0000-0000-000000000001'),0,'an unconfirmed sign-up has no Motivance account');
select is((select count(*)::integer from public.user_roles where user_id='70000000-0000-0000-0000-000000000001'),0,'an unconfirmed sign-up has no role');
select is((select count(*)::integer from public.patients where id='70000000-0000-0000-0000-000000000001'),0,'an unconfirmed sign-up is not a patient');
select is((select count(*)::integer from public.patient_profiles where user_id='70000000-0000-0000-0000-000000000001'),0,'an unconfirmed sign-up keeps no personal details');

update auth.users set email_confirmed_at=now() where id='70000000-0000-0000-0000-000000000001';
select is((select string_agg(role,',') from public.user_roles where user_id='70000000-0000-0000-0000-000000000001'),'patient','entering the code makes a patient, and only a patient');
select is((select count(*)::integer from public.patients where id='70000000-0000-0000-0000-000000000001'),1,'the confirmed account is a patient');
select is((select username||','||(consented_at is not null) from public.patient_profiles where user_id='70000000-0000-0000-0000-000000000001'),'pending_one,true','the confirmed account keeps its details and agreement');
select is((select display_name from public.profiles where id='70000000-0000-0000-0000-000000000001'),'Ana Cruz','the confirmed account carries its name');

-- An account an administrator creates already confirmed is ready at once.
insert into auth.users(id,email,created_at,email_confirmed_at) values('70000000-0000-0000-0000-000000000002','staff@example.test',now(),now());
select is((select count(*)::integer from public.profiles where id='70000000-0000-0000-0000-000000000002'),1,'an account created confirmed is ready at once');

-- Sign-up still refuses details a saved profile could not hold, before any code is sent.
select throws_ok($$insert into auth.users(id,email,raw_user_meta_data,created_at,confirmation_sent_at) values('70000000-0000-0000-0000-000000000003','noconsent@example.test',
 '{"patient_profile":{"username":"no_consent","first_name":"Ana","last_name":"Cruz","gender":"female","birthdate":"1990-02-14","address":"12 Mabini Street","contact":"+63 912 345 6789","consent":false}}',now(),now())$$,
 'P0001','Privacy agreement required','sign-up without the agreement is refused');
select throws_ok($$insert into auth.users(id,email,raw_user_meta_data,created_at,confirmation_sent_at) values('70000000-0000-0000-0000-000000000003','badgender@example.test',
 '{"patient_profile":{"username":"bad_gender","first_name":"Ana","last_name":"Cruz","gender":"robot","birthdate":"1990-02-14","address":"12 Mabini Street","contact":"+63 912 345 6789","consent":true}}',now(),now())$$,
 '23514',null,'sign-up applies the table checks a saved profile meets');
select throws_ok($$insert into auth.users(id,email,raw_user_meta_data,created_at,confirmation_sent_at) values('70000000-0000-0000-0000-000000000003','taken@example.test',
 '{"patient_profile":{"username":"PENDING_ONE","first_name":"Ana","last_name":"Cruz","gender":"female","birthdate":"1990-02-14","address":"12 Mabini Street","contact":"+63 912 345 6789","consent":true}}',now(),now())$$,
 '23505',null,'a username in use is refused at sign-up, whatever its case');
select is((select count(*)::integer from public.profiles where id='70000000-0000-0000-0000-000000000003'),0,'a refused sign-up leaves nothing behind');

-- A pending sign-up holds its username while its code still works, and lets it go once the code expires.
insert into auth.users(id,email,raw_user_meta_data,created_at,confirmation_sent_at) values('70000000-0000-0000-0000-000000000004','holder@example.test',
 '{"patient_profile":{"username":"held_name","first_name":"Ana","last_name":"Cruz","gender":"female","birthdate":"1990-02-14","address":"12 Mabini Street","contact":"+63 912 345 6789","consent":true}}',now(),now());
select throws_ok($$insert into auth.users(id,email,raw_user_meta_data,created_at,confirmation_sent_at) values('70000000-0000-0000-0000-000000000005','second@example.test',
 '{"patient_profile":{"username":"Held_Name","first_name":"Ben","last_name":"Reyes","gender":"male","birthdate":"1991-03-15","address":"14 Mabini Street","contact":"+63 912 345 6780","consent":true}}',now(),now())$$,
 '23505',null,'a username held by a pending sign-up is refused');
insert into auth.users(id,email,raw_user_meta_data,created_at,confirmation_sent_at) values('70000000-0000-0000-0000-000000000006','lapsed@example.test',
 '{"patient_profile":{"username":"lapsed_name","first_name":"Ana","last_name":"Cruz","gender":"female","birthdate":"1990-02-14","address":"12 Mabini Street","contact":"+63 912 345 6789","consent":true}}',now()-interval '11 minutes',now()-interval '11 minutes');
select lives_ok($$insert into auth.users(id,email,raw_user_meta_data,created_at,confirmation_sent_at) values('70000000-0000-0000-0000-000000000007','fresh@example.test',
 '{"patient_profile":{"username":"lapsed_name","first_name":"Ben","last_name":"Reyes","gender":"male","birthdate":"1991-03-15","address":"14 Mabini Street","contact":"+63 912 345 6780","consent":true}}',now(),now())$$,
 'a username from an expired sign-up is free again');

-- If someone else takes the username before the code is entered, the code still works and Profile asks for the details.
insert into auth.users(id,email,raw_user_meta_data,created_at,confirmation_sent_at) values('70000000-0000-0000-0000-000000000008','race@example.test',
 '{"patient_profile":{"username":"race_name","first_name":"Ana","last_name":"Cruz","gender":"female","birthdate":"1990-02-14","address":"12 Mabini Street","contact":"+63 912 345 6789","consent":true}}',now(),now());
insert into public.patient_profiles(user_id,username,full_name,first_name,last_name,gender,birthdate,address,contact)
 values('70000000-0000-0000-0000-000000000002','race_name','Staff One','Staff','One','female','1990-01-01','12 Mabini Street','+63 912 345 6789');
select lives_ok($$update auth.users set email_confirmed_at=now() where id='70000000-0000-0000-0000-000000000008'$$,'a username taken in the meantime does not block the code');
select is((select count(*)::integer from public.patients where id='70000000-0000-0000-0000-000000000008'),1,'the account is still made');
select is((select count(*)::integer from public.patient_profiles where user_id='70000000-0000-0000-0000-000000000008'),0,'and its details are left for Profile');

-- An unconfirmed account made before this rule already has records; it is left alone, and confirming it later still works.
insert into auth.users(id,email,created_at,confirmation_sent_at) values('70000000-0000-0000-0000-000000000009','legacy@example.test',now()-interval '2 days',now()-interval '2 days');
insert into public.profiles(id) values('70000000-0000-0000-0000-000000000009');
insert into public.user_roles values('70000000-0000-0000-0000-000000000009','patient');
insert into public.patients(id) values('70000000-0000-0000-0000-000000000009');

-- Clearing: only never-confirmed sign-ups whose code has expired and that own nothing go.
insert into auth.users(id,email,created_at,confirmation_sent_at) values('70000000-0000-0000-0000-000000000010','expired@example.test',now()-interval '11 minutes',now()-interval '11 minutes');
insert into auth.users(id,email,created_at,confirmation_sent_at) values('70000000-0000-0000-0000-000000000011','resent@example.test',now()-interval '1 hour',now()-interval '1 minute');
insert into auth.users(id,email,created_at,invited_at) values('70000000-0000-0000-0000-000000000012','invited@example.test',now()-interval '1 day',now()-interval '1 day');
select public.delete_expired_signups();
select is((select count(*)::integer from auth.users where id in ('70000000-0000-0000-0000-000000000006','70000000-0000-0000-0000-000000000010')),0,'sign-ups whose code expired are deleted');
select is((select count(*)::integer from auth.users where id='70000000-0000-0000-0000-000000000004'),1,'a sign-up whose code still works is kept');
select is((select count(*)::integer from auth.users where id='70000000-0000-0000-0000-000000000011'),1,'a resent code keeps the sign-up for another ten minutes');
select is((select count(*)::integer from auth.users where id in ('70000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000002')),2,'confirmed accounts are never touched');
select is((select count(*)::integer from auth.users where id='70000000-0000-0000-0000-000000000009'),1,'an unconfirmed account with records is left alone');
select is((select count(*)::integer from auth.users where id='70000000-0000-0000-0000-000000000012'),1,'an administrator''s invitation is left alone');

select lives_ok($$update auth.users set email_confirmed_at=now() where id='70000000-0000-0000-0000-000000000009'$$,'an older unconfirmed account can still confirm');
select is((select count(*)::integer from public.user_roles where user_id='70000000-0000-0000-0000-000000000009'),1,'confirming it does not duplicate its role');

select is((select schedule from cron.job where jobname='delete-expired-signups'),'* * * * *','expired sign-ups are cleared every minute');
select is(public.signup_code_lifetime(),interval '10 minutes','a sign-up lives as long as its code');
select ok(not has_function_privilege('authenticated','public.delete_expired_signups()','execute') and not has_function_privilege('anon','public.delete_expired_signups()','execute'),'app users cannot run the clearing');
select ok(not has_function_privilege('authenticated','public.provision_account(uuid,jsonb)','execute') and not has_function_privilege('anon','public.check_signup_details(uuid,jsonb)','execute'),'app users cannot make or check accounts directly');

select * from finish();
rollback;
