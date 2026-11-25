-- #175: a therapist may ask a patient to record their sessions when that patient has never shared a video with them.
-- Expired and stopped videos keep their row (removed_at), so "never" stays true to what happened. Only the patient's own
-- therapist may ask, and the answer says nothing else about the videos.
create function public.patient_ever_shared_video(p_patient uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if not public.can_prescribe(p_patient) then raise exception 'Therapist access required' using errcode='42501'; end if;
 return exists(select 1 from public.session_videos where patient_id=p_patient and shared_at is not null);
end $$;

revoke all on function public.patient_ever_shared_video(uuid) from public,anon;
grant execute on function public.patient_ever_shared_video(uuid) to authenticated;
