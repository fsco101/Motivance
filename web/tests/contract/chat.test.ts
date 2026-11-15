import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { deleteMessage, loadChatConsent, loadConversations, loadMessages, loadUnreadMessages, markConversationRead, sendMessage, setChatConsent, subscribeToChat, type ChatMessage, type ReadMark } from '../../src/data/chat'
import type { Database } from '../../src/data/database.types'
import { createUser, link, removeUsers, signedIn, sql, stack, type TestUser } from '../support/stack'

/** Care chat against the real schema: who may read and send, safe retries, unread counts and live delivery. */
describe('care chat on the local backend', () => {
  const users: TestUser[] = []
  let therapist: TestUser
  let otherTherapist: TestUser
  let patient: TestUser
  let scheduler: TestUser
  let admin: TestUser
  let conversation: string

  const until = async (check: () => boolean, what: string) => {
    for (let tries = 0; tries < 100; tries += 1) {
      if (check()) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(`Timed out waiting for ${what}`)
  }

  beforeAll(async () => {
    therapist = await createUser(['therapist'], 'Chat Therapist')
    otherTherapist = await createUser(['therapist'], 'Other Therapist')
    patient = await createUser(['patient'], 'Chat Patient')
    scheduler = await createUser(['scheduler'], 'Chat Scheduler')
    admin = await createUser(['admin'], 'Chat Admin')
    users.push(therapist, otherTherapist, patient, scheduler, admin)
    await link(therapist, patient)
  }, 60_000)

  afterAll(() => {
    removeUsers(users)
  })

  it('gives a linked pair one conversation each can see, and nobody else any', async () => {
    const [mine] = await loadConversations(await signedIn(therapist))
    expect(mine).toMatchObject({ side: 'therapist', otherId: patient.id, otherName: 'Chat Patient', open: false, consented: false, unread: 0, lastMessage: null })
    conversation = mine!.id
    const [theirs] = await loadConversations(await signedIn(patient))
    expect(theirs).toMatchObject({ id: conversation, side: 'patient', otherId: therapist.id, otherName: 'Chat Therapist', open: false, consented: false })
    for (const outsider of [otherTherapist, scheduler, admin]) expect(await loadConversations(await signedIn(outsider))).toEqual([])
  })

  it('lets nobody write until the patient turns messages on, and records the answer once', async () => {
    const [staff, person] = await Promise.all([signedIn(therapist), signedIn(patient)])
    await expect(sendMessage(staff, randomUUID(), conversation, 'Hello')).rejects.toMatchObject({ message: 'chat_consent_required' })
    await expect(sendMessage(person, randomUUID(), conversation, 'Hello')).rejects.toMatchObject({ message: 'chat_consent_required' })
    expect(await loadChatConsent(person)).toEqual({ version: 'care-chat-v1', granted: false, at: null })
    // Only a patient answers for themselves.
    for (const other of [therapist, scheduler, admin]) await expect(setChatConsent(await signedIn(other), true)).rejects.toMatchObject({ code: '42501' })
    expect(await setChatConsent(person, true)).toMatchObject({ version: 'care-chat-v1', granted: true })
    await setChatConsent(person, true)
    expect(sql(`select count(*) from public.consents where patient_id='${patient.id}' and consent_type='care-chat'`)).toBe('1')
    // It is audited like every other agreement.
    expect(Number(sql(`select count(*) from public.audit_events where target_type='consents' and actor_id='${patient.id}'`))).toBeGreaterThanOrEqual(1)
    expect(await loadConversations(staff)).toMatchObject([{ id: conversation, open: true, consented: true }])
  })

  it('sends once however often the same message is retried, and counts what is unread', async () => {
    const staff = await signedIn(therapist)
    const id = randomUUID()
    const sent = await sendMessage(staff, id, conversation, '  How is the elbow today?  ')
    expect(sent).toMatchObject({ id, senderId: therapist.id, kind: 'text', body: 'How is the elbow today?', deleted: false })
    expect(await sendMessage(staff, id, conversation, 'How is the elbow today?')).toEqual(sent)
    const person = await signedIn(patient)
    expect((await loadMessages(person, conversation)).messages).toEqual([sent])
    expect(await loadUnreadMessages(person)).toBe(1)
    expect(await loadUnreadMessages(staff)).toBe(0)
    await markConversationRead(person, conversation)
    expect(await loadUnreadMessages(person)).toBe(0)
    expect((await loadMessages(staff, conversation)).otherReadAt).not.toBeNull()
  })

  it('refuses empty, over-long and borrowed messages', async () => {
    const staff = await signedIn(therapist)
    await expect(sendMessage(staff, randomUUID(), conversation, '   ')).rejects.toMatchObject({ message: 'chat_invalid' })
    await expect(sendMessage(staff, randomUUID(), conversation, 'x'.repeat(2001))).rejects.toMatchObject({ message: 'chat_invalid' })
    const person = await signedIn(patient)
    const theirs = await sendMessage(person, randomUUID(), conversation, 'Better, thank you.')
    // Somebody else's ID cannot be reused to read or overwrite their message.
    await expect(sendMessage(staff, theirs.id, conversation, 'Mine now')).rejects.toMatchObject({ message: 'chat_invalid' })
  })

  it('keeps outsiders out of the messages, by function and by table', async () => {
    for (const outsider of [otherTherapist, scheduler, admin]) {
      const db = await signedIn(outsider)
      await expect(loadMessages(db, conversation)).rejects.toMatchObject({ code: '42501' })
      await expect(sendMessage(db, randomUUID(), conversation, 'Hello')).rejects.toMatchObject({ message: 'chat_closed' })
      await expect(markConversationRead(db, conversation)).rejects.toMatchObject({ code: '42501' })
      expect((await db.from('chat_messages').select('id')).data).toEqual([])
      expect((await db.from('chat_reads').select('user_id')).data).toEqual([])
    }
    // Even the two people cannot write to the table directly: everything goes through the checked functions.
    const direct = await (await signedIn(patient)).from('chat_messages').insert({ id: randomUUID(), conversation_id: conversation, sender_id: patient.id, kind: 'text', body: 'Direct' })
    expect(direct.error).not.toBeNull()
  })

  it('delivers a message, a read mark and a deletion live, and only to the two people', async () => {
    const [staff, person, outsider] = await Promise.all([signedIn(therapist), signedIn(patient), signedIn(otherTherapist)])
    const seen: ChatMessage[] = []
    const reads: ReadMark[] = []
    const leaked: ChatMessage[] = []
    const ready = { person: false, staff: false, outsider: false }
    const stop = [
      subscribeToChat(person, { onMessage: (message) => seen.push(message), onConnection: (on) => { ready.person = on } }),
      subscribeToChat(staff, { onMessage: () => undefined, onRead: (mark) => reads.push(mark), onConnection: (on) => { ready.staff = on } }),
      subscribeToChat(outsider, { onMessage: (message) => leaked.push(message), onConnection: (on) => { ready.outsider = on } }),
    ]
    try {
      await until(() => ready.person && ready.staff && ready.outsider, 'the live connections')
      const id = randomUUID()
      await sendMessage(staff, id, conversation, 'Try ten repetitions tonight.')
      await until(() => seen.some((message) => message.id === id), 'the live message')
      expect(seen.find((message) => message.id === id)).toMatchObject({ senderId: therapist.id, body: 'Try ten repetitions tonight.', deleted: false })

      await markConversationRead(person, conversation)
      await until(() => reads.some((mark) => mark.userId === patient.id), 'the live read mark')

      expect(await deleteMessage(staff, id)).toMatchObject({ id, deleted: true, body: '' })
      await until(() => seen.some((message) => message.id === id && message.deleted), 'the live deletion')
      expect(seen.find((message) => message.id === id && message.deleted)?.body).toBe('')
      expect(leaked).toEqual([])
    } finally {
      stop.forEach((close) => close())
    }
  }, 30_000)

  it('lets a message be taken back only by its sender, and only for a quarter of an hour', async () => {
    const staff = await signedIn(therapist)
    const person = await signedIn(patient)
    const sent = await sendMessage(staff, randomUUID(), conversation, 'Sent by mistake')
    await expect(deleteMessage(person, sent.id)).rejects.toMatchObject({ code: '42501' })
    sql(`update public.chat_messages set created_at=now()-interval '16 minutes' where id='${sent.id}';`)
    await expect(deleteMessage(staff, sent.id)).rejects.toMatchObject({ message: 'chat_too_late' })
  })

  it('pages back through a long conversation without gaps or repeats', async () => {
    sql(`insert into public.chat_messages(id,conversation_id,sender_id,kind,body,created_at)
      select gen_random_uuid(),'${conversation}','${therapist.id}','text','Older '||g,now()-interval '2 hours'-(g||' seconds')::interval from generate_series(1,60) g;`)
    const person = await signedIn(patient)
    const first = await loadMessages(person, conversation)
    expect(first.messages).toHaveLength(50)
    expect(first.more).toBe(true)
    const second = await loadMessages(person, conversation, first.messages.at(-1))
    expect(second.more).toBe(false)
    const all = [...first.messages, ...second.messages]
    expect(new Set(all.map((message) => message.id)).size).toBe(all.length)
    expect(all.filter((message) => message.body.startsWith('Older '))).toHaveLength(60)
    expect(all.map((message) => message.createdAt)).toEqual([...all.map((message) => message.createdAt)].sort().reverse())
  })

  it('limits how fast one person can send', async () => {
    const person = await signedIn(patient)
    sql(`insert into public.chat_messages(id,conversation_id,sender_id,kind,body) select gen_random_uuid(),'${conversation}','${patient.id}','text','Flood '||g from generate_series(1,30) g;`)
    await expect(sendMessage(person, randomUUID(), conversation, 'One more')).rejects.toMatchObject({ message: 'chat_rate_limited' })
    sql(`update public.chat_messages set created_at=created_at-interval '2 minutes' where sender_id='${patient.id}' and body like 'Flood %';`)
    await expect(sendMessage(person, randomUUID(), conversation, 'One more')).resolves.toMatchObject({ body: 'One more' })
  })

  it('closes the conversation when the link ends: the patient still reads, the therapist does not, and nobody sends', async () => {
    const staff = await signedIn(therapist)
    const person = await signedIn(patient)
    const before = await sendMessage(staff, randomUUID(), conversation, 'Last one before the link ends')
    sql(`update public.therapist_patients set active=false where therapist_id='${therapist.id}' and patient_id='${patient.id}';`)

    await expect(sendMessage(person, randomUUID(), conversation, 'Still there?')).rejects.toMatchObject({ message: 'chat_closed' })
    await expect(sendMessage(staff, randomUUID(), conversation, 'Still there?')).rejects.toMatchObject({ message: 'chat_closed' })
    // A retry of something already sent still succeeds, so a phone that never heard the reply stops retrying.
    expect(await sendMessage(staff, before.id, conversation, 'Last one before the link ends')).toEqual(before)

    expect(await loadConversations(person)).toMatchObject([{ id: conversation, open: false }])
    expect((await loadMessages(person, conversation)).open).toBe(false)
    expect(await loadConversations(staff)).toEqual([])
    await expect(loadMessages(staff, conversation)).rejects.toMatchObject({ code: '42501' })
    expect((await staff.from('chat_messages').select('id')).data).toEqual([])

    sql(`update public.therapist_patients set active=true where therapist_id='${therapist.id}' and patient_id='${patient.id}';`)
    expect(await loadConversations(staff)).toMatchObject([{ id: conversation, open: true }])
    await expect(sendMessage(person, randomUUID(), conversation, 'Welcome back')).resolves.toMatchObject({ body: 'Welcome back' })
  })

  it('turning messages off stops new ones both ways, and keeps what was said readable', async () => {
    const [staff, person] = await Promise.all([signedIn(therapist), signedIn(patient)])
    const said = await sendMessage(staff, randomUUID(), conversation, 'Before messages were turned off')
    await setChatConsent(person, false)
    await expect(sendMessage(staff, randomUUID(), conversation, 'After')).rejects.toMatchObject({ message: 'chat_consent_required' })
    await expect(sendMessage(person, randomUUID(), conversation, 'After')).rejects.toMatchObject({ message: 'chat_consent_required' })
    for (const db of [staff, person]) {
      const page = await loadMessages(db, conversation)
      expect(page).toMatchObject({ open: false, consented: false })
      expect(page.messages.map((message) => message.id)).toContain(said.id)
    }
    await setChatConsent(person, true)
    await expect(sendMessage(person, randomUUID(), conversation, 'Back on')).resolves.toMatchObject({ body: 'Back on' })
  })

  it('gives the trusted operator, and nobody else, an export of the patient’s messages', async () => {
    const operator = createClient<Database>(stack().API_URL, stack().SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    const taken = await sendMessage(await signedIn(therapist), randomUUID(), conversation, 'Taken back before export')
    await deleteMessage(await signedIn(therapist), taken.id)
    for (const person of [patient, therapist, admin, scheduler]) {
      const { error } = await (await signedIn(person)).rpc('export_patient_chat', { p_patient: patient.id })
      expect(error?.code).toBe('42501')
    }
    const { data, error } = await operator.rpc('export_patient_chat', { p_patient: patient.id })
    expect(error).toBeNull()
    const exported = data as { patient_id: string; agreement: Array<{ event: string }>; conversations: Array<{ therapist_name: string; messages: Array<{ from: string; text: string; deleted: boolean }> }> }
    expect(exported.patient_id).toBe(patient.id)
    expect(exported.agreement.map((answer) => answer.event)).toEqual(['granted', 'withdrawn', 'granted'])
    const [only] = exported.conversations
    expect(only!.therapist_name).toBe('Chat Therapist')
    expect(only!.messages).toContainEqual(expect.objectContaining({ from: 'patient', text: 'Back on', deleted: false }))
    expect(only!.messages).toContainEqual(expect.objectContaining({ from: 'therapist', text: '', deleted: true }))
    expect(JSON.stringify(exported)).not.toContain('Taken back before export')
  })

  it('erases the patient’s messages only for an open deletion request, and says so in the audit trail', async () => {
    const operator = createClient<Database>(stack().API_URL, stack().SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    const before = Number(sql(`select count(*) from public.chat_messages where conversation_id='${conversation}'`))
    expect(before).toBeGreaterThan(0)
    expect((await operator.rpc('erase_patient_chat', { p_patient: patient.id })).error?.message).toBe('No open deletion request for this patient')
    const { error: asked } = await (await signedIn(patient)).rpc('request_patient_data', { p_id: randomUUID(), p_kind: 'delete' })
    expect(asked).toBeNull()
    expect((await (await signedIn(admin)).rpc('erase_patient_chat', { p_patient: patient.id })).error?.code).toBe('42501')
    const { data, error } = await operator.rpc('erase_patient_chat', { p_patient: patient.id })
    expect(error).toBeNull()
    expect(data).toBe(before)
    expect(sql(`select count(*) from public.chat_messages m join public.conversations c on c.id=m.conversation_id where c.patient_id='${patient.id}'`)).toBe('0')
    expect(sql(`select count(*) from public.audit_events where action='erase' and target_type='chat_messages' and target_id='${patient.id}'`)).toBe('1')
    // The link is still active, so an empty conversation is there to carry on in.
    const [fresh] = await loadConversations(await signedIn(patient))
    expect(fresh).toMatchObject({ otherId: therapist.id, lastMessage: null, open: true })
    conversation = fresh!.id
  })

  it('stops a disabled account from reading or sending', async () => {
    const person = await signedIn(patient)
    sql(`update public.profiles set active=false where id='${patient.id}';`)
    try {
      await expect(loadMessages(person, conversation)).rejects.toMatchObject({ code: '42501' })
      await expect(sendMessage(await signedIn(therapist), randomUUID(), conversation, 'Hello?')).rejects.toMatchObject({ message: 'chat_closed' })
    } finally {
      sql(`update public.profiles set active=true where id='${patient.id}';`)
    }
  })
})
