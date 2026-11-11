import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

export const HISTORY_PAGE_SIZE = 50

// Name the composite foreign key explicitly: never join a session to an assignment's current version.
export const HISTORY_SELECT = 'id,patient_id,started_at,ended_at,status,model_version,algorithm_version,'
  + 'prescription:prescription_versions!sessions_prescription_version_id_patient_id_fkey!inner('
  + 'id,assignment_id,version,exercise_version_id,side,minimum_degrees,maximum_degrees,target_repetitions,'
  + 'exercise:exercise_versions(algorithm_key,definition)),'
  + 'session_measurements(metric_key,side,minimum_degrees,maximum_degrees,completed_repetitions,'
  + 'incomplete_repetitions,quality,valid_frames,invalid_frames)'

export type HistoryQuery = { patientId: string; exerciseVersionId?: string; side?: string; from?: string; through?: string }
export type HistoryCursor = { startedAt: string; id: string }

export type HistoricalPrescription = {
  id: string; assignmentId: string; version: number; exerciseVersionId: string; exerciseName: string; algorithm: string
  side: string; low: number; high: number; targetRepetitions: number
}
export type HistoricalMeasurement = {
  key: string; side: string; minimum: number | null; maximum: number | null; repetitions: number; incomplete: number
  quality: string; validFrames: number; invalidFrames: number
}
export type HistoricalSession = {
  id: string; patientId: string; startedAt: string; endedAt: string; status: string; modelVersion: string; algorithmVersion: string
  prescription: HistoricalPrescription | null; measurements: HistoricalMeasurement[]
}
export type HistoryPage = { sessions: HistoricalSession[]; next: HistoryCursor | null }

export function rom(m: HistoricalMeasurement) {
  const { minimum, maximum } = m
  return minimum !== null && maximum !== null && Number.isFinite(minimum) && Number.isFinite(maximum) && maximum >= minimum ? maximum - minimum : null
}
export const chartable = (m: HistoricalMeasurement) => m.quality === 'valid' && m.validFrames > 0 && rom(m) !== null
/** Whether a value may be shown at all. Failed tracking can store angles that look real, as Android also guards against. */
export const usable = (m: HistoricalMeasurement) => (m.quality === 'valid' || m.quality === 'limited') && m.validFrames > 0 && rom(m) !== null
/** One decimal place, as Android shows. */
export const roundDegrees = (value: number) => Math.round(value * 10) / 10

export type ResultStatus = 'completed' | 'partial' | 'interrupted' | 'empty' | 'invalid'

export function resultStatus(s: HistoricalSession): ResultStatus {
  if (s.status === 'interrupted') return 'interrupted'
  if (s.measurements.length === 0) return 'empty'
  if (!s.measurements.some((m) => (m.quality === 'valid' || m.quality === 'limited') && rom(m) !== null && m.validFrames > 0)) return 'invalid'
  const short = s.status !== 'completed' || s.prescription === null
    || s.measurements.some((m) => !chartable(m) || m.incomplete > 0 || m.repetitions < s.prescription!.targetRepetitions)
  return short ? 'partial' : 'completed'
}

export type ProgressPoint = { session: HistoricalSession; measurement: HistoricalMeasurement | null; rom: number | null; repetitions: number | null }
export type ProgressSeries = { key: string; metric: string; side: string; model: string; algorithm: string; prescription: HistoricalPrescription; points: ProgressPoint[] }

/** Mirrors rehabilitationProgress on Android: a prescription change starts a separate series, even if its targets match. */
export function rehabilitationProgress(sessions: readonly HistoricalSession[]): ProgressSeries[] {
  const groups = new Map<string, HistoricalSession[]>()
  for (const s of sessions) {
    if (!s.prescription) continue
    const key = [s.patientId, s.prescription.exerciseVersionId, s.prescription.id, s.modelVersion, s.algorithmVersion].join('|')
    groups.set(key, [...(groups.get(key) ?? []), s])
  }
  const series = [...groups.entries()].flatMap(([base, rows]) => {
    const metrics = new Map(rows.flatMap((s) => s.measurements).map((m) => [`${m.key}|${m.side}`, m] as const))
    const ordered = [...rows].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.id.localeCompare(b.id))
    return [...metrics.values()].map((metric) => ({
      key: `${base}|${metric.key}|${metric.side}`, metric: metric.key, side: metric.side,
      model: rows[0]!.modelVersion, algorithm: rows[0]!.algorithmVersion, prescription: rows[0]!.prescription!,
      points: ordered.map((session) => {
        const measurement = session.measurements.find((m) => m.key === metric.key && m.side === metric.side) ?? null
        const value = measurement && session.status === 'completed' && chartable(measurement) ? rom(measurement) : null
        return { session, measurement, rom: value, repetitions: value === null ? null : measurement!.repetitions }
      }),
    }))
  })
  return series.sort((a, b) => a.prescription.exerciseName.localeCompare(b.prescription.exerciseName) || a.side.localeCompare(b.side)
    || a.prescription.assignmentId.localeCompare(b.prescription.assignmentId) || a.prescription.version - b.prescription.version || a.metric.localeCompare(b.metric))
}

