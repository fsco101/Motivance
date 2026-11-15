import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  decodeMessage, loadConversations, progressOf, scheduleMessage, sendMedia, sendMessage, setChatConsent, shareExercise, shareProgress, type MediaDraft,
} from '../../src/data/chat'
import { publishPrescription } from '../../src/data/therapist'
import { createUser, link, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

/**
 * Web and Android read the same rows. This writes one of every kind of message the web can make, then keeps exactly what the
 * server hands back to a reader, with IDs and times made stable, as the fixture Android's `CrossAppTest` parses. A change in
 * that shape fails here first; run with MOTIVANCE_UPDATE_FIXTURES=1 to accept it, then run the Android test.
 * The other way round, it sends the progress facts Android writes (from its own fixture) and reads them as the web does.
 */
const FIXTURES = resolve(__dirname, '../../../android/app/src/test/resources/cross-app')
const ELBOW = '21000000-0000-0000-0000-000000000001'
const timing = { focus: 'ELBOW' as const, minimumCycleMs: 600, maximumCycleMs: 30000, peakHoldMs: 100, maxTrunkLean: 20, confidence: 0.7 }
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

/** Every ID becomes a fixed one in order of appearance, and every moment a fixed one in the same order, so the fixture only changes when the shape does. */
function stable(value: unknown) {
  const ids = new Map<string, string>()
  const times: string[] = []
  const visit = (v: unknown): void => {
    if (typeof v === 'string') {
      if (TIME.test(v)) times.push(v)
      for (const id of v.match(UUID) ?? []) if (!ids.has(id)) ids.set(id, `00000000-0000-4000-8000-${String(ids.size + 1).padStart(12, '0')}`)
    } else if (Array.isArray(v)) v.forEach(visit)
    else if (v && typeof v === 'object') Object.values(v).forEach(visit)
  }
  visit(value)
  const order = [...new Set(times)].sort((a, b) => Date.parse(a) - Date.parse(b) || a.localeCompare(b))
  const moment = (v: string) => new Date(Date.UTC(2026, 10, 15, 7, 0, order.indexOf(v))).toISOString().replace('Z', '+00:00')
  const rewrite = (v: unknown): unknown => {
    if (typeof v === 'string') return TIME.test(v) ? moment(v) : v.replace(UUID, (id) => ids.get(id)!)
    if (Array.isArray(v)) return v.map(rewrite)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rewrite(x)]))
    return v
  }
  return rewrite(value)
}

function matchFixture(name: string, value: unknown) {
  const path = resolve(FIXTURES, name)
  const text = `${JSON.stringify(value, null, 2)}\n`
  if (process.env.MOTIVANCE_UPDATE_FIXTURES === '1' || !existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
  }
  expect(JSON.parse(text)).toEqual(JSON.parse(readFileSync(path, 'utf8')))
}

describe('web and Android read the same chat rows', () => {
  const users: TestUser[] = []
  let therapist: TestUser
  let patient: TestUser
  let conversation: string

  beforeAll(async () => {
    therapist = await createUser(['therapist'], 'Cross Therapist')
    patient = await createUser(['patient'], 'Cross Patient')
    users.push(therapist, patient)
    await link(therapist, patient)
    await setChatConsent(await signedIn(patient), true)
    const assignment = randomUUID()
    await publishPrescription(await signedIn(therapist), { ...timing, assignmentId: assignment, requestId: randomUUID(), patientId: patient.id, exerciseId: ELBOW, side: 'left', low: 20, high: 90, repetitions: 8 })
    const staff = await signedIn(therapist)
    const person = await signedIn(patient)
    conversation = (await loadConversations(person))[0]!.id
    // One of each, in a fixed order.
    await sendMessage(staff, randomUUID(), conversation, 'Hello from the web')
    const bytes = (size: number, fill: number) => new Blob([new Uint8Array(size).fill(fill)])
    const photo: MediaDraft = { kind: 'image', file: bytes(50_000, 7), mime: 'image/jpeg', preview: bytes(5_000, 3), width: 1600, height: 1200, durationMs: null }
    await sendMedia(person, randomUUID(), conversation, photo, 'My setup')
    const video: MediaDraft = { kind: 'video', file: bytes(80_000, 5), mime: 'video/webm', preview: bytes(5_000, 4), width: 640, height: 480, durationMs: 12_000 }
    await sendMedia(person, randomUUID(), conversation, video, '')
    await shareProgress(person, randomUUID(), conversation, { scope: 'activity', week: 4, previousWeek: 2, activeDays: 9, streak: 3, daysSinceLast: 0 }, 'My month')
    await shareProgress(staff, randomUUID(), conversation, { scope: 'series', exercise: 'Elbow flexion', side: 'left', latest: 98.5, best: 101, change: -2.5, measured: 7, low: 20, high: 90 }, '')
    await shareExercise(staff, randomUUID(), conversation, assignment, 'Tonight')
    sql(`select public.notify_person('${patient.id}','practice_reminder',null,'{"date":"2026-11-15"}'::jsonb,'2026-11-15',null);`)
    await scheduleMessage(staff, randomUUID(), conversation, 'A scheduled hello', new Date(Date.now() + 5 * 60_000).toISOString())
    sql(`select public.send_scheduled_messages(now()+interval '10 minutes');`)
  }, 90_000)

  afterAll(() => removeUsers(users))

  it('keeps the thread and the list in the shape Android parses', async () => {
    const person = await signedIn(patient)
    const { data: page, error } = await person.rpc('conversation_messages', { p_conversation: conversation })
    expect(error).toBeNull()
    const messages = (page as unknown as { messages: { kind: string }[] }).messages
    expect(messages.map((m) => m.kind).sort()).toEqual(['attachment', 'attachment', 'exercise', 'progress', 'progress', 'system', 'text', 'text'])
    matchFixture('web-thread.json', stable(page))
    const { data: list } = await person.rpc('my_conversations')
    matchFixture('web-conversations.json', stable(list))
  })

  it('reads the progress facts Android writes as the same card', async () => {
    const written = JSON.parse(readFileSync(resolve(FIXTURES, 'android-progress.json'), 'utf8')) as { activity: Record<string, unknown>; series: Record<string, unknown> }
    const person = await signedIn(patient)
    const read = async (facts: Record<string, unknown>) => {
      const { data, error } = await person.rpc('share_progress', { p_id: randomUUID(), p_conversation: conversation, p_progress: facts as never })
      expect(error).toBeNull()
      return progressOf(decodeMessage(data as never))
    }
    expect(await read(written.activity)).toMatchObject({ scope: 'activity', week: 4, previousWeek: 2, activeDays: 9, streak: 3, daysSinceLast: null })
    expect(await read(written.series)).toMatchObject({ scope: 'series', exercise: 'Elbow flexion', side: 'left', latest: 90.3, best: 90.3, change: 20.3, measured: 2, low: 20, high: 120 })
  })
})
