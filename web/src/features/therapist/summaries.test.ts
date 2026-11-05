import { describe, expect, it } from 'vitest'
import type { CatalogueExercise } from '@/data/catalogue'
import type { HistoricalMeasurement, HistoricalSession } from '@/data/history'
import type { PlanSummary } from '@/data/workspace'
import { latestMovement, latestSeries, recentFirst, romPoints, summarisePatients } from './summaries'

const ana = { id: 'p1', name: 'Ana', photoUrl: null }
const ben = { id: 'p2', name: '', photoUrl: null }
const measurement = (extra: Partial<HistoricalMeasurement> = {}): HistoricalMeasurement => ({ key: 'k', side: 'left', minimum: 14.26, maximum: 112.04, repetitions: 5, incomplete: 0, quality: 'valid', validFrames: 40, invalidFrames: 0, ...extra })
const session = (id: string, patientId: string, startedAt: string, m = measurement()): HistoricalSession => ({
  id, patientId, startedAt, endedAt: startedAt, status: 'completed', modelVersion: 'm', algorithmVersion: 'a', measurements: [m],
  prescription: { id: 'rx', assignmentId: 'a', version: 1, exerciseVersionId: 'v', exerciseName: 'Elbow flexion', algorithm: 'elbow-flexion-v1', side: 'left', low: 20, high: 120, targetRepetitions: 5 },
})
const plan: PlanSummary = { assignmentId: 'a', versionId: 'pv', patientId: 'p1', therapistId: 't1', exerciseId: 'v', version: 1, side: 'left', low: 30, high: 90, repetitions: 5, parameters: {} }
const catalogue: CatalogueExercise[] = [{ id: 'v', name: 'Shoulder abduction', algorithm: 'shoulder-abduction-v1', instructions: '', exerciseId: 'e', custom: false, selectable: true, retired: false, joint: null }]

describe('patient cards', () => {
  it('show the newest usable measurement, rounded as Android does', () => {
    const [card] = summarisePatients([ana], [plan], catalogue, [session('new', 'p1', '2026-11-05T00:00:00Z'), session('old', 'p1', '2026-11-01T00:00:00Z', measurement({ maximum: 60 }))])
    expect(card).toMatchObject({ plans: 1, latest: { exercise: 'Elbow flexion', low: 20, high: 120, reached: [14.3, 112], when: '2026-11-05T00:00:00Z' } })
  })

  it('never put failed tracking on a dial', () => {
    const bad = session('bad', 'p1', '2026-11-05T00:00:00Z', measurement({ quality: 'invalid', maximum: 170 }))
    const good = session('good', 'p1', '2026-11-01T00:00:00Z', measurement({ maximum: 80 }))
    expect(summarisePatients([ana], [plan], catalogue, [bad, good])[0]?.latest?.reached).toEqual([14.3, 80])
    expect(summarisePatients([ana], [plan], catalogue, [bad])[0]?.latest).toMatchObject({ exercise: 'Shoulder abduction', low: 30, high: 90, reached: null })
  })

  it('fall back to the plan, then to nothing', () => {
    expect(summarisePatients([ana], [plan], catalogue, [])[0]?.latest).toMatchObject({ exercise: 'Shoulder abduction', reached: null })
    expect(summarisePatients([ana], [], catalogue, [])[0]).toMatchObject({ plans: 0, latest: null })
  })

  it('use part of the ID when a patient has no name yet', () => {
    expect(summarisePatients([{ ...ben, id: 'abcdefghij' }], [], catalogue, [])[0]?.name).toBe('abcdefgh')
  })

  it('sort the most recently active first', () => {
    const cards = summarisePatients([ana, { ...ben, name: 'Ben' }], [], catalogue, [session('s', 'p2', '2026-11-05T00:00:00Z')])
    expect(recentFirst(cards).map((card) => card.id)).toEqual(['p2', 'p1'])
  })
})

describe('the record chart', () => {
  const on = (id: string, startedAt: string, name: string, prescription: string, m = measurement()) => {
    const base = session(id, 'p1', startedAt, m)
    return { ...base, prescription: { ...base.prescription!, id: prescription, exerciseVersionId: prescription, exerciseName: name } }
  }

  it('shows only the series worked on last, never exercises mixed on one line', () => {
    const series = latestSeries([on('a', '2026-11-01T00:00:00Z', 'Elbow flexion', 'rx1'), on('b', '2026-11-02T00:00:00Z', 'Shoulder abduction', 'rx2'), on('c', '2026-11-03T00:00:00Z', 'Elbow flexion', 'rx1')])
    expect(series?.prescription.exerciseName).toBe('Elbow flexion')
    expect(series?.points.map((point) => point.session.id)).toEqual(['a', 'c'])
  })

  it('starts again when the prescription changes', () => {
    const series = latestSeries([on('a', '2026-11-01T00:00:00Z', 'Elbow flexion', 'rx1'), on('b', '2026-11-02T00:00:00Z', 'Elbow flexion', 'rx2')])
    expect(series?.points.map((point) => point.session.id)).toEqual(['b'])
  })

  it('leaves a gap for limited tracking, matching the Progress page', () => {
    const series = latestSeries([on('a', '2026-11-01T00:00:00Z', 'Elbow flexion', 'rx1', measurement({ quality: 'limited' })), on('b', '2026-11-02T00:00:00Z', 'Elbow flexion', 'rx1')])
    expect(romPoints(series!, () => '').map((point) => point.value)).toEqual([null, 97.8])
  })

  it('has nothing to show without sessions', () => {
    expect(latestSeries([])).toBeNull()
  })
})

describe('the home fan', () => {
  it('shows each patient once, newest first', () => {
    const rings = latestMovement([ana, { ...ben, name: 'Ben' }], [session('a', 'p2', '2026-11-05T00:00:00Z'), session('b', 'p1', '2026-11-04T00:00:00Z'), session('c', 'p2', '2026-11-03T00:00:00Z')])
    expect(rings.map((ring) => ring.id)).toEqual(['a', 'b'])
  })

  it('skips sessions that cannot be shown', () => {
    expect(latestMovement([ana], [session('bad', 'p1', '2026-11-05T00:00:00Z', measurement({ validFrames: 0 }))])).toEqual([])
    expect(latestMovement([], [session('stranger', 'p9', '2026-11-05T00:00:00Z')])).toEqual([])
  })

  it('stops at the number of rings that stay readable', () => {
    const many = Array.from({ length: 9 }, (_, index) => ({ id: `p${index}`, name: `P${index}`, photoUrl: null }))
    expect(latestMovement(many, many.map((p) => session(`s${p.id}`, p.id, '2026-11-05T00:00:00Z')))).toHaveLength(6)
  })
})
