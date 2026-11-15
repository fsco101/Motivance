import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

export const CHAT_BODY_LIMIT = 2000
/** Mirrors chat_media_limit on the server, which checks every stored file against these. */
export const MEDIA_LIMITS = { image: 1_048_576, video: 6_291_456, preview: 204_800 } as const
export const CHAT_BUCKET = 'chat-media'
/** A signed link is made when a file is opened, and lasts only long enough to load it. */
export const LINK_SECONDS = 300

export type MessageKind = 'text' | 'attachment' | 'progress' | 'exercise' | 'system'
/** `senderId` is null for a note the system wrote. A deleted message keeps its place and loses its words. */
export type ChatMessage = { id: string; conversationId: string; senderId: string | null; kind: MessageKind; body: string; data: Record<string, unknown>; createdAt: string; deleted: boolean }
/**
 * `open` is whether anything can be sent: it is false when the link between the two has ended, and until the patient has
 * turned messages on, which `consented` says.
 */
export type Conversation = {
  id: string; side: 'patient' | 'therapist'; otherId: string; otherName: string; otherPhoto: string | null; open: boolean; consented: boolean
  /** Whether the patient has agreed to photos and video, which needs the second version of the agreement. */
  media: boolean
  /** Whether the reader has muted this conversation's push. Only the reader can see this. */
  muted: boolean
  lastMessageAt: string | null; lastMessage: ChatMessage | null; unread: number
}
/** Newest first. `otherReadAt` is how far the other person has read, for "Seen". */
export type MessagePage = { messages: ChatMessage[]; more: boolean; open: boolean; consented: boolean; media: boolean; otherReadAt: string | null }
/** The patient's answer to the current messages agreement. */
export type ChatConsent = { version: string; granted: boolean; media: boolean; accepted_version: string | null; at: string | null }
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
  id: string; side: 'patient' | 'therapist'; other_id: string; other_name: string; other_photo: string | null; open: boolean; consented: boolean; media: boolean; muted?: boolean
  last_message_at: string | null; last_message: RawMessage | null; unread: number
}

export async function loadConversations(db: SupabaseClient<Database>): Promise<Conversation[]> {
  const { data, error } = await db.rpc('my_conversations')
  if (error) throw error
  return (data as unknown as RawConversation[]).map((row) => ({
    id: row.id, side: row.side, otherId: row.other_id, otherName: row.other_name, otherPhoto: row.other_photo, open: row.open, consented: row.consented, media: row.media, muted: row.muted ?? false,
    lastMessageAt: row.last_message_at, lastMessage: row.last_message && decodeMessage(row.last_message), unread: row.unread,
  }))
}

/** One page, newest first. Pass the oldest message on screen to read further back. */
export async function loadMessages(db: SupabaseClient<Database>, conversationId: string, before?: Pick<ChatMessage, 'id' | 'createdAt'> | null): Promise<MessagePage> {
  const { data, error } = await db.rpc('conversation_messages', { p_conversation: conversationId, p_before_at: before?.createdAt, p_before_id: before?.id })
  if (error) throw error
  const page = data as unknown as { messages: RawMessage[]; more: boolean; open: boolean; consented: boolean; media: boolean; other_read_at: string | null }
  return { messages: page.messages.map(decodeMessage), more: page.more, open: page.open, consented: page.consented, media: page.media, otherReadAt: page.other_read_at }
}

