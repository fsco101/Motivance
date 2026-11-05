import { describe, expect, it } from 'vitest'
import { chartable, dayStart, decodeHistory, rehabilitationProgress, resultStatus, rom, roundDegrees, usable, type HistoricalMeasurement, type HistoricalSession } from './history'

const measurement = (extra: Partial<HistoricalMeasurement> = {}): HistoricalMeasurement => ({
  key: 'elbow-flexion-v1', side: 'left', minimum: 10, maximum: 100, repetitions: 5, incomplete: 0, quality: 'valid', validFrames: 40, invalidFrames: 2, ...extra,
})
const session = (id: string, startedAt: string, prescription = 'p1', extra: Partial<HistoricalSession> = {}): HistoricalSession => ({
  id, patientId: 'patient', startedAt, endedAt: startedAt, status: 'completed', modelVersion: 'm1', algorithmVersion: 'a1',
  prescription: { id: prescription, assignmentId: 'a', version: 1, exerciseVersionId: 'v1', exerciseName: 'Elbow flexion', algorithm: 'elbow-flexion-v1', side: 'left', low: 20, high: 90, targetRepetitions: 5 },
  measurements: [measurement()], ...extra,
})

describe('measurements, matching Android', () => {
  it('computes range of motion only from sound values', () => {
    expect(rom(measurement())).toBe(90)
    expect(rom(measurement({ minimum: null }))).toBeNull()
    expect(rom(measurement({ minimum: 100, maximum: 10 }))).toBeNull()
  })

  it('charts valid measurements only', () => {
    expect(chartable(measurement())).toBe(true)
    expect(chartable(measurement({ quality: 'limited' }))).toBe(false)
    expect(chartable(measurement({ validFrames: 0 }))).toBe(false)
  })

  it('hides a value that failed tracking stored, as Android does', () => {
    expect(usable(measurement())).toBe(true)
    expect(usable(measurement({ quality: 'limited' }))).toBe(true)
    expect(usable(measurement({ quality: 'invalid' }))).toBe(false)
    expect(usable(measurement({ validFrames: 0 }))).toBe(false)
  })

  it('shows one decimal place', () => {
    expect(roundDegrees(87.3456)).toBe(87.3)
  })

  it('classifies each session', () => {
    expect(resultStatus(session('a', '2026-11-01T00:00:00Z'))).toBe('completed')
    expect(resultStatus(session('a', '2026-11-01T00:00:00Z', 'p1', { status: 'interrupted' }))).toBe('interrupted')
    expect(resultStatus(session('a', '2026-11-01T00:00:00Z', 'p1', { measurements: [] }))).toBe('empty')
    expect(resultStatus(session('a', '2026-11-01T00:00:00Z', 'p1', { measurements: [measurement({ quality: 'invalid' })] }))).toBe('invalid')
    expect(resultStatus(session('a', '2026-11-01T00:00:00Z', 'p1', { measurements: [measurement({ repetitions: 3 })] }))).toBe('partial')
  })
})

describe('progress series, matching Android', () => {
  it('starts a new series when the prescription changes, even with the same targets', () => {
    const series = rehabilitationProgress([session('a', '2026-11-01T00:00:00Z', 'p1'), session('b', '2026-11-02T00:00:00Z', 'p2')])
    expect(series).toHaveLength(2)
  })

  it('never merges different model versions', () => {
    const series = rehabilitationProgress([session('a', '2026-11-01T00:00:00Z'), session('b', '2026-11-02T00:00:00Z', 'p1', { modelVersion: 'm2' })])
    expect(series).toHaveLength(2)
  })

  it('orders points by time and leaves unusable ones blank', () => {
    const [series] = rehabilitationProgress([
      session('late', '2026-11-03T00:00:00Z'),
      session('early', '2026-11-01T00:00:00Z'),
      session('poor', '2026-11-02T00:00:00Z', 'p1', { measurements: [measurement({ quality: 'limited' })] }),
    ])
    expect(series?.points.map((p) => p.session.id)).toEqual(['early', 'poor', 'late'])
    expect(series?.points.map((p) => p.rom)).toEqual([90, null, 90])
  })

  it('skips sessions with no prescription', () => {
    expect(rehabilitationProgress([session('a', '2026-11-01T00:00:00Z', 'p1', { prescription: null })])).toEqual([])
  })
})

describe('date filters', () => {
  it('uses the browser’s calendar day, matching the local times on screen', () => {
    const start = new Date(dayStart('2026-03-02'))
    expect([start.getFullYear(), start.getMonth(), start.getDate(), start.getHours()]).toEqual([2026, 2, 2, 0])
    expect(new Date(dayStart('2026-03-31', 1)).getDate()).toBe(1)
  })
})

describe('history paging', () => {
  const raw = (index: number) => ({
    id: `s${index}`, patient_id: 'patient', started_at: `2026-11-01T00:00:${String(index % 60).padStart(2, '0')}Z`, ended_at: '2026-11-01T01:00:00Z', status: 'completed',
    model_version: 'm', algorithm_version: 'a', prescription: null, session_measurements: [],
  })

  it('offers a next page only when one more row came back', () => {
    expect(decodeHistory(Array.from({ length: 50 }, (_, i) => raw(i))).next).toBeNull()
    const page = decodeHistory(Array.from({ length: 51 }, (_, i) => raw(i)))
    expect(page.sessions).toHaveLength(50)
    expect(page.next?.id).toBe('s49')
  })
})
