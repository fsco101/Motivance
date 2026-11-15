-- Care chat needs the patient's own agreement before anyone can write (issue #111). It is separate from the account agreement
-- and from the movement-summary grant, versioned, and recorded in `consents` like them, so it is audited the same way.
-- A therapist needs no agreement here: a conversation exists only with a patient who chose it.
-- Turning messages off stops new messages both ways. What was said stays in the patient's record, readable as before.
-- This version covers words only. Photos and video will need a new version, accepted before either can be sent (#106).

create function public.chat_consent_version() returns text language sql immutable set search_path='' as $$ select 'care-chat-v1' $$;

-- The patient's latest answer to the current version. No answer means not yet.
create function public.chat_consented(p_patient uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select c.event='granted' from public.consents c
  where c.patient_id=p_patient and c.consent_type='care-chat' and c.version=public.chat_consent_version()
  order by c.occurred_at desc,c.recorded_at desc,c.id desc limit 1),false)
$$;

-- Everything sending needs except the patient's agreement, so a refusal can say which one is missing.
create function public.chat_link_open(p_conversation uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_active_user() and exists(
  select 1 from public.conversations c
  join public.therapist_patients l on l.therapist_id=c.therapist_id and l.patient_id=c.patient_id and l.active
  join public.profiles t on t.id=c.therapist_id and t.active
  join public.profiles p on p.id=c.patient_id and p.active
  where c.id=p_conversation and auth.uid() in (c.therapist_id,c.patient_id)
   and exists(select 1 from public.user_roles r where r.user_id=c.therapist_id and r.role='therapist'))
$$;

create or replace function public.chat_can_send(p_conversation uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.chat_link_open(p_conversation)
  and public.chat_consented((select c.patient_id from public.conversations c where c.id=p_conversation))
$$;

-- Reading never needed the agreement for the patient, and the therapist reads whatever was said while the link is open.
create or replace function public.chat_can_read(p_conversation uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_active_user() and (
  exists(select 1 from public.conversations c where c.id=p_conversation and c.patient_id=auth.uid())
  or public.chat_link_open(p_conversation))
$$;

-- The patient's answer, for their own screens.
create function public.my_chat_consent() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare latest public.consents;
begin
 if not public.has_role('patient') then raise exception 'Patient access required' using errcode='42501'; end if;
 select * into latest from public.consents where patient_id=auth.uid() and consent_type='care-chat' and version=public.chat_consent_version()
  order by occurred_at desc,recorded_at desc,id desc limit 1;
 return jsonb_build_object('version',public.chat_consent_version(),'granted',coalesce(latest.event='granted',false),'at',latest.occurred_at);
end $$;

-- Turning messages on or off. The same answer twice records nothing, so a double tap is harmless.
create function public.set_chat_consent(p_granted boolean) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.has_role('patient') then raise exception 'Patient access required' using errcode='42501'; end if;
 if p_granted is null then raise exception 'chat_invalid'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text,11));
 if public.chat_consented(auth.uid()) is distinct from p_granted then
  insert into public.consents(patient_id,consent_type,version,event,client_event_id,occurred_at)
  values(auth.uid(),'care-chat',public.chat_consent_version(),case when p_granted then 'granted' else 'withdrawn' end,gen_random_uuid(),now());
 end if;
 return public.my_chat_consent();
end $$;

-- As before, with whether the patient has turned messages on. `open` already includes it.
create or replace function public.my_conversations() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(row order by sort_at desc,id) from (
  select c.id,coalesce(c.last_message_at,c.created_at) sort_at,jsonb_build_object(
   'id',c.id,
   'side',case when c.patient_id=auth.uid() then 'patient' else 'therapist' end,
   'other_id',o.id,'other_name',o.display_name,'other_photo',o.photo_url,
   'open',public.chat_can_send(c.id),
   'consented',public.chat_consented(c.patient_id),
   'last_message_at',c.last_message_at,
   'last_message',(select public.chat_message_json(m) from public.chat_messages m where m.conversation_id=c.id order by m.created_at desc,m.id desc limit 1),
   'unread',(select count(*) from public.chat_messages m where m.conversation_id=c.id and m.sender_id is distinct from auth.uid() and m.deleted_at is null
     and m.created_at>coalesce((select r.read_at from public.chat_reads r where r.conversation_id=c.id and r.user_id=auth.uid()),'-infinity'::timestamptz))
  ) row
  from public.conversations c
  join public.profiles o on o.id=case when c.patient_id=auth.uid() then c.therapist_id else c.patient_id end
  where auth.uid() in (c.therapist_id,c.patient_id) and public.chat_can_read(c.id)
 ) listed),'[]'::jsonb);
end $$;

