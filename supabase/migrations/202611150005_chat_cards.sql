-- The conversation as a timeline of care (issue #109): shared progress and exercise cards, quiet lines for the daily practice
-- reminder and finished sessions, and messages a therapist schedules to arrive later.
-- Cards and lines are stored as facts, never sentences, so each reader sees them in their own language. A system line is quiet:
-- it counts as nobody's unread message, never notifies, and never becomes the conversation's last line in the list.

-- ---------------------------------------------------------------------------------------------------------------------
-- Whether a conversation can take a new message, judged without a signed-in person, for lines and scheduled messages.

create function public.chat_open_between(p_conversation uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.conversations c
  join public.therapist_patients l on l.therapist_id=c.therapist_id and l.patient_id=c.patient_id and l.active
  join public.profiles t on t.id=c.therapist_id and t.active
  join public.profiles p on p.id=c.patient_id and p.active
  where c.id=p_conversation and exists(select 1 from public.user_roles r where r.user_id=c.therapist_id and r.role='therapist'))
 and public.chat_consented((select patient_id from public.conversations where id=p_conversation))
$$;

-- A line written by the system: no sender, no notification, and it does not move the conversation up the list.
create function public.chat_system_line(p_conversation uuid,p_event text,p_facts jsonb,p_key text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.chat_open_between(p_conversation) then return; end if;
 -- The key makes a job that runs twice add nothing.
 insert into public.chat_messages(id,conversation_id,sender_id,kind,body,data)
 values(extensions.uuid_generate_v5('6ba7b811-9dad-11d1-80b4-00c04fd430c8'::uuid,p_conversation::text||':'||p_event||':'||p_key),p_conversation,null,'system','',
  jsonb_build_object('event',p_event)||coalesce(p_facts,'{}'::jsonb))
 on conflict(id) do nothing;
end $$;

-- The daily reminder and a finished session already make a notification; the same moment adds a line to the conversation it is
-- about. The reminder goes to each therapist with an active plan for the patient, the finished session to the plan's therapist.
-- Turning the reminder off on Profile stops it being made at all, so its line stops too. A failure here never stops the notification.
create function public.chat_line_for_notification() returns trigger language plpgsql security definer set search_path='' as $$
declare c uuid;
begin
 if new.kind='practice_reminder' then
  for c in select v.id from public.conversations v where v.patient_id=new.user_id
    and exists(select 1 from public.exercise_assignments a where a.patient_id=v.patient_id and a.therapist_id=v.therapist_id and a.active) loop
   perform public.chat_system_line(c,'practice_reminder',jsonb_build_object('date',new.data->>'date'),new.id::text);
  end loop;
 elsif new.kind='session_finished' then
  select v.id into c from public.conversations v where v.therapist_id=new.user_id and v.patient_id=new.subject_id;
  if c is not null then
   perform public.chat_system_line(c,'session_finished',jsonb_build_object('completed',new.data->'completed','target',new.data->'target',
    'side',new.data->'side','started_at',new.data->'started_at'),new.id::text);
  end if;
 end if;
 return new;
exception when others then
 raise warning 'chat line skipped: %',sqlerrm;
 return new;
end $$;
create trigger chat_line_for_notification after insert on public.notifications for each row execute function public.chat_line_for_notification();

-- ---------------------------------------------------------------------------------------------------------------------
-- Cards. A progress card is what the Progress page showed when it was shared, with that moment; an exercise card is built here
-- from the plan itself. Either links to a page both people in the conversation can already open, because the conversation is
-- about the one patient both of them see.

create function public.chat_number(p jsonb,p_key text,p_min numeric,p_max numeric,p_optional boolean default false) returns boolean language sql immutable set search_path='' as $$
 select case when p->p_key is null or jsonb_typeof(p->p_key)='null' then p_optional
  else jsonb_typeof(p->p_key)='number' and (p->>p_key)::numeric between p_min and p_max end
$$;

create function public.chat_progress_valid(p jsonb) returns boolean language sql immutable set search_path='' as $$
 select jsonb_typeof(p)='object' and (
  (p->>'scope'='activity' and public.chat_number(p,'week',0,500) and public.chat_number(p,'previous_week',0,500) and public.chat_number(p,'active_days',0,28)
   and public.chat_number(p,'streak',0,28) and public.chat_number(p,'days_since_last',0,28,true))
  or (p->>'scope'='series' and jsonb_typeof(p->'exercise')='string' and char_length(p->>'exercise') between 1 and 120 and p->>'side' in ('left','right','bilateral')
   and public.chat_number(p,'latest',0,360) and public.chat_number(p,'best',0,360) and public.chat_number(p,'change',-360,360,true)
   and public.chat_number(p,'measured',1,10000) and public.chat_number(p,'low',-360,360) and public.chat_number(p,'high',-360,360)))
$$;

-- Shares a progress snapshot. Only its known facts are kept, so nothing else can ride along in a card.
create function public.share_progress(p_id uuid,p_conversation uuid,p_progress jsonb,p_caption text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare stored public.chat_messages; words text:=btrim(coalesce(p_caption,'')); facts jsonb;
begin
 if not public.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 select * into stored from public.chat_messages where id=p_id;
 if found then
  if stored.sender_id is distinct from auth.uid() then raise exception 'chat_invalid'; end if;
  return public.chat_message_json(stored);
 end if;
 if not public.chat_can_send(p_conversation) then
  if public.chat_link_open(p_conversation) then raise exception 'chat_consent_required'; end if;
  raise exception 'chat_closed';
 end if;
 if char_length(words)>2000 or not public.chat_progress_valid(p_progress) then raise exception 'chat_invalid'; end if;
 facts:=(select jsonb_object_agg(key,value) from jsonb_each(p_progress) where key in
  ('scope','week','previous_week','active_days','streak','days_since_last','exercise','side','latest','best','change','measured','low','high'))||jsonb_build_object('as_of',now());
 insert into public.chat_messages(id,conversation_id,sender_id,kind,body,data) values(p_id,p_conversation,auth.uid(),'progress',words,facts) returning * into stored;
 update public.conversations set last_message_at=stored.created_at where id=p_conversation;
 insert into public.chat_reads(conversation_id,user_id,read_at) values(p_conversation,auth.uid(),stored.created_at)
 on conflict(conversation_id,user_id) do update set read_at=excluded.read_at;
 return public.chat_message_json(stored);
end $$;

-- A therapist sends one of the patient's active plans, as it stands now.
create function public.share_exercise(p_id uuid,p_conversation uuid,p_assignment uuid,p_caption text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare stored public.chat_messages; c public.conversations; v public.prescription_versions; definition jsonb; words text:=btrim(coalesce(p_caption,''));
begin
 if not public.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 select * into stored from public.chat_messages where id=p_id;
 if found then
  if stored.sender_id is distinct from auth.uid() then raise exception 'chat_invalid'; end if;
  return public.chat_message_json(stored);
 end if;
 select * into c from public.conversations where id=p_conversation;
 if c.therapist_id is distinct from auth.uid() then raise exception 'Therapist access required' using errcode='42501'; end if;
 if not public.chat_can_send(p_conversation) then
  if public.chat_link_open(p_conversation) then raise exception 'chat_consent_required'; end if;
  raise exception 'chat_closed';
 end if;
 select pv.* into v from public.prescription_versions pv join public.exercise_assignments a on a.id=pv.assignment_id
 where pv.assignment_id=p_assignment and a.patient_id=c.patient_id and a.active order by pv.version desc limit 1;
 if v.id is null or char_length(words)>2000 then raise exception 'chat_invalid'; end if;
 select e.definition into definition from public.exercise_versions e where e.id=v.exercise_version_id;
 insert into public.chat_messages(id,conversation_id,sender_id,kind,body,data)
 values(p_id,p_conversation,auth.uid(),'exercise',words,jsonb_build_object('assignment_id',v.assignment_id,'version',v.version,
  'exercise',coalesce(definition->>'name',''),'side',v.side,'low',v.minimum_degrees,'high',v.maximum_degrees,'repetitions',v.target_repetitions))
 returning * into stored;
 update public.conversations set last_message_at=stored.created_at where id=p_conversation;
 insert into public.chat_reads(conversation_id,user_id,read_at) values(p_conversation,auth.uid(),stored.created_at)
 on conflict(conversation_id,user_id) do update set read_at=excluded.read_at;
 return public.chat_message_json(stored);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Messages a therapist writes now to arrive later, such as a reminder before a session. Each is sent once, by the job below,
-- as long as the conversation can still take it then; otherwise it is dropped and says why.

create table public.chat_scheduled (
 id uuid primary key,
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 sender_id uuid not null references public.profiles(id),
 body text not null check(char_length(body) between 1 and 2000),
 send_at timestamptz not null,
 created_at timestamptz not null default now(),
 sent_at timestamptz, cancelled_at timestamptz, dropped_reason text
);
create index chat_scheduled_due on public.chat_scheduled(send_at) where sent_at is null and cancelled_at is null;
alter table public.chat_scheduled enable row level security;
revoke all on public.chat_scheduled from anon,authenticated;

create function public.schedule_message(p_id uuid,p_conversation uuid,p_body text,p_send_at timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare words text:=btrim(coalesce(p_body,'')); c public.conversations; existing public.chat_scheduled;
begin
 if not public.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 select * into c from public.conversations where id=p_conversation;
 if c.therapist_id is distinct from auth.uid() then raise exception 'Therapist access required' using errcode='42501'; end if;
 select * into existing from public.chat_scheduled where id=p_id;
 if found then
  if existing.sender_id<>auth.uid() then raise exception 'chat_invalid'; end if;
  return jsonb_build_object('id',existing.id,'body',existing.body,'send_at',existing.send_at);
 end if;
 if not public.chat_can_send(p_conversation) then
  if public.chat_link_open(p_conversation) then raise exception 'chat_consent_required'; end if;
  raise exception 'chat_closed';
 end if;
 if words='' or char_length(words)>2000 then raise exception 'chat_invalid'; end if;
 if p_send_at is null or p_send_at<now()+interval '1 minute' or p_send_at>now()+interval '60 days' then raise exception 'chat_schedule_time'; end if;
 if (select count(*) from public.chat_scheduled where sender_id=auth.uid() and sent_at is null and cancelled_at is null)>=50 then raise exception 'chat_rate_limited'; end if;
 insert into public.chat_scheduled(id,conversation_id,sender_id,body,send_at) values(p_id,p_conversation,auth.uid(),words,p_send_at);
 return jsonb_build_object('id',p_id,'body',words,'send_at',p_send_at);
end $$;

create function public.cancel_scheduled_message(p_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
 if not public.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 update public.chat_scheduled set cancelled_at=now() where id=p_id and sender_id=auth.uid() and sent_at is null and cancelled_at is null;
 get diagnostics changed=row_count;
 if changed=0 then raise exception 'chat_schedule_gone'; end if;
 return true;
end $$;

-- What the sender has waiting in one conversation. The other person never sees a message before it arrives.
create function public.my_scheduled_messages(p_conversation uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.chat_can_read(p_conversation) then raise exception 'Conversation unavailable' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'body',s.body,'send_at',s.send_at) order by s.send_at,s.id)
  from public.chat_scheduled s where s.conversation_id=p_conversation and s.sender_id=auth.uid() and s.sent_at is null and s.cancelled_at is null),'[]'::jsonb);
end $$;

-- Sends every message that is due, once. The message keeps its scheduled ID, so the job running twice sends nothing twice.
-- p_now exists for tests; the job always uses the real time.
create function public.send_scheduled_messages(p_now timestamptz default now()) returns integer language plpgsql security definer set search_path='' as $$
declare item public.chat_scheduled; sent integer:=0; stored public.chat_messages;
begin
 for item in select * from public.chat_scheduled where sent_at is null and cancelled_at is null and send_at<=p_now order by send_at,id for update skip locked loop
  if not public.chat_open_between(item.conversation_id) or not exists(select 1 from public.profiles where id=item.sender_id and active) then
   update public.chat_scheduled set cancelled_at=p_now,dropped_reason='The conversation was closed at the time' where id=item.id;
   continue;
  end if;
  insert into public.chat_messages(id,conversation_id,sender_id,kind,body) values(item.id,item.conversation_id,item.sender_id,'text',item.body)
  on conflict(id) do nothing returning * into stored;
  update public.chat_scheduled set sent_at=p_now where id=item.id;
  if stored.id is not null then
   update public.conversations set last_message_at=stored.created_at where id=item.conversation_id;
   sent:=sent+1;
  end if;
 end loop;
 return sent;
end $$;
select cron.schedule('send-scheduled-messages','* * * * *','select public.send_scheduled_messages()');

-- ---------------------------------------------------------------------------------------------------------------------
-- System lines are nobody's unread message and never the line shown for a conversation in the list.

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
   'media',public.chat_media_consented(c.patient_id),
   'muted',exists(select 1 from public.chat_mutes m where m.conversation_id=c.id and m.user_id=auth.uid()),
   'last_message_at',c.last_message_at,
   'last_message',(select public.chat_message_json(m) from public.chat_messages m where m.conversation_id=c.id and m.sender_id is not null order by m.created_at desc,m.id desc limit 1),
   'unread',(select count(*) from public.chat_messages m where m.conversation_id=c.id and m.sender_id is not null and m.sender_id<>auth.uid() and m.deleted_at is null
     and m.created_at>coalesce((select r.read_at from public.chat_reads r where r.conversation_id=c.id and r.user_id=auth.uid()),'-infinity'::timestamptz))
  ) row
  from public.conversations c
  join public.profiles o on o.id=case when c.patient_id=auth.uid() then c.therapist_id else c.patient_id end
  where auth.uid() in (c.therapist_id,c.patient_id) and public.chat_can_read(c.id)
 ) listed),'[]'::jsonb);
end $$;

revoke all on function public.chat_open_between(uuid),public.chat_system_line(uuid,text,jsonb,text),public.chat_line_for_notification(),
 public.chat_number(jsonb,text,numeric,numeric,boolean),public.chat_progress_valid(jsonb),public.share_progress(uuid,uuid,jsonb,text),public.share_exercise(uuid,uuid,uuid,text),
 public.schedule_message(uuid,uuid,text,timestamptz),public.cancel_scheduled_message(uuid),public.my_scheduled_messages(uuid),public.send_scheduled_messages(timestamptz)
 from public,anon,authenticated;
grant execute on function public.share_progress(uuid,uuid,jsonb,text),public.share_exercise(uuid,uuid,uuid,text),
 public.schedule_message(uuid,uuid,text,timestamptz),public.cancel_scheduled_message(uuid),public.my_scheduled_messages(uuid) to authenticated;
