import type { ChatMessage } from '@/data/chat'

/** A message this device has written and the server has not yet confirmed. It keeps its ID across retries, so it can never arrive twice. */
export type Outgoing = { id: string; conversationId: string; body: string; createdAt: string; failed: boolean }

export type ThreadItem =
  | { type: 'day'; key: string; at: string }
  | { type: 'message'; key: string; message: ChatMessage; mine: boolean; state: 'sent' | 'sending' | 'failed'; seen: boolean }

/** How long a sender may take a message back. The server enforces the same quarter of an hour. */
export const DELETE_WINDOW_MS = 15 * 60_000

const dayOf = (iso: string) => { const date = new Date(iso); return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` }

/**
 * What the thread shows, oldest first: a line for each new day, then every message, then whatever is still on its way.
 * "Seen" sits only on the reader's newest delivered message, and only once the other person has read that far.
 */
export function threadItems(messages: readonly ChatMessage[], outgoing: readonly Outgoing[], me: string, otherReadAt: string | null): ThreadItem[] {
  const delivered = [...messages].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id))
  const known = new Set(delivered.map((message) => message.id))
  const lastMine = delivered.findLast((message) => message.senderId === me && !message.deleted)
  const seen = Boolean(lastMine && otherReadAt && Date.parse(otherReadAt) >= Date.parse(lastMine.createdAt))
  const waiting = outgoing.filter((item) => !known.has(item.id)).map((item): Extract<ThreadItem, { type: 'message' }> => ({
    type: 'message', key: item.id, mine: true, state: item.failed ? 'failed' : 'sending', seen: false,
    message: { id: item.id, conversationId: item.conversationId, senderId: me, kind: 'text', body: item.body, data: {}, createdAt: item.createdAt, deleted: false },
  }))
  const rows = [
    ...delivered.map((message): Extract<ThreadItem, { type: 'message' }> => ({ type: 'message', key: message.id, message, mine: message.senderId === me, state: 'sent', seen: seen && message.id === lastMine!.id })),
    ...waiting,
  ]
  const items: ThreadItem[] = []
  let day = ''
  for (const row of rows) {
    const next = dayOf(row.message.createdAt)
    if (next !== day) { items.push({ type: 'day', key: `day-${next}`, at: row.message.createdAt }); day = next }
    items.push(row)
  }
  return items
}

export const canDelete = (message: ChatMessage, me: string, now = Date.now()) =>
  message.senderId === me && !message.deleted && message.kind !== 'system' && now - Date.parse(message.createdAt) < DELETE_WINDOW_MS
