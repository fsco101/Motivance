import { describe, expect, it } from 'vitest'
import { mergeMessage, type ChatMessage } from '@/data/chat'
import { canDelete, threadItems, type Outgoing } from './thread'

const message = (id: string, createdAt: string, senderId: string | null = 'me', extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id, conversationId: 'c', senderId, kind: 'text', body: id, data: {}, createdAt, deleted: false, ...extra,
})
const local = (day: number, hour: number) => new Date(2026, 10, day, hour).toISOString()
const waiting = (id: string, failed = false): Outgoing => ({ id, conversationId: 'c', body: id, createdAt: local(3, 12), failed })

describe('thread items', () => {
  it('runs oldest first, with a line where each day starts', () => {
    const items = threadItems([message('c', local(3, 9), 'them'), message('b', local(2, 18)), message('a', local(2, 9), 'them')], [], 'me', null)
    expect(items.map((item) => (item.type === 'day' ? 'day' : item.message.id))).toEqual(['day', 'a', 'b', 'day', 'c'])
    expect(items.filter((item) => item.type === 'message').map((item) => item.mine)).toEqual([false, true, false])
  })

  it('marks only my newest delivered message as seen, once the other person has read that far', () => {
    const messages = [message('b', local(2, 10)), message('a', local(2, 9))]
    const seenOf = (readAt: string | null) => threadItems(messages, [], 'me', readAt).flatMap((item) => (item.type === 'message' && item.seen ? [item.message.id] : []))
    expect(seenOf(null)).toEqual([])
    expect(seenOf(local(2, 9))).toEqual([])
    expect(seenOf(local(2, 11))).toEqual(['b'])
    // A message I took back is not what they saw.
    expect(threadItems([message('b', local(2, 10), 'me', { deleted: true }), message('a', local(2, 9))], [], 'me', local(2, 11)).flatMap((item) => (item.type === 'message' && item.seen ? [item.message.id] : []))).toEqual(['a'])
  })

  it('shows what is still on its way after everything delivered, and drops it once the server has it', () => {
    const items = threadItems([message('a', local(3, 9))], [waiting('x'), waiting('y', true), waiting('a')], 'me', null)
    expect(items.flatMap((item) => (item.type === 'message' ? [[item.message.id, item.state]] : []))).toEqual([['a', 'sent'], ['x', 'sending'], ['y', 'failed']])
  })
})

describe('taking a message back', () => {
  const now = Date.parse(local(3, 12))
  it('is offered only for my own words, for a quarter of an hour', () => {
    expect(canDelete(message('a', new Date(now - 14 * 60_000).toISOString()), 'me', now)).toBe(true)
    expect(canDelete(message('a', new Date(now - 16 * 60_000).toISOString()), 'me', now)).toBe(false)
    expect(canDelete(message('a', new Date(now).toISOString(), 'them'), 'me', now)).toBe(false)
    expect(canDelete(message('a', new Date(now).toISOString(), 'me', { deleted: true }), 'me', now)).toBe(false)
  })
})

describe('live messages', () => {
  it('adds a new one in order and replaces one already there', () => {
    const list = [message('b', local(2, 10)), message('a', local(2, 9))]
    expect(mergeMessage(list, message('c', local(2, 11))).map((item) => item.id)).toEqual(['c', 'b', 'a'])
    const replaced = mergeMessage(list, message('a', local(2, 9), 'me', { deleted: true, body: '' }))
    expect(replaced.map((item) => [item.id, item.deleted])).toEqual([['b', false], ['a', true]])
  })
})
