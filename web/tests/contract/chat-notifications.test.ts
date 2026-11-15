import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConversations, markConversationRead, sendMessage, setChatConsent, setConversationMuted } from '../../src/data/chat'
import { createUser, link, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

/** New-message notifications against the real schema: one per burst, none while reading along, and the switch and mute only stop push. */
describe('chat notifications on the local backend', () => {
  const users: TestUser[] = []
  let therapist: TestUser
  let patient: TestUser
  let outsider: TestUser
  let conversation: string

  const notices = (user: TestUser) => sql(`select count(*) from public.notifications where user_id='${user.id}' and kind='chat_message'`)
  const latest = (user: TestUser) => sql(`select n.data::text||'|'||coalesce(d.status,'')||'|'||coalesce(d.last_error,'')||'|'||coalesce(n.read_at::text,'unread')
    from public.notifications n left join public.notification_deliveries d on d.notification_id=n.id and d.channel='push'
    where n.user_id='${user.id}' and n.kind='chat_message' order by n.created_at desc limit 1`)
  /** As if the person last read the conversation long ago, and the last notice is old: the next message is news again. */
  const later = (user: TestUser) => sql(`update public.chat_reads set read_at=now()-interval '1 hour' where user_id='${user.id}';
    update public.notifications set created_at=now()-interval '1 hour' where user_id='${user.id}' and kind='chat_message';`)

  beforeAll(async () => {
    therapist = await createUser(['therapist'], 'Notice Therapist')
    patient = await createUser(['patient'], 'Notice Patient')
    outsider = await createUser(['therapist'], 'Notice Outsider')
    users.push(therapist, patient, outsider)
    await link(therapist, patient)
    await setChatConsent(await signedIn(patient), true)
    conversation = (await loadConversations(await signedIn(therapist)))[0]!.id
  }, 60_000)

  afterAll(() => removeUsers(users))

  it('tells the other person once, with who and which conversation but never the words, and sends no email', async () => {
    await sendMessage(await signedIn(therapist), randomUUID(), conversation, 'How is the knee today?')
    expect(notices(patient)).toBe('1')
    expect(notices(therapist)).toBe('0')
    const [data, status] = latest(patient).split('|')
    expect(JSON.parse(data!)).toEqual({ conversation_id: conversation, sender_name: 'Notice Therapist' })
    expect(status).toBe('pending')
    expect(sql(`select count(*) from public.notification_deliveries d join public.notifications n on n.id=d.notification_id where n.user_id='${patient.id}' and d.channel='email'`)).toBe('0')
  })

  it('makes a burst one notification while the last is unread', async () => {
    const staff = await signedIn(therapist)
    await sendMessage(staff, randomUUID(), conversation, 'And the elbow?')
    await sendMessage(staff, randomUUID(), conversation, 'Take your time.')
    expect(notices(patient)).toBe('1')
  })

  it('reading the conversation reads its notifications, and says nothing while the person reads along', async () => {
    const person = await signedIn(patient)
    await markConversationRead(person, conversation)
    expect(latest(patient).split('|')[3]).not.toBe('unread')
    await sendMessage(await signedIn(therapist), randomUUID(), conversation, 'Still there?')
    expect(notices(patient)).toBe('1')
    later(patient)
    await sendMessage(await signedIn(therapist), randomUUID(), conversation, 'Talk tomorrow.')
    expect(notices(patient)).toBe('2')
  })

  it('the messages switch stops push but keeps the bell, and an older app cannot turn it back on', async () => {
    const person = await signedIn(patient)
    const all = { p_bookings: true, p_exercise_plan: true, p_session_results: true, p_inactivity: true, p_care_team: true }
    const off = await person.rpc('save_notification_settings', { ...all, p_messages: false })
    expect(off.data).toMatchObject({ messages: false })
    // What an app from before this change sends.
    expect((await person.rpc('save_notification_settings', all)).data).toMatchObject({ messages: false })
    later(patient)
    await sendMessage(await signedIn(therapist), randomUUID(), conversation, 'With the switch off')
    expect(latest(patient).split('|').slice(1, 3)).toEqual(['skipped', 'Turned off'])
    await person.rpc('save_notification_settings', { ...all, p_messages: true })
  })

  it('muting one conversation stops its push for that person only, privately', async () => {
    const staff = await signedIn(therapist)
    await setConversationMuted(staff, conversation, true)
    expect(await loadConversations(staff)).toMatchObject([{ muted: true }])
    // The other person cannot see it, by function or by table.
    expect(await loadConversations(await signedIn(patient))).toMatchObject([{ muted: false }])
    expect((await (await signedIn(patient)).from('chat_mutes' as never).select('*')).error).not.toBeNull()
    later(therapist)
    await sendMessage(await signedIn(patient), randomUUID(), conversation, 'Thank you')
    expect(latest(therapist).split('|').slice(1, 3)).toEqual(['skipped', 'Muted'])
    await setConversationMuted(staff, conversation, false)
    later(therapist)
    await sendMessage(await signedIn(patient), randomUUID(), conversation, 'See you Thursday')
    expect(latest(therapist).split('|')[1]).toBe('pending')
    await expect(setConversationMuted(await signedIn(outsider), conversation, true)).rejects.toMatchObject({ code: '42501' })
  })
})
