import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HISTORY_PAGE_SIZE, loadHistory, rehabilitationProgress } from '../../src/data/history'
import { createCustomExercise, loadLatestSessions, publishPrescription, revokePatientLink } from '../../src/data/therapist'
import { loadCatalogue, loadOverview, loadPatients, loadPlans } from '../../src/data/workspace'
import { createUser, ingestSession, link, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

/** The web app's real queries against the real schema, including row-level security. */
const ELBOW = '21000000-0000-0000-0000-000000000001'

describe('web queries on the local backend', () => {
  const users: TestUser[] = []
  let therapist: TestUser
  let otherTherapist: TestUser
  let patient: TestUser
  let versionId: string
  let customVersion: string

  beforeAll(async () => {
    therapist = await createUser(['therapist'], 'Contract Therapist')
    otherTherapist = await createUser(['therapist'], 'Other Therapist')
    patient = await createUser(['patient'], 'Contract Patient')
    users.push(therapist, otherTherapist, patient)
    await link(therapist, patient)

    const staff = await signedIn(therapist)
    const created = await staff.rpc('create_custom_exercise', { p_id: randomUUID(), p_name: 'Seated knee extension', p_joint: 'KNEE', p_english: 'Sit tall.' })
    if (created.error) throw created.error
    customVersion = created.data as string
    versionId = randomUUID()
    const published = await staff.rpc('publish_prescription', {
      p_assignment: randomUUID(), p_version: versionId, p_patient: patient.id, p_exercise: ELBOW, p_side: 'left', p_low: 20, p_high: 90, p_repetitions: 5, p_parameters: {},
    })
    if (published.error) throw published.error

    const person = await signedIn(patient)
    const now = Date.now()
    const grant = randomUUID()
    const consent = await person.rpc('record_consent', { p_id: grant, p_event: 'granted', p_version: 'movement-summary-v1', p_occurred_at: new Date(now - 30_000).toISOString() })
    if (consent.error) throw consent.error
    const session = await person.rpc('ingest_session', {
      p_payload: {
        schemaVersion: 2, sessionId: randomUUID(), ownerId: patient.id, consentId: grant, startedAt: now - 20_000, endedAt: now - 10_000,
        rules: { kind: 'ELBOW_FLEXION', side: 'LEFT', low: 20, high: 90, target: 5, confidence: 0.7, stableFrames: 5, minimumCycleMs: 600, maximumCycleMs: 30000, peakHoldMs: 100, maxTrunkLean: 20, maxSpeed: 600, version: ELBOW, prescription: versionId, demo: false },
        metrics: { time: 1000, angle: 10, min: 10, max: 100, completed: 5, incomplete: 0, duration: 1000, valid: 40, invalid: 2, reasons: {} },
      },
    })
    if (session.error) throw session.error
  }, 60_000)

  afterAll(() => removeUsers(users))

  it('pages past the first 50 sessions without gaps or repeats', async () => {
    const paged = await createUser(['patient'], 'Paged Patient')
    users.push(paged)
    await link(therapist, paged)
    const db = await signedIn(therapist)
    const version = randomUUID()
    await publishPrescription(db, {
      assignmentId: randomUUID(), requestId: version, patientId: paged.id, exerciseId: ELBOW, side: 'left', focus: null, low: 20, high: 90, repetitions: 5,
      minimumCycleMs: 600, maximumCycleMs: 30000, peakHoldMs: 100, maxTrunkLean: 20, confidence: 0.7,
    })
    const total = HISTORY_PAGE_SIZE + 3
    for (let index = 0; index < total; index += 1) {
      await ingestSession(paged, version, { kind: 'ELBOW_FLEXION', side: 'LEFT', low: 20, high: 90, target: 5, focusJoint: 'ELBOW', min: 10, max: 60 + (index % 20), completed: 5 })
    }
    const first = await loadHistory(db, { patientId: paged.id })
    expect(first.sessions).toHaveLength(HISTORY_PAGE_SIZE)
    const second = await loadHistory(db, { patientId: paged.id }, first.next)
    expect(second.next).toBeNull()
    expect(new Set([...first.sessions, ...second.sessions].map((session) => session.id)).size).toBe(total)
  }, 60_000)

  it('keeps a quiet patient’s latest session, however busy another patient is', async () => {
    const latest = await loadLatestSessions(await signedIn(therapist), therapist.id)
    expect(latest.filter((session) => session.patientId === patient.id)).toHaveLength(1)
    expect(latest.filter((session) => session.patientId !== patient.id)).toHaveLength(5)
    expect(latest.map((session) => session.startedAt)).toEqual([...latest.map((session) => session.startedAt)].sort().reverse())
  })

  it('finds the newest usable session behind a run of failed tracking', async () => {
    const blocked = await createUser(['patient'], 'Blocked Camera')
    users.push(blocked)
    await link(therapist, blocked)
    const db = await signedIn(therapist)
    const version = randomUUID()
    await publishPrescription(db, {
      assignmentId: randomUUID(), requestId: version, patientId: blocked.id, exerciseId: ELBOW, side: 'left', focus: null, low: 20, high: 90, repetitions: 5,
      minimumCycleMs: 600, maximumCycleMs: 30000, peakHoldMs: 100, maxTrunkLean: 20, confidence: 0.7,
    })
    const rules = { kind: 'ELBOW_FLEXION', side: 'LEFT', low: 20, high: 90, target: 5, focusJoint: 'ELBOW' }
    await ingestSession(blocked, version, { ...rules, min: 15, max: 77, completed: 5 })
    for (let index = 0; index < 7; index += 1) await ingestSession(blocked, version, { ...rules, min: 40, max: 170, completed: 0, valid: 1, invalid: 400 })
    sql(`begin; set local session_replication_role=replica; update public.session_measurements set quality='invalid' where maximum_degrees=170 and session_id in (select id from public.sessions where patient_id='${blocked.id}'); commit;`)
    const own = (await loadLatestSessions(db, therapist.id)).filter((session) => session.patientId === blocked.id)
    expect(own).toHaveLength(1)
    expect(own[0]?.measurements[0]?.maximum).toBe(77)
  }, 30_000)

  it('shows someone who is also an administrator only the patients linked to them', async () => {
    const both = await createUser(['therapist', 'admin'], 'Both Roles')
    const mine = await createUser(['patient'], 'Linked To Both')
    users.push(both, mine)
    await link(both, mine)
    const db = await signedIn(both)
    expect((await db.from('patients').select('id')).data?.length).toBeGreaterThan(1)
    expect((await loadPatients(db, both.id)).map((row) => row.id)).toEqual([mine.id])
    const version = randomUUID()
    await publishPrescription(db, {
      assignmentId: randomUUID(), requestId: version, patientId: mine.id, exerciseId: ELBOW, side: 'left', focus: null, low: 20, high: 90, repetitions: 5,
      minimumCycleMs: 600, maximumCycleMs: 30000, peakHoldMs: 100, maxTrunkLean: 20, confidence: 0.7,
    })
    await ingestSession(mine, version, { kind: 'ELBOW_FLEXION', side: 'LEFT', low: 20, high: 90, target: 5, focusJoint: 'ELBOW', min: 10, max: 60, completed: 5 })
    expect((await loadPlans(db, both.id)).map((plan) => plan.patientId)).toEqual([mine.id])
    expect((await loadOverview(db, both.id)).sessions.map((session) => session.patientId)).toEqual([mine.id])
    expect((await loadLatestSessions(db, both.id)).map((session) => session.patientId)).toEqual([mine.id])
  })

  it('stops listing a patient once the link is revoked', async () => {
    const leaving = await createUser(['patient'], 'Leaving Patient')
    users.push(leaving)
    await link(therapist, leaving)
    const db = await signedIn(therapist)
    expect((await loadPatients(db, therapist.id)).map((row) => row.id)).toContain(leaving.id)
    await revokePatientLink(db, leaving.id)
    expect((await loadPatients(db, therapist.id)).map((row) => row.id)).not.toContain(leaving.id)
  })

  it('reads the overview through row-level security', async () => {
    const overview = await loadOverview(await signedIn(therapist), therapist.id)
    expect(overview.displayName).toBe('Contract Therapist')
    expect(overview.sessions).toHaveLength(20)
  })

  it('lists linked patients with the profile embedding', async () => {
    expect(await loadPatients(await signedIn(therapist), therapist.id)).toContainEqual({ id: patient.id, name: 'Contract Patient', photoUrl: null })
  })

  it('keeps one therapist’s patients and custom exercises from another', async () => {
    const other = await signedIn(otherTherapist)
    expect(await loadPatients(other, otherTherapist.id)).toEqual([])
    expect((await loadCatalogue(other, otherTherapist.id)).some((item) => item.id === customVersion)).toBe(false)
  })

  it('reads the catalogue with exercises(id,owner_id)', async () => {
    const catalogue = await loadCatalogue(await signedIn(therapist), therapist.id)
    expect(catalogue.find((item) => item.id === customVersion)).toMatchObject({ custom: true, selectable: true, joint: 'KNEE', name: 'Seated knee extension' })
    // The seed publishes a newer elbow version, so this one stays readable for existing plans but cannot be chosen.
    expect(catalogue.find((item) => item.id === ELBOW)).toMatchObject({ custom: false, selectable: false })
    expect(catalogue.filter((item) => item.name === 'Elbow flexion' && item.selectable)).toHaveLength(1)
  })

  it('reads each plan at its newest version', async () => {
    const plans = await loadPlans(await signedIn(therapist), therapist.id)
    expect(plans.find((plan) => plan.versionId === versionId)).toMatchObject({ patientId: patient.id, therapistId: therapist.id, low: 20, high: 90, repetitions: 5 })
  })

  it('resolves the history embedding through the composite key', async () => {
    const page = await loadHistory(await signedIn(therapist), { patientId: patient.id })
    expect(page.next).toBeNull()
    expect(page.sessions[0]?.prescription).toMatchObject({ id: versionId, low: 20, high: 90, algorithm: 'elbow-flexion-v1' })
    expect(page.sessions[0]?.measurements[0]).toMatchObject({ minimum: 10, maximum: 100, repetitions: 5, quality: 'valid' })
    expect(rehabilitationProgress(page.sessions)[0]?.points[0]?.rom).toBe(90)
  })

  it('accepts the keyset cursor and every filter', async () => {
    const db = await signedIn(therapist)
    const { sessions } = await loadHistory(db, { patientId: patient.id })
    const first = sessions[0]!
    expect((await loadHistory(db, { patientId: patient.id }, { startedAt: first.startedAt, id: first.id })).sessions).toEqual([])
    expect((await loadHistory(db, { patientId: patient.id, side: 'left', exerciseVersionId: ELBOW })).sessions).toHaveLength(1)
    expect((await loadHistory(db, { patientId: patient.id, side: 'right' })).sessions).toEqual([])
    expect((await loadHistory(db, { patientId: patient.id, from: '2020-01-01', through: '2099-01-01' })).sessions).toHaveLength(1)
  })

  it('a both-sides plan files each session under the side measured', async () => {
    const both = await createUser(['patient'], 'Both Sides Patient')
    users.push(both)
    await link(therapist, both)
    const db = await signedIn(therapist)
    const version = randomUUID()
    await publishPrescription(db, {
      assignmentId: randomUUID(), requestId: version, patientId: both.id, exerciseId: ELBOW, side: 'bilateral', sideSeconds: 90, focus: null, low: 20, high: 90, repetitions: 5,
      minimumCycleMs: 600, maximumCycleMs: 30000, peakHoldMs: 100, maxTrunkLean: 20, confidence: 0.7,
    })
    const rules = { kind: 'ELBOW_FLEXION', low: 20, high: 90, target: 5, focusJoint: 'ELBOW', min: 10, max: 60, completed: 5 }
    await ingestSession(both, version, { ...rules, side: 'LEFT', extra: { bilateral: true, sideSeconds: 90 } })
    await ingestSession(both, version, { ...rules, side: 'RIGHT', extra: { bilateral: true, sideSeconds: 90 } })
    const left = (await loadHistory(db, { patientId: both.id, side: 'left' })).sessions
    expect(left).toHaveLength(1)
    expect(left[0]?.measurements.map((m) => m.side)).toEqual(['left'])
    expect(left[0]?.prescription?.side).toBe('bilateral')
    expect((await loadHistory(db, { patientId: both.id, side: 'right' })).sessions.map((s) => s.measurements[0]?.side)).toEqual(['right'])
    expect((await loadHistory(db, { patientId: both.id })).sessions).toHaveLength(2)
  })

  it('makes a retried publish safe: the same request stays one version', async () => {
    const db = await signedIn(therapist)
    const request = {
      assignmentId: randomUUID(), requestId: randomUUID(), patientId: patient.id, exerciseId: ELBOW, side: 'left' as const, focus: null, low: 20, high: 90, repetitions: 5,
      minimumCycleMs: 600, maximumCycleMs: 30000, peakHoldMs: 100, maxTrunkLean: 20, confidence: 0.7,
    }
    await publishPrescription(db, request)
    await publishPrescription(db, request)
    expect(sql(`select count(*) from public.prescription_versions where assignment_id='${request.assignmentId}'`)).toBe('1')
    await expect(publishPrescription(db, { ...request, high: 100 })).rejects.toMatchObject({ code: '23505' })
  })

  it('makes a retried custom exercise safe: the same request stays one exercise', async () => {
    const db = await signedIn(therapist)
    const draft = { id: randomUUID(), name: 'Standing hip flexion', joint: 'HIP' as const, english: 'Lift the thigh slowly.', filipino: '' }
    expect(await createCustomExercise(db, draft)).toBe(await createCustomExercise(db, draft))
  })

  it('hides history from an unlinked therapist', async () => {
    expect((await loadHistory(await signedIn(otherTherapist), { patientId: patient.id })).sessions).toEqual([])
  })
})
