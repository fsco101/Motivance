import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConversations, loadMessages, markConversationRead, sendMessage } from '../../src/data/chat'
import { createUser, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

/**
 * A load check for #112, run on demand with MOTIVANCE_LOAD=1 (it takes a few minutes): one therapist with many conversations,
 * and one conversation with thousands of messages. It measures what both apps call and prints the timings for the record.
 * The limits are generous on purpose: they catch a missing index or a list that grows with the history, not machine speed.
 */
const PATIENTS = 150
const PER_CONVERSATION = 20
const LONG = 5_000
const run = process.env.MOTIVANCE_LOAD === '1'

async function timed<T>(label: string, times: number, work: () => Promise<T>) {
  const taken: number[] = []
  let last: T | undefined
  for (let i = 0; i < times; i++) {
    const began = performance.now()
    last = await work()
    taken.push(performance.now() - began)
  }
  taken.sort((a, b) => a - b)
  const median = taken[Math.floor(taken.length / 2)]!
  console.log(`[load] ${label}: median ${median.toFixed(0)} ms, slowest ${taken.at(-1)!.toFixed(0)} ms over ${times}`)
  return { median, last: last as T }
}

describe.skipIf(!run)('chat under load on the local backend', () => {
  const users: TestUser[] = []
  let therapist: TestUser
  let busiest: string

  beforeAll(async () => {
    therapist = await createUser(['therapist'], 'Load Therapist')
    users.push(therapist)
    for (let i = 0; i < PATIENTS; i += 10) {
      users.push(...await Promise.all(Array.from({ length: Math.min(10, PATIENTS - i) }, (_, n) => createUser(['patient'], `Load Patient ${i + n + 1}`))))
    }
    const patients = users.slice(1)
    // Linking makes each conversation; the messages are written straight into the table, as a long history would have been.
    sql(`insert into public.therapist_patients(therapist_id,patient_id,active) values ${patients.map((p) => `('${therapist.id}','${p.id}',true)`).join(',')} on conflict do nothing;
      insert into public.consents(patient_id,consent_type,version,event,client_event_id,occurred_at) select id,'care-chat','care-chat-v2','granted',gen_random_uuid(),now() from unnest(array[${patients.map((p) => `'${p.id}'::uuid`).join(',')}]) id;`)
    busiest = sql(`select id from public.conversations where therapist_id='${therapist.id}' and patient_id='${patients[0]!.id}'`).trim()
    sql(`begin; set local session_replication_role=replica;
      insert into public.chat_messages(id,conversation_id,sender_id,kind,body,created_at)
        select gen_random_uuid(),c.id,case when n%2=0 then c.therapist_id else c.patient_id end,'text','Message '||n,now()-interval '1 day'+n*interval '1 second'
        from public.conversations c, generate_series(1,${PER_CONVERSATION}) n where c.therapist_id='${therapist.id}';
      insert into public.chat_messages(id,conversation_id,sender_id,kind,body,created_at)
        select gen_random_uuid(),'${busiest}',case when n%2=0 then c.therapist_id else c.patient_id end,'text','Long history '||n,now()-interval '30 days'+n*interval '1 minute'
        from public.conversations c, generate_series(1,${LONG}) n where c.id='${busiest}';
      commit; analyze public.chat_messages;`)
  }, 600_000)

  afterAll(() => removeUsers(users), 300_000)

  it('lists every conversation, with counts, quickly', async () => {
    const staff = await signedIn(therapist)
    const { median, last } = await timed(`my_conversations, ${PATIENTS} conversations`, 7, () => loadConversations(staff))
    expect(last).toHaveLength(PATIENTS)
    expect(last.find((c) => c.id === busiest)!.unread).toBe((PER_CONVERSATION + LONG) / 2)
    expect(median).toBeLessThan(300)
    // The list works out openness in one join; it must give the same answer as the checks every other call uses.
    const checked = sql(`begin; select set_config('request.jwt.claims','{"sub":"${therapist.id}","role":"authenticated"}',true);
      select string_agg(c.id::text||':'||public.chat_can_send(c.id)::text,',' order by c.id) from public.conversations c where c.therapist_id='${therapist.id}' and public.chat_can_read(c.id);
      commit;`).split('\n').find((line) => /^[0-9a-f-]{36}:(true|false)/.test(line))!.trim()
    expect(last.map((c) => `${c.id}:${c.open}`).sort().join(',')).toBe(checked)
    // Closing one link and one consent changes exactly those rows, in both.
    const [closed, unconsented] = users.slice(PATIENTS - 1)
    sql(`update public.therapist_patients set active=false where therapist_id='${therapist.id}' and patient_id='${closed!.id}';
      insert into public.consents(patient_id,consent_type,version,event,client_event_id,occurred_at) values('${unconsented!.id}','care-chat','care-chat-v2','withdrawn',gen_random_uuid(),now()+interval '1 second');`)
    const after = await loadConversations(staff)
    expect(after).toHaveLength(PATIENTS - 1)
    expect(after.find((c) => c.otherId === unconsented!.id)!.open).toBe(false)
    expect(after.filter((c) => !c.open)).toHaveLength(1)
  })

  it('pages through a long conversation without the page slowing down', async () => {
    const staff = await signedIn(therapist)
    const first = await timed(`first page of ${LONG + PER_CONVERSATION} messages`, 7, () => loadMessages(staff, busiest))
    expect(first.last.messages.length).toBeGreaterThan(0)
    expect(first.last.more).toBe(true)
    // Walk back a long way, then time a page from deep in the history.
    let page = first.last
    for (let i = 0; i < 20 && page.more; i++) page = await loadMessages(staff, busiest, page.messages.at(-1))
    const deep = await timed('a page from deep in the history', 7, () => loadMessages(staff, busiest, page.messages.at(-1)))
    expect(first.median).toBeLessThan(500)
    expect(deep.median).toBeLessThan(500)
    const plan = sql(`explain select id from public.chat_messages where conversation_id='${busiest}' order by created_at desc, id desc limit 50`)
    console.log(`[load] page plan: ${plan.split('\n')[1]?.trim()}`)
    expect(plan).toContain('chat_messages_page')
  })

  it('sends and marks read in a long conversation quickly', async () => {
    const staff = await signedIn(therapist)
    const sent = await timed('send_message into the long conversation', 5, () => sendMessage(staff, randomUUID(), busiest, 'Checking in'))
    const read = await timed('mark_conversation_read', 5, () => markConversationRead(staff, busiest))
    expect(sent.median).toBeLessThan(500)
    expect(read.median).toBeLessThan(500)
  })
})
