import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addDays } from '../../src/data/booking'
import { loadExerciseDay, publishScheduledPrescription } from '../../src/data/exerciseSchedule'
import { createUser, ingestSession, link, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

/** Missed exercise days (#128) against the real schema. Past days are written directly, because nothing in the apps can backdate. */
const ELBOW = '21000000-0000-0000-0000-000000000001'
const timing = { focus: 'ELBOW' as const, minimumCycleMs: 600, maximumCycleMs: 30000, peakHoldMs: 100, maxTrunkLean: 20, confidence: 0.7 }
const at = (date: string, time: string) => `('${date} ${time}')::timestamp at time zone 'Asia/Manila'`

describe('missed exercise days on the local backend', () => {
  const users: TestUser[] = []
  let therapist: TestUser
  let quiet: TestUser
  let today = ''

  /** A schedule that started days ago, with exercises added the day before it. */
  const scheduled = async (person: TestUser, from: number, to: number, restDates: string[] = [], exercises = 1, owner = therapist) => {
    const id = randomUUID()
    sql(`insert into public.exercise_schedules(id,patient_id,therapist_id,starts_on,ends_on,rest_dates) values('${id}','${person.id}','${owner.id}','${addDays(today, from)}','${addDays(today, to)}','{${restDates.join(',')}}')`)
    const versions: Array<{ assignment: string; version: string }> = []
    for (let index = 0; index < exercises; index += 1) {
      const assignment = randomUUID()
      const version = randomUUID()
      await publishScheduledPrescription(await signedIn(owner), id, { ...timing, assignmentId: assignment, requestId: version, patientId: person.id, exerciseId: ELBOW, side: 'left', low: 20, high: 90, repetitions: 8 })
      sql(`update public.exercise_assignments set created_at=${at(addDays(today, from - 1), '08:00')} where id='${assignment}'`)
      versions.push({ assignment, version })
    }
    return versions
  }
  /** A session finished at noon on a past day. */
  const finishedOn = async (person: TestUser, version: string, date: string) => {
    await ingestSession(person, version, { kind: 'ELBOW_FLEXION', side: 'LEFT', low: 20, high: 90, target: 8, focusJoint: 'ELBOW', min: 22, max: 88, completed: 8 })
    sql(`begin; set local session_replication_role=replica; update public.sessions set started_at=${at(date, '12:00')},ended_at=${at(date, '12:10')}
 where prescription_version_id='${version}' and started_at>now()-interval '1 hour'; commit;`)
  }
  const missed = (who: TestUser, patient: TestUser) => sql(`select coalesce(string_agg(data->>'day'||' '||(data->>'done')||'/'||(data->>'due'),',' order by data->>'day'),'')
 from public.notifications where user_id='${who.id}' and kind='exercise_missed' and subject_id='${patient.id}'`)
  const record = (time: string) => sql(`select public.record_exercise_days(${at(today, time)})`)

  beforeAll(async () => {
    therapist = await createUser(['therapist'], 'Missed Therapist')
    quiet = await createUser(['patient'], 'Quiet Patient')
    users.push(therapist, quiet)
    await link(therapist, quiet)
    today = sql('select public.center_date()')
  }, 60_000)

  afterAll(() => removeUsers(users))

  it('tells the therapist about a day with nothing done and one with some done, and nothing else', async () => {
    const patient = await createUser(['patient'], 'Partial Patient')
    const finisher = await createUser(['patient'], 'Finished Patient')
    const later = await createUser(['patient'], 'Later Patient')
    users.push(patient, finisher, later)
    await Promise.all([link(therapist, patient), link(therapist, finisher), link(therapist, later)])
    // Three days ago nothing; two days ago a rest date; yesterday one of two.
    const [first] = await scheduled(patient, -5, 5, [addDays(today, -2)], 2)
    await finishedOn(patient, first!.version, addDays(today, -1))
    // Every day done.
    const done = await scheduled(finisher, -1, 5)
    await finishedOn(finisher, done[0]!.version, addDays(today, -1))
    // A schedule that has not started.
    await scheduled(later, 1, 5)
    record('09:00')
    expect(missed(therapist, patient)).toBe(`${addDays(today, -3)} 0/2,${addDays(today, -1)} 1/2`)
    expect(missed(therapist, finisher)).toBe('')
    expect(missed(therapist, later)).toBe('')
    expect(sql(`select count(*) from public.exercise_day_results where patient_id='${patient.id}' and day='${addDays(today, -2)}'`)).toBe('0')
    expect(sql(`select due||'/'||done from public.exercise_day_results where patient_id='${finisher.id}' and day='${addDays(today, -1)}'`)).toBe('1/1')
    const data = JSON.parse(sql(`select data from public.notifications where user_id='${therapist.id}' and kind='exercise_missed' and subject_id='${patient.id}' and data->>'day'='${addDays(today, -1)}'`)) as Record<string, unknown>
    expect(data).toEqual({ patient_name: 'Partial Patient', day: addDays(today, -1), due: 2, done: 1 })
    // Running again sends nothing new.
    record('09:30')
    expect(missed(therapist, patient)).toBe(`${addDays(today, -3)} 0/2,${addDays(today, -1)} 1/2`)
    // The record marks those days, newest first, and the next day lists only its own two exercises.
    const day = await loadExerciseDay(await signedIn(therapist), patient.id)
    expect(day.missed.map((item) => `${item.day} ${item.done}/${item.due}`)).toEqual([`${addDays(today, -1)} 1/2`, `${addDays(today, -3)} 0/2`])
    expect(day.exercises.filter((item) => item.due)).toHaveLength(2)
  })

  it('records at night but waits for the morning to tell anyone', async () => {
    await scheduled(quiet, -1, 3)
    record('02:00')
    expect(sql(`select count(*) from public.exercise_day_results where patient_id='${quiet.id}' and notified_at is null and done<due`)).toBe('1')
    expect(missed(therapist, quiet)).toBe('')
    record('08:00')
    expect(missed(therapist, quiet)).toBe(`${addDays(today, -1)} 0/1`)
  })

  it('keeps the push off for a therapist who turned the switch off, and the bell still shows it', async () => {
    const colleague = await createUser(['therapist'], 'Quiet Therapist')
    const patient = await createUser(['patient'], 'Switch Patient')
    users.push(colleague, patient)
    await link(colleague, patient)
    const saved = await (await signedIn(colleague)).rpc('save_notification_settings', {
      p_bookings: true, p_exercise_plan: true, p_session_results: true, p_inactivity: true, p_care_team: true, p_messages: true, p_missed_days: false,
    })
    expect(saved.error).toBeNull()
    expect((saved.data as Record<string, unknown>).missed_days).toBe(false)
    await scheduled(patient, -1, 3, [], 1, colleague)
    record('10:00')
    expect(missed(colleague, patient)).toBe(`${addDays(today, -1)} 0/1`)
    expect(sql(`select d.status from public.notification_deliveries d join public.notifications n on n.id=d.notification_id
 where n.user_id='${colleague.id}' and n.kind='exercise_missed' and d.channel='push'`)).toBe('skipped')
    expect(sql(`select count(*) from public.notification_deliveries d join public.notifications n on n.id=d.notification_id
 where n.user_id='${colleague.id}' and n.kind='exercise_missed' and d.channel='email'`)).toBe('0')
    // An older app that does not send the switch leaves it off.
    await (await signedIn(colleague)).rpc('save_notification_settings', { p_bookings: true, p_exercise_plan: true, p_session_results: true, p_inactivity: true, p_care_team: true })
    expect(sql(`select missed_days from public.notification_settings where user_id='${colleague.id}'`)).toBe('f')
  })

  it('leaves the inactivity alert to patients with an every-day exercise', async () => {
    const scheduledOnly = await createUser(['patient'], 'Scheduled Patient')
    users.push(scheduledOnly)
    await link(therapist, scheduledOnly)
    await scheduled(scheduledOnly, -6, 3)
    sql(`select public.enqueue_inactivity_alerts(${at(today, '11:00')})`)
    expect(sql(`select count(*) from public.notifications where user_id='${therapist.id}' and kind='patient_inactive' and subject_id='${scheduledOnly.id}'`)).toBe('0')
  })

  it('shows missed days to the patient and their therapist only', async () => {
    const stranger = await createUser(['therapist'], 'Stranger Therapist')
    users.push(stranger)
    const read = async (who: TestUser) => (await (await signedIn(who)).from('exercise_day_results').select('day').eq('patient_id', quiet.id)).data ?? []
    expect((await read(quiet)).length).toBeGreaterThan(0)
    expect((await read(therapist)).length).toBeGreaterThan(0)
    expect(await read(stranger)).toEqual([])
    const write = await (await signedIn(therapist)).from('exercise_day_results').insert({ patient_id: quiet.id, therapist_id: therapist.id, day: today, due: 1, done: 0 })
    expect(write.error).not.toBeNull()
  })
})