/** Mutes or unmutes this conversation's push for the reader. The bell and the unread count are not affected. */
export async function setConversationMuted(db: SupabaseClient<Database>, conversationId: string, muted: boolean) {
  const { error } = await db.rpc('set_conversation_muted', { p_conversation: conversationId, p_muted: muted })
  if (error) throw error
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

/** A photo or video as its message describes it. The words of the message are its caption. */
export type Attachment = {
  kind: 'image' | 'video'; mime: string; width: number; height: number; durationMs: number | null; bytes: number
  mediaPath: string; previewPath: string; expiresAt: string
}

export function attachmentOf(message: ChatMessage): Attachment | null {
  if (message.kind !== 'attachment' || message.deleted) return null
  const d = message.data
  if (typeof d.media_path !== 'string' || typeof d.preview_path !== 'string' || typeof d.expires_at !== 'string') return null
  return {
    kind: d.attachment_kind === 'video' ? 'video' : 'image', mime: String(d.mime ?? ''), width: Number(d.width ?? 0), height: Number(d.height ?? 0),
    durationMs: typeof d.duration_ms === 'number' ? d.duration_ms : null, bytes: Number(d.bytes ?? 0),
    mediaPath: d.media_path, previewPath: d.preview_path, expiresAt: d.expires_at,
  }
}

/** After 15 days the server issues no link and the file is removed, whatever is still on screen. */
export const expired = (attachment: Attachment, now = Date.now()) => Date.parse(attachment.expiresAt) <= now

export type MediaDraft = { kind: 'image' | 'video'; file: Blob; mime: string; preview: Blob; width: number; height: number; durationMs: number | null }
export type MediaPlaces = { mediaPath: string; previewPath: string }

/** Step one: the server agrees to the file and names where it and its preview go. The same ID again returns the same places. */
export async function startAttachment(db: SupabaseClient<Database>, id: string, conversationId: string, draft: Omit<MediaDraft, 'file' | 'preview'>): Promise<MediaPlaces> {
  const { data, error } = await db.rpc('start_attachment', {
    p_id: id, p_conversation: conversationId, p_kind: draft.kind, p_mime: draft.mime, p_width: draft.width, p_height: draft.height,
    p_duration_ms: draft.durationMs ?? undefined,
  })
  if (error) throw error
  const places = data as { media_path: string; preview_path: string }
  return { mediaPath: places.media_path, previewPath: places.preview_path }
}

/** A file already there from an earlier try counts as stored: nothing can overwrite it. */
export async function uploadMedia(db: SupabaseClient<Database>, path: string, file: Blob, contentType: string) {
  // Storage takes the type from the file itself, so a file without one is labelled with what the server agreed to.
  const typed = file.type === contentType ? file : new Blob([file], { type: contentType })
  const { error } = await db.storage.from(CHAT_BUCKET).upload(path, typed, { contentType, upsert: false })
  if (error && !/exists|duplicate/i.test(error.message)) throw error
}

/** Step two: the message, once both files are stored. A file the server finds over its limit is refused and removed. */
export async function sendAttachment(db: SupabaseClient<Database>, id: string, caption: string): Promise<ChatMessage> {
  const { data, error } = await db.rpc('send_attachment', { p_id: id, p_caption: caption })
  if (error) throw error
  const result = data as unknown as RawMessage & { refused?: string }
  if (result.refused) throw Object.assign(new Error(result.refused), { message: result.refused })
  return decodeMessage(result)
}

/** All three steps, for one photo or video. */
export async function sendMedia(db: SupabaseClient<Database>, id: string, conversationId: string, draft: MediaDraft, caption: string) {
  const places = await startAttachment(db, id, conversationId, draft)
  await uploadMedia(db, places.mediaPath, draft.file, draft.mime)
  await uploadMedia(db, places.previewPath, draft.preview, 'image/jpeg')
  return sendAttachment(db, id, caption)
}

/** A short-lived link to one file, issued only to the two people in the conversation and only until the file expires. */
export async function mediaLink(db: SupabaseClient<Database>, path: string, seconds = LINK_SECONDS) {
  const { data, error } = await db.storage.from(CHAT_BUCKET).createSignedUrl(path, seconds)
  if (error) throw error
  return data.signedUrl
}

/** What the Progress page showed when it was shared. Either the last four weeks, or one plan's range of motion. */
export type ProgressCard =
  | { scope: 'activity'; week: number; previousWeek: number; activeDays: number; streak: number; daysSinceLast: number | null; asOf: string }
  | { scope: 'series'; exercise: string; side: string; latest: number; best: number; change: number | null; measured: number; low: number; high: number; asOf: string }
/** A card's facts before the server stamps its moment, for either shape. */
export type ProgressFacts = ProgressCard extends infer T ? (T extends unknown ? Omit<T, 'asOf'> : never) : never
/** An exercise plan as it stood when a therapist sent it. */
export type ExerciseCard = { assignmentId: string; version: number; exercise: string; side: string; low: number; high: number; repetitions: number }
/** A quiet line about something that happened: today's practice reminder, or a finished session. */
export type SystemLine = { event: 'practice_reminder'; date: string } | { event: 'session_finished'; completed: number; target: number; side: string | null } | { event: 'unknown' }

const num = (value: unknown) => (typeof value === 'number' ? value : Number(value ?? 0))

export function progressOf(message: ChatMessage): ProgressCard | null {
  if (message.kind !== 'progress' || message.deleted) return null
  const d = message.data
  const asOf = String(d.as_of ?? message.createdAt)
  if (d.scope === 'activity') return { scope: 'activity', week: num(d.week), previousWeek: num(d.previous_week), activeDays: num(d.active_days), streak: num(d.streak), daysSinceLast: d.days_since_last == null ? null : num(d.days_since_last), asOf }
  if (d.scope === 'series') return { scope: 'series', exercise: String(d.exercise ?? ''), side: String(d.side ?? ''), latest: num(d.latest), best: num(d.best), change: d.change == null ? null : num(d.change), measured: num(d.measured), low: num(d.low), high: num(d.high), asOf }
  return null
}

export function exerciseOf(message: ChatMessage): ExerciseCard | null {
  if (message.kind !== 'exercise' || message.deleted) return null
  const d = message.data
  return { assignmentId: String(d.assignment_id ?? ''), version: num(d.version), exercise: String(d.exercise ?? ''), side: String(d.side ?? ''), low: num(d.low), high: num(d.high), repetitions: num(d.repetitions) }
}

export function systemLineOf(message: ChatMessage): SystemLine {
  const d = message.data
  if (d.event === 'practice_reminder') return { event: 'practice_reminder', date: String(d.date ?? '') }
  if (d.event === 'session_finished') return { event: 'session_finished', completed: num(d.completed), target: num(d.target), side: typeof d.side === 'string' ? d.side : null }
  return { event: 'unknown' }
}

/** Shares a progress snapshot. The server keeps only these facts, and stamps the moment. */
export async function shareProgress(db: SupabaseClient<Database>, id: string, conversationId: string, card: ProgressFacts, caption = ''): Promise<ChatMessage> {
  const facts = card.scope === 'activity'
    ? { scope: 'activity', week: card.week, previous_week: card.previousWeek, active_days: card.activeDays, streak: card.streak, days_since_last: card.daysSinceLast }
    : { scope: 'series', exercise: card.exercise, side: card.side, latest: card.latest, best: card.best, change: card.change, measured: card.measured, low: card.low, high: card.high }
  const { data, error } = await db.rpc('share_progress', { p_id: id, p_conversation: conversationId, p_progress: facts, p_caption: caption })
  if (error) throw error
  return decodeMessage(data as unknown as RawMessage)
}

/** A therapist sends one of the patient's active plans; the server writes the card from the plan itself. */
export async function shareExercise(db: SupabaseClient<Database>, id: string, conversationId: string, assignmentId: string, caption = ''): Promise<ChatMessage> {
  const { data, error } = await db.rpc('share_exercise', { p_id: id, p_conversation: conversationId, p_assignment: assignmentId, p_caption: caption })
  if (error) throw error
  return decodeMessage(data as unknown as RawMessage)
}

export type ScheduledMessage = { id: string; body: string; sendAt: string }

export async function loadScheduled(db: SupabaseClient<Database>, conversationId: string): Promise<ScheduledMessage[]> {
  const { data, error } = await db.rpc('my_scheduled_messages', { p_conversation: conversationId })
  if (error) throw error
  return (data as unknown as Array<{ id: string; body: string; send_at: string }>).map((row) => ({ id: row.id, body: row.body, sendAt: row.send_at }))
}

/** A therapist's message to arrive later. The same ID again changes nothing, so a retry is safe. */
export async function scheduleMessage(db: SupabaseClient<Database>, id: string, conversationId: string, body: string, sendAt: string) {
  const { error } = await db.rpc('schedule_message', { p_id: id, p_conversation: conversationId, p_body: body, p_send_at: sendAt })
  if (error) throw error
}

export async function cancelScheduled(db: SupabaseClient<Database>, id: string) {
  const { error } = await db.rpc('cancel_scheduled_message', { p_id: id })
  if (error) throw error
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
