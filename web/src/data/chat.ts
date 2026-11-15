import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

export const CHAT_BODY_LIMIT = 2000

export type MessageKind = 'text' | 'attachment' | 'progress' | 'exercise' | 'system'
/** `senderId` is null for a note the system wrote. A deleted message keeps its place and loses its words. */
export type ChatMessage = { id: string; conversationId: string; senderId: string | null; kind: MessageKind; body: string; data: Record<string, unknown>; createdAt: string; deleted: boolean }
/**
 * `open` is whether anything can be sent: it is false when the link between the two has ended, and until the patient has
 * turned messages on, which `consented` says.
 */
export type Conversation = {
  id: string; side: 'patient' | 'therapist'; otherId: string; otherName: string; otherPhoto: string | null; open: boolean; consented: boolean
  lastMessageAt: string | null; lastMessage: ChatMessage | null; unread: number
}
/** Newest first. `otherReadAt` is how far the other person has read, for "Seen". */
export type MessagePage = { messages: ChatMessage[]; more: boolean; open: boolean; consented: boolean; otherReadAt: string | null }
/** The patient's answer to the current messages agreement. */
export type ChatConsent = { version: string; granted: boolean; at: string | null }
export type ReadMark = { conversationId: string; userId: string; readAt: string }

type RawMessage = { id: string; conversation_id: string; sender_id: string | null; kind: string; body: string; data: unknown; created_at: string; deleted?: boolean; deleted_at?: string | null }

/** Reads both shapes a message arrives in: from a function, and as a table row over the live connection. */
export function decodeMessage(raw: RawMessage): ChatMessage {
  const deleted = raw.deleted ?? Boolean(raw.deleted_at)
  return {
    id: raw.id, conversationId: raw.conversation_id, senderId: raw.sender_id, kind: raw.kind as MessageKind, createdAt: raw.created_at, deleted,
    body: deleted ? '' : raw.body, data: deleted || !raw.data || typeof raw.data !== 'object' ? {} : raw.data as Record<string, unknown>,
  }
}

type RawConversation = {
  id: string; side: 'patient' | 'therapist'; other_id: string; other_name: string; other_photo: string | null; open: boolean; consented: boolean
  last_message_at: string | null; last_message: RawMessage | null; unread: number
}

export async function loadConversations(db: SupabaseClient<Database>): Promise<Conversation[]> {
  const { data, error } = await db.rpc('my_conversations')
  if (error) throw error
  return (data as unknown as RawConversation[]).map((row) => ({
    id: row.id, side: row.side, otherId: row.other_id, otherName: row.other_name, otherPhoto: row.other_photo, open: row.open, consented: row.consented,
    lastMessageAt: row.last_message_at, lastMessage: row.last_message && decodeMessage(row.last_message), unread: row.unread,
  }))
}

/** One page, newest first. Pass the oldest message on screen to read further back. */
export async function loadMessages(db: SupabaseClient<Database>, conversationId: string, before?: Pick<ChatMessage, 'id' | 'createdAt'> | null): Promise<MessagePage> {
  const { data, error } = await db.rpc('conversation_messages', { p_conversation: conversationId, p_before_at: before?.createdAt, p_before_id: before?.id })
  if (error) throw error
  const page = data as unknown as { messages: RawMessage[]; more: boolean; open: boolean; consented: boolean; other_read_at: string | null }
  return { messages: page.messages.map(decodeMessage), more: page.more, open: page.open, consented: page.consented, otherReadAt: page.other_read_at }
}

export async function loadChatConsent(db: SupabaseClient<Database>): Promise<ChatConsent> {
  const { data, error } = await db.rpc('my_chat_consent')
  if (error) throw error
  return data as unknown as ChatConsent
}

/** Turning messages on or off. Giving the same answer twice records nothing. */
export async function setChatConsent(db: SupabaseClient<Database>, granted: boolean): Promise<ChatConsent> {
  const { data, error } = await db.rpc('set_chat_consent', { p_granted: granted })
  if (error) throw error
  return data as unknown as ChatConsent
}

/** `id` is made by the caller and kept across retries, so a send whose reply was lost cannot arrive twice. */
export async function sendMessage(db: SupabaseClient<Database>, id: string, conversationId: string, body: string): Promise<ChatMessage> {
  const { data, error } = await db.rpc('send_message', { p_id: id, p_conversation: conversationId, p_body: body })
  if (error) throw error
  return decodeMessage(data as unknown as RawMessage)
}

export async function markConversationRead(db: SupabaseClient<Database>, conversationId: string) {
  const { error } = await db.rpc('mark_conversation_read', { p_conversation: conversationId })
  if (error) throw error
}

export async function deleteMessage(db: SupabaseClient<Database>, id: string): Promise<ChatMessage> {
  const { data, error } = await db.rpc('delete_message', { p_id: id })
  if (error) throw error
  return decodeMessage(data as unknown as RawMessage)
}

export async function loadUnreadMessages(db: SupabaseClient<Database>): Promise<number> {
  const { data, error } = await db.rpc('my_unread_messages')
  if (error) throw error
  return data
}

export type ChatEvents = {
  /** A new message, or one that was taken back. Only conversations the reader may open ever arrive. */
  onMessage: (message: ChatMessage) => void
  onRead?: (mark: ReadMark) => void
  /** True once rows are flowing, false while the connection is down. Whatever was sent meanwhile has to be fetched again when it returns. */
  onConnection?: (connected: boolean) => void
}

/**
 * One live connection for every conversation the reader has. The server applies the same access rule to each row it sends
 * as it does to reading. Returns how to close it.
 */
export function subscribeToChat(db: SupabaseClient<Database>, events: ChatEvents) {
  const channel = db.channel(`chat-${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages' }, (change) => {
      if (change.eventType !== 'DELETE') events.onMessage(decodeMessage(change.new as RawMessage))
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_reads' }, (change) => {
      if (change.eventType === 'DELETE') return
      const row = change.new as { conversation_id: string; user_id: string; read_at: string }
      events.onRead?.({ conversationId: row.conversation_id, userId: row.user_id, readAt: row.read_at })
    })
    // Joining the channel is not enough: rows only start to flow once the server says it is listening to the database.
    .on('system', {}, (notice: { extension?: string; status?: string }) => {
      if (notice.extension === 'postgres_changes') events.onConnection?.(notice.status === 'ok')
    })
    .subscribe((status) => { if (status !== 'SUBSCRIBED') events.onConnection?.(false) })
  return () => { void db.removeChannel(channel) }
}

/** Applies a live message to a newest-first list: adds it in order, or replaces the copy already there. */
export function mergeMessage(messages: readonly ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  const rest = messages.filter((message) => message.id !== incoming.id)
  return [...rest, incoming].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id))
}
