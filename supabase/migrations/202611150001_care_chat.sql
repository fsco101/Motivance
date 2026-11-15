-- Care chat: one conversation for each therapist and patient who are linked, delivered live.
-- Access follows the link. While it is active both may read and send. Once it ends nobody can send; the patient keeps reading
-- what was said to them, and the therapist loses access exactly as they lose the patient's records, until the link is restored.
-- Administrators and Schedulers read nothing: there is no rule here that lets them in.

create table public.conversations (
 id uuid primary key default gen_random_uuid(),
 therapist_id uuid not null, patient_id uuid not null,
 created_at timestamptz not null default now(),
 last_message_at timestamptz,
 unique(therapist_id,patient_id),
 -- Links are ended, never deleted, so this only matters when test accounts are cleared away.
 foreign key(therapist_id,patient_id) references public.therapist_patients(therapist_id,patient_id) on delete cascade
);

-- The ID comes from the sender's device, so sending again after a lost reply stores nothing new.
-- A null sender is a note the system wrote, such as a reminder. `data` carries what a kind needs beyond its words.
create table public.chat_messages (
 id uuid primary key,
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 sender_id uuid references public.profiles(id),
 kind text not null check(kind in ('text','attachment','progress','exercise','system')),
 body text not null default '' check(char_length(body)<=2000),
 data jsonb not null default '{}'::jsonb check(jsonb_typeof(data)='object'),
 created_at timestamptz not null default now(),
 deleted_at timestamptz,
 check(sender_id is not null or kind='system')
);
create index chat_messages_page on public.chat_messages(conversation_id,created_at desc,id desc);
create index chat_messages_sender_time on public.chat_messages(sender_id,created_at desc);

-- How far each person has read, which gives the unread count and "seen".
create table public.chat_reads (
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 read_at timestamptz not null default now(),
 primary key(conversation_id,user_id)
);

