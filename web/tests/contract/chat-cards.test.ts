import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  cancelScheduled, exerciseOf, loadConversations, loadMessages, loadScheduled, progressOf, scheduleMessage, sendMessage, setChatConsent, shareExercise,
  shareProgress, systemLineOf,
} from '../../src/data/chat'
import { publishPrescription } from '../../src/data/therapist'
import { createUser, ingestSession, link, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

/** Cards, quiet lines and scheduled messages, against the real schema. */
const ELBOW = '21000000-0000-0000-0000-000000000001'
const timing = { focus: 'ELBOW' as const, minimumCycleMs: 600, maximumCycleMs: 30000, peakHoldMs: 100, maxTrunkLean: 20, confidence: 0.7 }

describe('chat cards and lines on the local backend', () => {
  const users: TestUser[] = []
  let therapist: TestUser
  let patient: TestUser
  let otherPatient: TestUser
  let conversation: string
  let assignment: string
  let version: string

  const lines = (event: string) => sql(`select count(*) from public.chat_messages where conversation_id='${conversation}' and kind='system' and data->>'event'='${event}'`)

  beforeAll(async () => {
    therapist = await createUser(['therapist'], 'Card Therapist')
    patient = await createUser(['patient'], 'Card Patient')
    otherPatient = await createUser(['patient'], 'Other Patient')
    users.push(therapist, patient, otherPatient)
    await link(therapist, patient)
    await link(therapist, otherPatient)
    await setChatConsent(await signedIn(patient), true)
    assignment = randomUUID()
    version = randomUUID()
    await publishPrescription(await signedIn(therapist), { ...timing, assignmentId: assignment, requestId: version, patientId: patient.id, exerciseId: ELBOW, side: 'left', low: 20, high: 90, repetitions: 8 })
    conversation = (await loadConversations(await signedIn(patient)))[0]!.id
  }, 60_000)

  afterAll(() => removeUsers(users))

  it('shares a progress snapshot with its moment, keeping only its known facts', async () => {
    const person = await signedIn(patient)
    const activity = await shareProgress(person, randomUUID(), conversation, { scope: 'activity', week: 4, previousWeek: 2, activeDays: 9, streak: 3, daysSinceLast: 0 }, 'My last month')
    expect(progressOf(activity)).toMatchObject({ scope: 'activity', week: 4, previousWeek: 2, activeDays: 9, streak: 3, daysSinceLast: 0 })
    expect(Date.parse(progressOf(activity)!.asOf)).toBeGreaterThan(Date.now() - 60_000)
    expect(activity.body).toBe('My last month')
    const series = await shareProgress(await signedIn(therapist), randomUUID(), conversation,
      { scope: 'series', exercise: 'Elbow flexion', side: 'left', latest: 98, best: 98, change: 48, measured: 7, low: 20, high: 120 })
    expect(progressOf(series)).toMatchObject({ exercise: 'Elbow flexion', latest: 98, change: 48 })
    // Anything else sent along is dropped, and a card with impossible numbers is refused.
    const { data } = await person.rpc('share_progress', { p_id: randomUUID(), p_conversation: conversation, p_progress: { scope: 'activity', week: 1, previous_week: 0, active_days: 1, streak: 1, secret: 'x' } })
    expect(JSON.stringify(data)).not.toContain('secret')
    await expect(shareProgress(person, randomUUID(), conversation, { scope: 'activity', week: -1, previousWeek: 0, activeDays: 40, streak: 0, daysSinceLast: null })).rejects.toMatchObject({ message: 'chat_invalid' })
  })

  it('lets a therapist send one of the patient’s active plans, written by the server from the plan', async () => {
    const card = await shareExercise(await signedIn(therapist), randomUUID(), conversation, assignment, 'Try this tonight')
    expect(exerciseOf(card)).toMatchObject({ assignmentId: assignment, version: 1, exercise: 'Elbow flexion', side: 'left', low: 20, high: 90, repetitions: 8 })
    await expect(shareExercise(await signedIn(patient), randomUUID(), conversation, assignment)).rejects.toMatchObject({ code: '42501' })
    // Another patient's plan cannot be sent here.
    const theirs = randomUUID()
    await publishPrescription(await signedIn(therapist), { ...timing, assignmentId: theirs, requestId: randomUUID(), patientId: otherPatient.id, exerciseId: ELBOW, side: 'right', low: 10, high: 80, repetitions: 5 })
    await expect(shareExercise(await signedIn(therapist), randomUUID(), conversation, theirs)).rejects.toMatchObject({ message: 'chat_invalid' })
  })

  it('adds a quiet line for today’s practice reminder, once, that counts as nobody’s unread message', async () => {
    const before = await loadConversations(await signedIn(therapist))
    sql(`select public.notify_person('${patient.id}','practice_reminder',null,'{"date":"2026-11-15"}'::jsonb,'2026-11-15',null);
      select public.notify_person('${patient.id}','practice_reminder',null,'{"date":"2026-11-15"}'::jsonb,'2026-11-15',null);`)
    expect(lines('practice_reminder')).toBe('1')
    const line = (await loadMessages(await signedIn(patient), conversation)).messages.find((m) => m.kind === 'system')!
    expect(line.senderId).toBeNull()
    expect(systemLineOf(line)).toEqual({ event: 'practice_reminder', date: '2026-11-15' })
    const after = await loadConversations(await signedIn(therapist))
    expect(after[0]!.unread).toBe(before[0]!.unread)
    expect(after[0]!.lastMessage?.kind).not.toBe('system')
    expect(sql(`select count(*) from public.notifications where kind='chat_message' and data->>'conversation_id'='${conversation}' and created_at>now()-interval '5 seconds'`)).toBe('0')
  })

  it('adds a line for a finished session to the plan’s therapist’s conversation', async () => {
    await ingestSession(patient, version, { kind: 'ELBOW_FLEXION', side: 'LEFT', low: 20, high: 90, target: 8, focusJoint: 'ELBOW', min: 22, max: 88, completed: 7 })
    expect(lines('session_finished')).toBe('1')
    const line = (await loadMessages(await signedIn(therapist), conversation)).messages.find((m) => m.kind === 'system' && m.data.event === 'session_finished')!
    expect(systemLineOf(line)).toMatchObject({ event: 'session_finished', completed: 7, target: 8 })
  })

  it('sends a scheduled message once at its time, only the sender sees it waiting, and it can be cancelled', async () => {
    const [staff, person] = await Promise.all([signedIn(therapist), signedIn(patient)])
    const id = randomUUID()
    const at = new Date(Date.now() + 3_600_000).toISOString()
    await scheduleMessage(staff, id, conversation, 'Your session is tomorrow at 9.', at)
    await scheduleMessage(staff, id, conversation, 'Your session is tomorrow at 9.', at)
    expect(await loadScheduled(staff, conversation)).toEqual([{ id, body: 'Your session is tomorrow at 9.', sendAt: expect.any(String) }])
    expect(await loadScheduled(person, conversation)).toEqual([])
    await expect(scheduleMessage(person, randomUUID(), conversation, 'Hi', at)).rejects.toMatchObject({ code: '42501' })
    await expect(scheduleMessage(staff, randomUUID(), conversation, 'Too soon', new Date().toISOString())).rejects.toMatchObject({ message: 'chat_schedule_time' })
    expect(sql(`select public.send_scheduled_messages()`)).toBe('0')

    const later = new Date(Date.now() + 2 * 3_600_000).toISOString()
    expect(sql(`select public.send_scheduled_messages('${later}')`)).toBe('1')
    expect(sql(`select public.send_scheduled_messages('${later}')`)).toBe('0')
    const arrived = (await loadMessages(person, conversation)).messages.find((m) => m.id === id)!
    expect(arrived).toMatchObject({ senderId: therapist.id, body: 'Your session is tomorrow at 9.', kind: 'text' })
    expect(await loadScheduled(staff, conversation)).toEqual([])
    await expect(cancelScheduled(staff, id)).rejects.toMatchObject({ message: 'chat_schedule_gone' })

    const cancelled = randomUUID()
    await scheduleMessage(staff, cancelled, conversation, 'Never sent', at)
    await cancelScheduled(staff, cancelled)
    expect(sql(`select public.send_scheduled_messages('${later}')`)).toBe('0')
    expect(sql(`select count(*) from public.chat_messages where id='${cancelled}'`)).toBe('0')
  })

  it('drops a scheduled message whose conversation has closed by then, and says why', async () => {
    const staff = await signedIn(therapist)
    const id = randomUUID()
    await scheduleMessage(staff, id, conversation, 'After the link ends', new Date(Date.now() + 3_600_000).toISOString())
    await setChatConsent(await signedIn(patient), false)
    expect(sql(`select public.send_scheduled_messages('${new Date(Date.now() + 2 * 3_600_000).toISOString()}')`)).toBe('0')
    expect(sql(`select dropped_reason from public.chat_scheduled where id='${id}'`)).toBe('The conversation was closed at the time')
    await setChatConsent(await signedIn(patient), true)
    await expect(sendMessage(staff, randomUUID(), conversation, 'Back again')).resolves.toBeTruthy()
  })
})