create or replace function public.conversation_messages(p_conversation uuid,p_before_at timestamptz default null,p_before_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare page constant integer:=50; found jsonb; total integer;
begin
 if not public.chat_can_read(p_conversation) then raise exception 'Conversation unavailable' using errcode='42501'; end if;
 select coalesce(jsonb_agg(public.chat_message_json(m) order by m.created_at desc,m.id desc),'[]'::jsonb),count(*) into found,total from (
  select * from public.chat_messages m where m.conversation_id=p_conversation
   and (p_before_at is null or (m.created_at,m.id)<(p_before_at,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
  order by m.created_at desc,m.id desc limit page+1) m;
 return jsonb_build_object(
  'messages',case when total>page then found-page else found end,
  'more',total>page,
  'open',public.chat_can_send(p_conversation),
  'consented',public.chat_consented((select c.patient_id from public.conversations c where c.id=p_conversation)),
  'other_read_at',(select r.read_at from public.chat_reads r where r.conversation_id=p_conversation and r.user_id<>auth.uid()));
end $$;

-- As before, with its own refusal when only the patient's agreement is missing.
create or replace function public.send_message(p_id uuid,p_conversation uuid,p_body text) returns jsonb language plpgsql security definer set search_path='' as $$
declare words text:=btrim(coalesce(p_body,'')); stored public.chat_messages;
begin
 if not public.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_id is null or words='' or char_length(words)>2000 then raise exception 'chat_invalid'; end if;
 select * into stored from public.chat_messages where id=p_id;
 if found then
  if stored.sender_id is distinct from auth.uid() or stored.conversation_id<>p_conversation then raise exception 'chat_invalid'; end if;
  return public.chat_message_json(stored);
 end if;
 if not public.chat_can_send(p_conversation) then
  if public.chat_link_open(p_conversation) then raise exception 'chat_consent_required'; end if;
  raise exception 'chat_closed';
 end if;
 if (select count(*) from public.chat_messages where sender_id=auth.uid() and created_at>now()-interval '1 minute')>=public.chat_rate_limit() then
  raise exception 'chat_rate_limited';
 end if;
 insert into public.chat_messages(id,conversation_id,sender_id,kind,body) values(p_id,p_conversation,auth.uid(),'text',words) returning * into stored;
 update public.conversations set last_message_at=stored.created_at where id=p_conversation;
 insert into public.chat_reads(conversation_id,user_id,read_at) values(p_conversation,auth.uid(),stored.created_at)
 on conflict(conversation_id,user_id) do update set read_at=excluded.read_at;
 return public.chat_message_json(stored);
exception when unique_violation then
 select * into stored from public.chat_messages where id=p_id and sender_id=auth.uid() and conversation_id=p_conversation;
 if not found then raise exception 'chat_invalid'; end if;
 return public.chat_message_json(stored);
end $$;

-- For the trusted operator answering an export request (DATA-LIFECYCLE.md). Every conversation the patient has had, with whom,
-- every message in order, and their chat agreement history. A taken-back message appears only as having been deleted.
-- Never granted to an app role: it runs with the service key in the protected administrative environment.
create function public.export_patient_chat(p_patient uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'patient_id',p_patient,
  'exported_at',now(),
  'agreement',coalesce((select jsonb_agg(jsonb_build_object('version',c.version,'event',c.event,'at',c.occurred_at) order by c.occurred_at,c.recorded_at)
    from public.consents c where c.patient_id=p_patient and c.consent_type='care-chat'),'[]'::jsonb),
  'conversations',coalesce((select jsonb_agg(jsonb_build_object(
    'therapist_id',v.therapist_id,'therapist_name',(select display_name from public.profiles where id=v.therapist_id),'started_at',v.created_at,
    'messages',coalesce((select jsonb_agg(jsonb_build_object(
      'at',m.created_at,
      'from',case when m.sender_id is null then 'system' when m.sender_id=p_patient then 'patient' else 'therapist' end,
      'kind',m.kind,'deleted',m.deleted_at is not null,
      'text',case when m.deleted_at is null then m.body else '' end) order by m.created_at,m.id)
     from public.chat_messages m where m.conversation_id=v.id),'[]'::jsonb)) order by v.created_at)
   from public.conversations v where v.patient_id=p_patient),'[]'::jsonb))
$$;

-- For the trusted operator answering a deletion request, once it has been reviewed. It refuses unless the patient has an open
-- deletion request, removes every message and read mark in the patient's conversations, records that it did so in the audit trail,
-- and leaves an empty conversation for any link still active. Returns how many messages were removed.
create function public.erase_patient_chat(p_patient uuid) returns integer language plpgsql security definer set search_path='' as $$
declare removed integer;
begin
 if not exists(select 1 from public.data_requests where patient_id=p_patient and kind='delete' and status='requested') then
  raise exception 'No open deletion request for this patient';
 end if;
 select count(*) into removed from public.chat_messages m join public.conversations c on c.id=m.conversation_id where c.patient_id=p_patient;
 delete from public.conversations where patient_id=p_patient;
 insert into public.conversations(therapist_id,patient_id) select therapist_id,patient_id from public.therapist_patients where patient_id=p_patient and active
 on conflict(therapist_id,patient_id) do nothing;
 insert into public.audit_events(actor_id,action,target_type,target_id) values(auth.uid(),'erase','chat_messages',p_patient::text);
 return removed;
end $$;

revoke all on function public.chat_consent_version(),public.chat_consented(uuid),public.chat_link_open(uuid),public.my_chat_consent(),public.set_chat_consent(boolean),
 public.export_patient_chat(uuid),public.erase_patient_chat(uuid) from public,anon,authenticated;
grant execute on function public.chat_consented(uuid),public.chat_link_open(uuid),public.my_chat_consent(),public.set_chat_consent(boolean) to authenticated;
grant execute on function public.export_patient_chat(uuid),public.erase_patient_chat(uuid) to service_role;
