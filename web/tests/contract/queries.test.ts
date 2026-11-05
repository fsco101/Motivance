import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadHistory, rehabilitationProgress } from '../../src/data/history'
import { loadCatalogue, loadOverview, loadPatients, loadPlans } from '../../src/data/workspace'
import { createUser, link, removeUsers, signedIn, type TestUser } from '../support/stack'

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

  it('reads the overview through row-level security', async () => {
    const overview = await loadOverview(await signedIn(therapist), therapist.id)
    expect(overview.displayName).toBe('Contract Therapist')
    expect(overview.patientIds).toEqual([patient.id])
    expect(overview.sessions).toHaveLength(1)
    expect(overview.assignments).toHaveLength(1)
  })

  it('lists linked patients with the profile embedding', async () => {
    expect(await loadPatients(await signedIn(therapist), therapist.id)).toEqual([{ id: patient.id, name: 'Contract Patient', photoUrl: null }])
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
    const [plan] = await loadPlans(await signedIn(therapist))
    expect(plan).toMatchObject({ versionId, patientId: patient.id, low: 20, high: 90, repetitions: 5 })
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

  it('hides history from an unlinked therapist', async () => {
    expect((await loadHistory(await signedIn(otherTherapist), { patientId: patient.id })).sessions).toEqual([])
  })
})
