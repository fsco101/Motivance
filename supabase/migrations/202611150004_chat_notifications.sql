-- New-message notifications for care chat (issue #110). They ride the same table and queue as every other notification, so
-- the bell, push, retries and dead-phone cleanup come with them. They never send email, and never carry the message's words:
-- only who it is from and which conversation, so a lock screen or a shared phone gives nothing away.
-- A burst is one notification: nothing new is made while the last one for that conversation is unread and recent, and nothing
-- at all while the person is in the conversation reading along. Reading a conversation marks its notifications read.
-- Each person can mute one conversation; that stops push for it, and leaves the bell and unread counts as they are.

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check(kind in (
 'confirmed','rejected','cancelled','rescheduled','therapist_changed','returned_to_pending',
 'session_assigned','session_moved','session_cancelled','session_removed',
 'request_received','patient_cancelled','needs_therapist','reminder','session_reminder','place_open','patient_rescheduled',
 'series_booked','series_assigned','series_cancelled','session_series_cancelled',
 'plan_updated','session_finished','practice_reminder','patient_inactive','care_linked','care_unlinked','patient_linked','patient_unlinked',
 'chat_message'));

create or replace function public.notification_group(p_kind text) returns text language sql immutable set search_path='' as $$
 select case p_kind
  when 'plan_updated' then 'exercise_plan'
  when 'session_finished' then 'session_results'
  when 'patient_inactive' then 'inactivity'
  when 'practice_reminder' then 'practice'
  when 'care_linked' then 'care_team' when 'care_unlinked' then 'care_team' when 'patient_linked' then 'care_team' when 'patient_unlinked' then 'care_team'
  when 'chat_message' then 'messages'
  else 'bookings' end
$$;

alter table public.notification_settings add column messages boolean not null default true;

create or replace function public.my_notification_settings() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.notification_settings;
begin
 if not public.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 select * into s from public.notification_settings where user_id=auth.uid();
 return jsonb_build_object('bookings',coalesce(s.bookings,true),'exercise_plan',coalesce(s.exercise_plan,true),'session_results',coalesce(s.session_results,true),
  'inactivity',coalesce(s.inactivity,true),'care_team',coalesce(s.care_team,true),'messages',coalesce(s.messages,true),'reminder_time',to_char(s.reminder_time,'HH24:MI'));
end $$;

-- The same as before with one more switch. An app that does not send it leaves it as it was, so an older build cannot reset it.
drop function public.save_notification_settings(boolean,boolean,boolean,boolean,boolean,text);
create function public.save_notification_settings(p_bookings boolean,p_exercise_plan boolean,p_session_results boolean,p_inactivity boolean,p_care_team boolean,
 p_reminder_time text default null,p_messages boolean default null) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.is_active_user() then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_bookings is null or p_exercise_plan is null or p_session_results is null or p_inactivity is null or p_care_team is null
 or (p_reminder_time is not null and p_reminder_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then raise exception 'booking_invalid'; end if;
 insert into public.notification_settings(user_id,bookings,exercise_plan,session_results,inactivity,care_team,reminder_time,messages,updated_at)
 values(auth.uid(),p_bookings,p_exercise_plan,p_session_results,p_inactivity,p_care_team,p_reminder_time::time,coalesce(p_messages,true),now())
 on conflict(user_id) do update set bookings=excluded.bookings,exercise_plan=excluded.exercise_plan,session_results=excluded.session_results,
  inactivity=excluded.inactivity,care_team=excluded.care_team,reminder_time=excluded.reminder_time,
  messages=coalesce(p_messages,public.notification_settings.messages),updated_at=now();
 return public.my_notification_settings();
end $$;

-- Muting is each person's own business, so it is kept apart from anything the other person can read.
create table public.chat_mutes (
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 muted_at timestamptz not null default now(),
 primary key(conversation_id,user_id)
);
alter table public.chat_mutes enable row level security;
revoke all on public.chat_mutes from anon,authenticated;

create function public.set_conversation_muted(p_conversation uuid,p_muted boolean) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not public.chat_can_read(p_conversation) then raise exception 'Conversation unavailable' using errcode='42501'; end if;
 if p_muted then insert into public.chat_mutes(conversation_id,user_id) values(p_conversation,auth.uid()) on conflict do nothing;
 else delete from public.chat_mutes where conversation_id=p_conversation and user_id=auth.uid(); end if;
 return p_muted;
end $$;

-- Push for everything but bookings' email, as before, and now the messages switch and a muted conversation as well.
create or replace function public.queue_notification_email() returns trigger language plpgsql security definer set search_path='' as $$
declare kind_group text:=public.notification_group(new.kind); s public.notification_settings; allowed boolean; muted boolean:=false;
begin
 if kind_group='bookings' then
  insert into public.notification_deliveries(notification_id,channel) values(new.id,'email') on conflict do nothing;
 end if;
 select * into s from public.notification_settings where user_id=new.user_id;
 if kind_group='messages' then
  muted:=exists(select 1 from public.chat_mutes m where m.user_id=new.user_id and m.conversation_id::text=new.data->>'conversation_id');
 end if;
 allowed:=case kind_group when 'bookings' then coalesce(s.bookings,true) when 'exercise_plan' then coalesce(s.exercise_plan,true)
  when 'session_results' then coalesce(s.session_results,true) when 'inactivity' then coalesce(s.inactivity,true) when 'care_team' then coalesce(s.care_team,true)
  when 'messages' then coalesce(s.messages,true) and not muted else true end;
 if allowed then
  insert into public.notification_deliveries(notification_id,channel) values(new.id,'push') on conflict do nothing;
 else
  insert into public.notification_deliveries(notification_id,channel,status,last_error) values(new.id,'push','skipped',case when muted then 'Muted' else 'Turned off' end) on conflict do nothing;
 end if;
 return new;
end $$;

-- How long one notification stands for a burst, and how recently someone must have read to count as reading along.
create function public.chat_notice_window() returns interval language sql immutable set search_path='' as $$ select interval '10 minutes' $$;
create function public.chat_reading_window() returns interval language sql immutable set search_path='' as $$ select interval '2 minutes' $$;

-- A message from one person tells the other, unless they are reading along or already have an unread notice for this conversation.
-- A notification is never allowed to stop the message that caused it, so a failure here is only logged.
create function public.notify_chat_message() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.conversations; recipient uuid;
begin
 if new.sender_id is null or new.kind not in ('text','attachment') then return new; end if;
 select * into c from public.conversations where id=new.conversation_id;
 recipient:=case when new.sender_id=c.therapist_id then c.patient_id else c.therapist_id end;
 if exists(select 1 from public.chat_reads r where r.conversation_id=c.id and r.user_id=recipient and r.read_at>now()-public.chat_reading_window()) then return new; end if;
 if exists(select 1 from public.notifications n where n.user_id=recipient and n.kind='chat_message' and n.read_at is null
   and n.data->>'conversation_id'=c.id::text and n.created_at>now()-public.chat_notice_window()) then return new; end if;
 perform public.notify_person(recipient,'chat_message',new.sender_id,jsonb_build_object('conversation_id',c.id,'sender_name',public.person_name(new.sender_id)),
  new.id::text,new.sender_id);
 return new;
exception when others then
 raise warning 'chat_message notification skipped: %',sqlerrm;
 return new;
end $$;
create trigger notify_chat_message after insert on public.chat_messages for each row execute function public.notify_chat_message();

-- Reading a conversation also reads its notifications, so the bell never says there is something new that has been seen.
create or replace function public.mark_conversation_read(p_conversation uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.chat_can_read(p_conversation) then raise exception 'Conversation unavailable' using errcode='42501'; end if;
 insert into public.chat_reads(conversation_id,user_id,read_at) values(p_conversation,auth.uid(),now())
 on conflict(conversation_id,user_id) do update set read_at=excluded.read_at;
 update public.notifications set read_at=now() where user_id=auth.uid() and kind='chat_message' and read_at is null and data->>'conversation_id'=p_conversation::text;
end $$;

-- As before, with whether the reader has muted each conversation.
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
   'last_message',(select public.chat_message_json(m) from public.chat_messages m where m.conversation_id=c.id order by m.created_at desc,m.id desc limit 1),
   'unread',(select count(*) from public.chat_messages m where m.conversation_id=c.id and m.sender_id is distinct from auth.uid() and m.deleted_at is null
     and m.created_at>coalesce((select r.read_at from public.chat_reads r where r.conversation_id=c.id and r.user_id=auth.uid()),'-infinity'::timestamptz))
  ) row
  from public.conversations c
  join public.profiles o on o.id=case when c.patient_id=auth.uid() then c.therapist_id else c.patient_id end
  where auth.uid() in (c.therapist_id,c.patient_id) and public.chat_can_read(c.id)
 ) listed),'[]'::jsonb);
end $$;

revoke all on function public.save_notification_settings(boolean,boolean,boolean,boolean,boolean,text,boolean),public.set_conversation_muted(uuid,boolean),
 public.chat_notice_window(),public.chat_reading_window(),public.notify_chat_message() from public,anon,authenticated;
grant execute on function public.save_notification_settings(boolean,boolean,boolean,boolean,boolean,text,boolean),public.set_conversation_muted(uuid,boolean) to authenticated;
