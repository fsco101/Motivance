import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addDays } from '../../src/data/booking'
import { endSchedule, loadExerciseDay, publishScheduledPrescription, saveSchedule, stopExercise, weekdayOf, type ScheduleDraft } from '../../src/data/exerciseSchedule'
import { publishPrescription } from '../../src/data/therapist'
import { createUser, ingestSession, link, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

/** Exercise schedules (#125) against the real schema. */
const ELBOW = '21000000-0000-0000-0000-000000000001'
const timing = { focus: 'ELBOW' as const, minimumCycleMs: 600, maximumCycleMs: 30000, peakHoldMs: 100, maxTrunkLean: 20, confidence: 0.7 }
const elbow = { kind: 'ELBOW_FLEXION', low: 20, high: 90, target: 8, focusJoint: 'ELBOW', min: 22, max: 88, completed: 8 }

const failure = async (work: Promise<unknown>) => (await work.then(() => null, (error: unknown) => error)) as { code?: string; message?: string } | null

describe('exercise schedules on the local backend', () => {
  const users: TestUser[] = []
  let therapist: TestUser
  let stranger: TestUser
  let patient: TestUser
  let today = ''

  const draft = (patch: Partial<ScheduleDraft> = {}): ScheduleDraft => ({ id: randomUUID(), patientId: patient.id, startsOn: today, endsOn: addDays(today, 13), restWeekdays: [], restDates: [], ...patch })
  const assign = async (scheduleId: string | null, side: 'left' | 'bilateral' = 'left') => {
    const assignmentId = randomUUID()
    const requestId = randomUUID()
    const request = { ...timing, assignmentId, requestId, patientId: patient.id, exerciseId: ELBOW, side, low: 20, high: 90, repetitions: 8 }
    const db = await signedIn(therapist)
    if (scheduleId) await publishScheduledPrescription(db, scheduleId, request)
    else await publishPrescription(db, request)
    return { assignmentId, requestId }
  }
  const dayOf = async (day?: string, who: TestUser = patient) => loadExerciseDay(await signedIn(who), patient.id, day)

  beforeAll(async () => {
    ;[therapist, stranger, patient] = await Promise.all([createUser(['therapist'], 'Schedule Therapist'), createUser(['therapist'], 'Other Therapist'), createUser(['patient'], 'Schedule Patient')])
    users.push(therapist, stranger, patient)
    await link(therapist, patient)
    today = sql('select public.center_date()')
  }, 60_000)

  afterAll(() => removeUsers(users))

  it('counts days at the center, which turns at midnight in Manila', () => {
    expect(sql(`select public.center_date('2026-11-17T15:59:59Z')`)).toBe('2026-11-17')
    expect(sql(`select public.center_date('2026-11-17T16:00:00Z')`)).toBe('2026-11-18')
  })

  it('lets only a linked therapist save a schedule, and a retried save keeps one', async () => {
    const plan = draft({ restWeekdays: [7] })
    for (const outsider of [stranger, patient]) expect((await failure(saveSchedule(await signedIn(outsider), plan)))?.code).toBe('42501')
    const saved = await saveSchedule(await signedIn(therapist), plan)
    expect(saved).toMatchObject({ id: plan.id, patientId: patient.id, therapistId: therapist.id, therapistName: 'Schedule Therapist', startsOn: today, endsOn: addDays(today, 13), restWeekdays: [7], exerciseCount: 0 })
    expect(saved.exerciseDays + saved.restDays).toBe(14)
    expect(saved.restDays).toBe(2)
    await saveSchedule(await signedIn(therapist), plan)
    expect(sql(`select count(*) from public.exercise_schedules where id='${plan.id}'`)).toBe('1')
    // Another therapist's change to it is refused, even once linked.
    await link(stranger, patient)
    expect((await failure(saveSchedule(await signedIn(stranger), { ...plan, endsOn: addDays(today, 20) })))?.code).toBe('42501')
    sql(`update public.therapist_patients set active=false where therapist_id='${stranger.id}' and patient_id='${patient.id}'`)
  })

  it('refuses dates and rest days that cannot work', async () => {
    const db = await signedIn(therapist)
    const reason = async (patch: Partial<ScheduleDraft>) => (await failure(saveSchedule(db, draft(patch))))?.message
    expect(await reason({ endsOn: addDays(today, -1) })).toBe('schedule_dates')
    expect(await reason({ startsOn: addDays(today, -1) })).toBe('schedule_dates')
    expect(await reason({ endsOn: addDays(today, 366) })).toBe('schedule_dates')
    expect(await reason({ restWeekdays: [1, 2, 3, 4, 5, 6, 7] })).toBe('schedule_rest_days')
    expect(await reason({ restDates: [addDays(today, 40)] })).toBe('schedule_rest_days')
    expect(await reason({ endsOn: today, restWeekdays: [weekdayOf(today)] })).toBe('schedule_no_day')
  })

  it('tells each day apart: before, an exercise day, rest by weekday, rest by date, the last day and after', async () => {
    const start = addDays(today, 1)
    const restByWeekday = addDays(start, 2)
    const restByDate = addDays(start, 4)
    // Not a week after the weekly rest day, which would be a rest day too.
    const last = addDays(start, 8)
    const plan = draft({ startsOn: start, endsOn: last, restWeekdays: [weekdayOf(restByWeekday)], restDates: [restByDate] })
    await saveSchedule(await signedIn(therapist), plan)
    const { assignmentId } = await assign(plan.id)
    const at = async (day: string) => {
      const found = await dayOf(day)
      return { schedule: found.schedules.find((item) => item.id === plan.id), exercise: found.exercises.find((item) => item.assignmentId === assignmentId) }
    }
    expect((await at(today)).schedule).toMatchObject({ state: 'upcoming', nextDay: start, exerciseCount: 1 })
    expect((await at(today)).exercise).toMatchObject({ due: false, done: false, scheduleId: plan.id })
    expect((await at(start)).schedule?.state).toBe('exercise')
    expect((await at(start)).exercise?.due).toBe(true)
    expect((await at(restByWeekday)).schedule?.state).toBe('rest')
    expect((await at(restByWeekday)).exercise?.due).toBe(false)
    expect((await at(restByDate)).schedule).toMatchObject({ state: 'rest', nextDay: addDays(restByDate, 1) })
    expect((await at(last)).schedule).toMatchObject({ state: 'exercise', daysLeft: 1, nextDay: null })
    expect((await at(addDays(last, 1))).schedule).toBeUndefined()
    expect((await at(addDays(last, 1))).exercise?.due).toBe(false)
  })

  it('marks an exercise done for today only, so it is due again on the next exercise day', async () => {
    const plan = draft()
    await saveSchedule(await signedIn(therapist), plan)
    const { assignmentId, requestId } = await assign(plan.id)
    expect((await dayOf()).exercises.find((item) => item.assignmentId === assignmentId)).toMatchObject({ due: true, done: false })
    await ingestSession(patient, requestId, { ...elbow, side: 'LEFT' })
    expect((await dayOf()).exercises.find((item) => item.assignmentId === assignmentId)).toMatchObject({ due: true, done: true })
    expect((await dayOf(addDays(today, 1))).exercises.find((item) => item.assignmentId === assignmentId)).toMatchObject({ due: true, done: false })
  })

  it('counts a both-sides exercise done only once both sides are finished', async () => {
    const plan = draft()
    await saveSchedule(await signedIn(therapist), plan)
    const { assignmentId, requestId } = await assign(plan.id, 'bilateral')
    const done = async () => (await dayOf()).exercises.find((item) => item.assignmentId === assignmentId)?.done
    await ingestSession(patient, requestId, { ...elbow, side: 'LEFT', extra: { bilateral: true } })
    expect(await done()).toBe(false)
    await ingestSession(patient, requestId, { ...elbow, side: 'RIGHT', extra: { bilateral: true } })
    expect(await done()).toBe(true)
  })

  it('keeps an exercise without a schedule as before: due every day', async () => {
    const { assignmentId } = await assign(null)
    for (const day of [today, addDays(today, 3), addDays(today, 200)]) {
      expect((await dayOf(day)).exercises.find((item) => item.assignmentId === assignmentId)).toMatchObject({ scheduleId: null, due: true })
    }
    expect(sql(`select schedule_id is null from public.exercise_assignments where id='${assignmentId}'`)).toBe('t')
  })

  it('keeps an edited exercise in its schedule, and refuses moving one into another', async () => {
    const first = draft()
    const second = draft()
    await saveSchedule(await signedIn(therapist), first)
    await saveSchedule(await signedIn(therapist), second)
    const { assignmentId } = await assign(first.id)
    await publishPrescription(await signedIn(therapist), { ...timing, assignmentId, requestId: randomUUID(), patientId: patient.id, exerciseId: ELBOW, side: 'right', low: 25, high: 95, repetitions: 10 })
    expect(sql(`select schedule_id from public.exercise_assignments where id='${assignmentId}'`)).toBe(first.id)
    const moved = publishScheduledPrescription(await signedIn(therapist), second.id, { ...timing, assignmentId, requestId: randomUUID(), patientId: patient.id, exerciseId: ELBOW, side: 'left', low: 20, high: 90, repetitions: 8 })
    expect((await failure(moved))?.code).toBe('42501')
    // Nobody publishes into a schedule that is not theirs.
    await link(stranger, patient)
    const theirs = publishScheduledPrescription(await signedIn(stranger), first.id, { ...timing, assignmentId: randomUUID(), requestId: randomUUID(), patientId: patient.id, exerciseId: ELBOW, side: 'left', low: 20, high: 90, repetitions: 8 })
    expect((await failure(theirs))?.code).toBe('42501')
    sql(`update public.therapist_patients set active=false where therapist_id='${stranger.id}' and patient_id='${patient.id}'`)
  })

  it('never rewrites days already past', async () => {
    // A schedule that started five days ago, written directly because the function only starts schedules today or later.
    const id = randomUUID()
    const restPast = addDays(today, -2)
    sql(`insert into public.exercise_schedules(id,patient_id,therapist_id,starts_on,ends_on,rest_dates) values('${id}','${patient.id}','${therapist.id}','${addDays(today, -5)}','${addDays(today, 5)}','{${restPast}}')`)
    const db = await signedIn(therapist)
    const base = { id, patientId: patient.id, startsOn: addDays(today, -5), endsOn: addDays(today, 5), restWeekdays: [], restDates: [restPast] }
    expect((await failure(saveSchedule(db, { ...base, startsOn: addDays(today, -4) })))?.message).toBe('schedule_dates')
    expect((await failure(saveSchedule(db, { ...base, restDates: [] })))?.message).toBe('schedule_rest_days')
    expect((await failure(saveSchedule(db, { ...base, restDates: [restPast, addDays(today, -1)] })))?.message).toBe('schedule_rest_days')
    const longer = await saveSchedule(db, { ...base, endsOn: addDays(today, 10), restDates: [restPast, addDays(today, 3)] })
    expect(longer).toMatchObject({ endsOn: addDays(today, 10), restDates: [restPast, addDays(today, 3)] })
  })

  it('ends a started schedule today, and cancels one that has not started along with its exercises', async () => {
    const running = draft({ endsOn: addDays(today, 20), restDates: [addDays(today, 5)] })
    await saveSchedule(await signedIn(therapist), running)
    const ended = await endSchedule(await signedIn(therapist), running.id)
    expect(ended).toMatchObject({ endsOn: today, restDates: [] })

    const later = draft({ startsOn: addDays(today, 7), endsOn: addDays(today, 14) })
    await saveSchedule(await signedIn(therapist), later)
    const { assignmentId } = await assign(later.id)
    expect((await failure(endSchedule(await signedIn(stranger), later.id)))?.code).toBe('42501')
    await endSchedule(await signedIn(therapist), later.id)
    expect(sql(`select cancelled_at is not null from public.exercise_schedules where id='${later.id}'`)).toBe('t')
    expect(sql(`select active from public.exercise_assignments where id='${assignmentId}'`)).toBe('f')
    expect((await dayOf()).schedules.some((item) => item.id === later.id)).toBe(false)
  })

  it('sends the practice reminder only on a day with an exercise still to do (#127)', async () => {
    // Three patients who all chose 11:59, asked about at noon today at the center.
    const [resting, finished, waiting] = await Promise.all(['Resting', 'Finished', 'Waiting'].map((name) => createUser(['patient'], `${name} Patient`))) as [TestUser, TestUser, TestUser]
    users.push(resting, finished, waiting)
    const planFor = async (person: TestUser, patch: Partial<ScheduleDraft>) => {
      await link(therapist, person)
      const plan = { ...draft(patch), patientId: person.id }
      await saveSchedule(await signedIn(therapist), plan)
      const requestId = randomUUID()
      await publishScheduledPrescription(await signedIn(therapist), plan.id, { ...timing, assignmentId: randomUUID(), requestId, patientId: person.id, exerciseId: ELBOW, side: 'left', low: 20, high: 90, repetitions: 8 })
      sql(`insert into public.notification_settings(user_id,reminder_time) values('${person.id}','11:59')`)
      return requestId
    }
    await planFor(resting, { restWeekdays: [weekdayOf(today)] })
    const done = await planFor(finished, {})
    await planFor(waiting, {})
    await ingestSession(finished, done, { ...elbow, side: 'LEFT' })
    sql(`select public.enqueue_practice_reminders(('${today} 12:00')::timestamp at time zone 'Asia/Manila')`)
    const reminders = (person: TestUser) => sql(`select count(*) from public.notifications where user_id='${person.id}' and kind='practice_reminder'`)
    expect(reminders(resting)).toBe('0')
    expect(reminders(finished)).toBe('0')
    expect(reminders(waiting)).toBe('1')
  })

  it('lets the patient read each exercise with its schedule, as the phone caches them', async () => {
    const plan = draft({ restWeekdays: [7], restDates: [addDays(today, 2)] })
    await saveSchedule(await signedIn(therapist), plan)
    const { assignmentId } = await assign(plan.id)
    const everyDay = (await assign(null)).assignmentId
    // The same embedding SupabaseAuthRepository.loadWorkspace asks for.
    const { data, error } = await (await signedIn(patient)).from('exercise_assignments')
      .select('id,patient_id,exercise_schedules(id,starts_on,ends_on,rest_weekdays,rest_dates,cancelled_at)').eq('active', true).eq('patient_id', patient.id)
    expect(error).toBeNull()
    const rows = (data ?? []) as unknown as Array<{ id: string; exercise_schedules: { id: string; starts_on: string; rest_weekdays: number[]; rest_dates: string[]; cancelled_at: string | null } | null }>
    expect(rows.find((row) => row.id === assignmentId)?.exercise_schedules).toMatchObject({ id: plan.id, starts_on: today, rest_weekdays: [7], rest_dates: [addDays(today, 2)], cancelled_at: null })
    expect(rows.find((row) => row.id === everyDay)?.exercise_schedules).toBeNull()
  })

  it('takes one exercise off the plan, for its own therapist only', async () => {
    const { assignmentId } = await assign(null)
    expect((await failure(stopExercise(await signedIn(stranger), assignmentId)))?.code).toBe('42501')
    expect((await failure(stopExercise(await signedIn(patient), assignmentId)))?.code).toBe('42501')
    await stopExercise(await signedIn(therapist), assignmentId)
    await stopExercise(await signedIn(therapist), assignmentId)
    expect((await dayOf()).exercises.some((item) => item.assignmentId === assignmentId)).toBe(false)
  })

  it('shows a day to the patient and their linked therapist only', async () => {
    expect((await dayOf(undefined, therapist)).day).toBe(today)
    expect((await failure(dayOf(undefined, stranger)))?.code).toBe('42501')
    const other = await createUser(['patient'], 'Another Patient')
    users.push(other)
    expect((await failure(loadExerciseDay(await signedIn(other), patient.id)))?.code).toBe('42501')
    // Row-level security keeps schedules with the people they belong to.
    const read = async (who: TestUser) => (await (await signedIn(who)).from('exercise_schedules').select('id').eq('patient_id', patient.id)).data ?? []
    expect((await read(patient)).length).toBeGreaterThan(0)
    expect((await read(therapist)).length).toBeGreaterThan(0)
    expect(await read(stranger)).toEqual([])
    expect(await read(other)).toEqual([])
    // Writing around the functions is not possible.
    const direct = await (await signedIn(therapist)).from('exercise_schedules').insert({ id: randomUUID(), patient_id: patient.id, therapist_id: therapist.id, starts_on: today, ends_on: today })
    expect(direct.error).not.toBeNull()
  })
})