type RawMeasurement = {
  metric_key: string; side: string; minimum_degrees: number | null; maximum_degrees: number | null; completed_repetitions: number
  incomplete_repetitions: number; quality: string; valid_frames: number; invalid_frames: number
}
export type RawSession = {
  id: string; patient_id: string; started_at: string; ended_at: string; status: string; model_version: string; algorithm_version: string
  prescription: {
    id: string; assignment_id: string; version: number; exercise_version_id: string; side: string; minimum_degrees: number
    maximum_degrees: number; target_repetitions: number; exercise: { algorithm_key: string; definition: unknown } | null
  } | null
  session_measurements: RawMeasurement[]
}

export function decodeSessions(rows: readonly RawSession[]): HistoricalSession[] {
  return rows.map((s): HistoricalSession => {
    const p = s.prescription
    const definition = (p?.exercise?.definition ?? {}) as Record<string, unknown>
    return {
      id: s.id, patientId: s.patient_id, startedAt: s.started_at, endedAt: s.ended_at, status: s.status, modelVersion: s.model_version, algorithmVersion: s.algorithm_version,
      prescription: p && {
        id: p.id, assignmentId: p.assignment_id, version: p.version, exerciseVersionId: p.exercise_version_id,
        exerciseName: typeof definition.name === 'string' ? definition.name : '', algorithm: p.exercise?.algorithm_key ?? '',
        side: p.side, low: p.minimum_degrees, high: p.maximum_degrees, targetRepetitions: p.target_repetitions,
      },
      measurements: s.session_measurements.map((m) => ({
        key: m.metric_key, side: m.side, minimum: m.minimum_degrees, maximum: m.maximum_degrees, repetitions: m.completed_repetitions,
        incomplete: m.incomplete_repetitions, quality: m.quality, validFrames: m.valid_frames, invalidFrames: m.invalid_frames,
      })),
    }
  })
}

export function decodeHistory(rows: readonly RawSession[]): HistoryPage {
  const sessions = decodeSessions(rows.slice(0, HISTORY_PAGE_SIZE))
  const last = sessions.at(-1)
  return { sessions, next: rows.length > HISTORY_PAGE_SIZE && last ? { startedAt: last.startedAt, id: last.id } : null }
}

/** A calendar day in the browser's time zone, so filters agree with the local times shown on screen. */
export function dayStart(date: string, addDays = 0) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year!, month! - 1, day! + addDays).toISOString()
}

/** One patient per query, in keyset pages, as on Android. */
export async function loadHistory(db: SupabaseClient<Database>, query: HistoryQuery, cursor?: HistoryCursor | null): Promise<HistoryPage> {
  // A side filter means the side measured, so each side of a both-sides plan files under its own side, as on Android.
  const select = query.side ? `${HISTORY_SELECT},measured:session_measurements!inner(side)` : HISTORY_SELECT
  let request = db.from('sessions').select(select).eq('patient_id', query.patientId)
    .order('started_at', { ascending: false }).order('id', { ascending: false }).limit(HISTORY_PAGE_SIZE + 1)
  if (query.exerciseVersionId) request = request.eq('prescription.exercise_version_id', query.exerciseVersionId)
  if (query.side) request = request.eq('measured.side', query.side)
  if (query.from) request = request.gte('started_at', dayStart(query.from))
  if (query.through) request = request.lt('started_at', dayStart(query.through, 1))
  if (cursor) request = request.or(`started_at.lt."${cursor.startedAt}",and(started_at.eq."${cursor.startedAt}",id.lt.${cursor.id})`)
  const { data, error } = await request
  if (error) throw error
  return decodeHistory(data as unknown as RawSession[])
}
