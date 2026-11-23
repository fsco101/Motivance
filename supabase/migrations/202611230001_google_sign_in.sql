-- Google sign-in (#166-#170). Google is one more way to prove who someone is, never a way around the account rules.
--
-- What already holds, and is tested in scripts/test_google_sign_in.py:
-- * Auth links a Google identity to the account that already has the same verified email, so its roles, patients, plans,
--   sessions and messages stay where they are and no second account appears.
-- * A new email arrives with Google's verified address, so on_user_created provisions it at once through provision_account:
--   the patient role and nothing else. Role claims are ignored there, so Google can never create staff.
-- * delete_expired_signups removes only never-confirmed sign-ups. A Google account is confirmed from the start.

-- A sign-up still waiting for its code keeps the details its form sent. If a Google sign-in with the same address confirms it
-- instead, those details and that privacy agreement came from whoever filled in the form, who may not be the person now proving
-- the address. Auth already replaces them with Google's data in that case; this makes sure, and the person finishes their own
-- profile and gives their own agreement.
create or replace function public.on_email_confirmed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from auth.identities i where i.user_id=new.id and i.provider='google') then
  perform public.provision_account(new.id,coalesce(new.raw_user_meta_data,'{}'::jsonb)-'patient_profile');
 else
  perform public.provision_account(new.id,new.raw_user_meta_data);
 end if;
 return new;
end $$;
revoke all on function public.on_email_confirmed() from public,anon,authenticated;

-- How the signed-in person can sign in, for Profile and for the first screen after a Google sign-up.
-- password: whether a password is set; a Google-only account has none, so Profile offers to set one instead of changing it.
-- google: whether a Google account is linked.
-- profile_required: a patient who came through Google has no username or details yet, and finishes them before Home.
--   Staff, who hold the patient role too, and accounts that only ever used a password are never stopped here.
create function public.my_sign_in() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'password',coalesce(u.encrypted_password,'')<>'',
  'google',g.linked,
  'profile_required',g.linked
   and exists(select 1 from public.user_roles r where r.user_id=u.id and r.role='patient')
   and not exists(select 1 from public.user_roles r where r.user_id=u.id and r.role<>'patient')
   and not exists(select 1 from public.patient_profiles p where p.user_id=u.id))
 from auth.users u
 cross join lateral (select exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='google') as linked) g
 where u.id=auth.uid() and public.is_active_user()
$$;
revoke all on function public.my_sign_in() from public,anon;
grant execute on function public.my_sign_in() to authenticated;
