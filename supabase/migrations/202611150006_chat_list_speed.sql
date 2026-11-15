-- Care chat #112: the conversation list for a therapist with a large caseload.
--
-- The load check found my_conversations spending over 1 ms a conversation in chat_can_read and chat_can_send: they are
-- security-definer functions, so Postgres cannot inline them, and each nests further calls. With 150 patients that was
-- over half a second. The list now works out "the link is open" once per row in a join, by the same rule as
-- chat_link_open (an active link, both accounts active, the therapist still a therapist), after checking the reader once.
-- The answer is the same as before: readable is the patient's own conversation or an open link; open is an open link
-- with the patient's agreement. tests/contract/chat-load.test.ts checks the two agree for every conversation.

create or replace function public.my_conversations() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid := auth.uid();
begin
 if not public.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(row order by sort_at desc,id) from (
  select c.id,coalesce(c.last_message_at,c.created_at) sort_at,jsonb_build_object(
   'id',c.id,
   'side',case when c.patient_id=me then 'patient' else 'therapist' end,
   'other_id',o.id,'other_name',o.display_name,'other_photo',o.photo_url,
   'open',linked.open and public.chat_consented(c.patient_id),
   'consented',public.chat_consented(c.patient_id),
   'media',public.chat_media_consented(c.patient_id),
   'muted',exists(select 1 from public.chat_mutes m where m.conversation_id=c.id and m.user_id=me),
   'last_message_at',c.last_message_at,
   'last_message',(select public.chat_message_json(m) from public.chat_messages m where m.conversation_id=c.id and m.sender_id is not null order by m.created_at desc,m.id desc limit 1),
   'unread',(select count(*) from public.chat_messages m where m.conversation_id=c.id and m.sender_id is not null and m.sender_id<>me and m.deleted_at is null
     and m.created_at>coalesce((select r.read_at from public.chat_reads r where r.conversation_id=c.id and r.user_id=me),'-infinity'::timestamptz))
  ) row
  from public.conversations c
  join public.profiles o on o.id=case when c.patient_id=me then c.therapist_id else c.patient_id end
  cross join lateral (select exists(
    select 1 from public.therapist_patients l
    join public.profiles t on t.id=l.therapist_id and t.active
    join public.profiles p on p.id=l.patient_id and p.active
    where l.therapist_id=c.therapist_id and l.patient_id=c.patient_id and l.active
     and exists(select 1 from public.user_roles r where r.user_id=c.therapist_id and r.role='therapist')) open) linked
  where me in (c.therapist_id,c.patient_id) and (c.patient_id=me or linked.open)
 ) listed),'[]'::jsonb);
end $$;