create function public.chat_can_send(p_conversation uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_active_user() and exists(
  select 1 from public.conversations c
  join public.therapist_patients l on l.therapist_id=c.therapist_id and l.patient_id=c.patient_id and l.active
  join public.profiles t on t.id=c.therapist_id and t.active
  join public.profiles p on p.id=c.patient_id and p.active
  where c.id=p_conversation and auth.uid() in (c.therapist_id,c.patient_id)
   and exists(select 1 from public.user_roles r where r.user_id=c.therapist_id and r.role='therapist'))
$$;

create function public.chat_can_read(p_conversation uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_active_user() and (
  exists(select 1 from public.conversations c where c.id=p_conversation and c.patient_id=auth.uid())
  or public.chat_can_send(p_conversation))
$$;

alter table public.conversations enable row level security;
revoke all on public.conversations from anon,authenticated;

-- Reading goes through the functions below. These two grants exist for live delivery, which checks the same rule row by row.
alter table public.chat_messages enable row level security;
revoke all on public.chat_messages from anon,authenticated;
grant select on public.chat_messages to authenticated;
create policy chat_messages_read on public.chat_messages for select to authenticated using (public.chat_can_read(conversation_id));

alter table public.chat_reads enable row level security;
revoke all on public.chat_reads from anon,authenticated;
grant select on public.chat_reads to authenticated;
create policy chat_reads_read on public.chat_reads for select to authenticated using (public.chat_can_read(conversation_id));

-- Live delivery. A plain Postgres replay has no such publication, so it is made when missing.
do $$ begin
 if not exists(select 1 from pg_publication where pubname='supabase_realtime') then create publication supabase_realtime; end if;
end $$;
alter publication supabase_realtime add table public.chat_messages;
alter publication supabase_realtime add table public.chat_reads;

-- A link that becomes active has a conversation waiting, so either side can write first.
create function public.ensure_conversation() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.active then
  insert into public.conversations(therapist_id,patient_id) values(new.therapist_id,new.patient_id) on conflict(therapist_id,patient_id) do nothing;
 end if;
 return new;
end $$;
create trigger ensure_conversation after insert or update of active on public.therapist_patients for each row execute function public.ensure_conversation();
insert into public.conversations(therapist_id,patient_id) select therapist_id,patient_id from public.therapist_patients where active on conflict do nothing;

-- A message as both apps read it. A deleted message keeps its place in the thread and loses its words.
create function public.chat_message_json(m public.chat_messages) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('id',m.id,'conversation_id',m.conversation_id,'sender_id',m.sender_id,'kind',m.kind,
  'body',case when m.deleted_at is null then m.body else '' end,'data',case when m.deleted_at is null then m.data else '{}'::jsonb end,
  'created_at',m.created_at,'deleted',m.deleted_at is not null)
$$;

-- Every conversation the caller may read, newest activity first, with the other person, the last message and what is unread.
create function public.my_conversations() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(row order by sort_at desc,id) from (
  select c.id,coalesce(c.last_message_at,c.created_at) sort_at,jsonb_build_object(
   'id',c.id,
   'side',case when c.patient_id=auth.uid() then 'patient' else 'therapist' end,
   'other_id',o.id,'other_name',o.display_name,'other_photo',o.photo_url,
   'open',public.chat_can_send(c.id),
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

-- One page of a conversation, newest first, and how far the other person has read. Pass the oldest message on screen to go further back.
create function public.conversation_messages(p_conversation uuid,p_before_at timestamptz default null,p_before_id uuid default null) returns jsonb
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
  'other_read_at',(select r.read_at from public.chat_reads r where r.conversation_id=p_conversation and r.user_id<>auth.uid()));
end $$;

-- A person types far slower than this. It stops a broken or hostile client from flooding the other phone.
create function public.chat_rate_limit() returns integer language sql immutable set search_path='' as $$ select 30 $$;

-- Send words. The same ID again returns the message already stored, so a retry after a lost reply is safe.
create function public.send_message(p_id uuid,p_conversation uuid,p_body text) returns jsonb language plpgsql security definer set search_path='' as $$
declare words text:=btrim(coalesce(p_body,'')); stored public.chat_messages;
begin
 if not public.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_id is null or words='' or char_length(words)>2000 then raise exception 'chat_invalid'; end if;
 select * into stored from public.chat_messages where id=p_id;
 if found then
  if stored.sender_id is distinct from auth.uid() or stored.conversation_id<>p_conversation then raise exception 'chat_invalid'; end if;
  return public.chat_message_json(stored);
 end if;
 -- Checked after the retry above: a message that was sent stays sent, even if the link has ended since.
 if not public.chat_can_send(p_conversation) then raise exception 'chat_closed'; end if;
 if (select count(*) from public.chat_messages where sender_id=auth.uid() and created_at>now()-interval '1 minute')>=public.chat_rate_limit() then
  raise exception 'chat_rate_limited';
 end if;
 insert into public.chat_messages(id,conversation_id,sender_id,kind,body) values(p_id,p_conversation,auth.uid(),'text',words) returning * into stored;
 update public.conversations set last_message_at=stored.created_at where id=p_conversation;
 -- Whoever writes has read everything above it.
 insert into public.chat_reads(conversation_id,user_id,read_at) values(p_conversation,auth.uid(),stored.created_at)
 on conflict(conversation_id,user_id) do update set read_at=excluded.read_at;
 return public.chat_message_json(stored);
exception when unique_violation then
 -- Two copies of one send raced. The other one stored it.
 select * into stored from public.chat_messages where id=p_id and sender_id=auth.uid() and conversation_id=p_conversation;
 if not found then raise exception 'chat_invalid'; end if;
 return public.chat_message_json(stored);
end $$;

-- Reading is allowed after a link ends, so marking as read is too.
create function public.mark_conversation_read(p_conversation uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.chat_can_read(p_conversation) then raise exception 'Conversation unavailable' using errcode='42501'; end if;
 insert into public.chat_reads(conversation_id,user_id,read_at) values(p_conversation,auth.uid(),now())
 on conflict(conversation_id,user_id) do update set read_at=excluded.read_at;
end $$;

-- A message sent by mistake can be taken back for both people for a quarter of an hour. It leaves a mark, so the thread never
-- silently changes under the other reader. There is no editing.
create function public.delete_message(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare stored public.chat_messages;
begin
 if not public.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 select * into stored from public.chat_messages where id=p_id and sender_id=auth.uid() for update;
 if not found then raise exception 'Message unavailable' using errcode='42501'; end if;
 if stored.deleted_at is not null then return public.chat_message_json(stored); end if;
 if stored.created_at<now()-interval '15 minutes' then raise exception 'chat_too_late'; end if;
 update public.chat_messages set deleted_at=now(),body='',data='{}'::jsonb where id=p_id returning * into stored;
 return public.chat_message_json(stored);
end $$;

-- How many messages are waiting across every conversation, for the badge beside Messages.
create function public.my_unread_messages() returns integer language sql stable security definer set search_path='' as $$
 select coalesce(sum((item->>'unread')::integer),0)::integer from jsonb_array_elements(public.my_conversations()) item
$$;

revoke all on function public.chat_can_send(uuid),public.chat_can_read(uuid),public.ensure_conversation(),public.chat_message_json(public.chat_messages),
 public.my_conversations(),public.conversation_messages(uuid,timestamptz,uuid),public.chat_rate_limit(),public.send_message(uuid,uuid,text),
 public.mark_conversation_read(uuid),public.delete_message(uuid),public.my_unread_messages() from public,anon;
grant execute on function public.chat_can_send(uuid),public.chat_can_read(uuid),public.my_conversations(),public.conversation_messages(uuid,timestamptz,uuid),
 public.send_message(uuid,uuid,text),public.mark_conversation_read(uuid),public.delete_message(uuid),public.my_unread_messages() to authenticated;
