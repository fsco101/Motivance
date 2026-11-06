-- Telling someone is a side effect, and it runs inside the change it reports. A recipient can disappear between being listed and being
-- written to, and that must not undo a patient's booking. Nobody is left to tell, so there is nothing to do.
create or replace function public.notify(p_user uuid,p_kind text,p_booking uuid,p_data jsonb,p_event bigint,p_actor uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 -- Nobody needs telling what they have just done themselves.
 if p_user is null or p_user is not distinct from p_actor then return; end if;
 insert into public.notifications(user_id,kind,booking_id,data,dedupe_key) values(p_user,p_kind,p_booking,p_data,p_kind||':'||p_event) on conflict(user_id,dedupe_key) do nothing;
exception when foreign_key_violation then
 return;
end $$;
