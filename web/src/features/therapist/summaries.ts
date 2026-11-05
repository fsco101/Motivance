import type { CatalogueExercise } from '@/data/catalogue'
import { rehabilitationProgress, roundDegrees, usable, type HistoricalSession, type ProgressSeries } from '@/data/history'
import type { LinkedPatient, PlanSummary } from '@/data/workspace'
import type { PatientSummary } from './PatientTable'
import type { FanSession } from './SessionFan'
import type { TrendPoint } from './TrendChart'

export const nameOf = (patient: Pick<LinkedPatient, 'id' | 'name'>) => patient.name || patient.id.slice(0, 8)

/** The newest session with a measurement worth showing. Failed tracking must never reach a dial. */
function latestUsable(sessions: readonly HistoricalSession[], patientId: string) {
  for (const session of sessions) {
    if (session.patientId !== patientId || !session.prescription) continue
    const measurement = session.measurements.find(usable)
    if (measurement) return { session, prescription: session.prescription, measurement }
  }
  return null
}

export const reachedBy = (measurement: { minimum: number | null; maximum: number | null }) => [roundDegrees(measurement.minimum!), roundDegrees(measurement.maximum!)] as const

/** One card per patient. `sessions` must be newest first. */
export function summarisePatients(patients: readonly LinkedPatient[], plans: readonly PlanSummary[], catalogue: readonly CatalogueExercise[], sessions: readonly HistoricalSession[]): PatientSummary[] {
  return patients.map((patient) => {
    const own = plans.filter((plan) => plan.patientId === patient.id)
    const seen = latestUsable(sessions, patient.id)
    const plan = own[0]
    const latest = seen
      ? { exercise: seen.prescription.exerciseName, low: seen.prescription.low, high: seen.prescription.high, reached: reachedBy(seen.measurement), when: seen.session.startedAt }
      : plan ? { exercise: catalogue.find((item) => item.id === plan.exerciseId)?.name ?? '', low: plan.low, high: plan.high, reached: null, when: null } : null
    return { id: patient.id, name: nameOf(patient), photo: patient.photoUrl, plans: own.length, latest }
  })
}

/** The fan shows each patient once, newest first, and at most `limit` rings stay readable. */
export function latestMovement(patients: readonly LinkedPatient[], sessions: readonly HistoricalSession[], limit = 6): FanSession[] {
  const rings: FanSession[] = []
  for (const session of sessions) {
    if (rings.length === limit) break
    if (rings.some((ring) => ring.patientId === session.patientId)) continue
    const patient = patients.find((item) => item.id === session.patientId)
    const measurement = session.measurements.find(usable)
    if (!patient || !session.prescription || !measurement) continue
    rings.push({
      id: session.id, patientId: patient.id, patient: nameOf(patient), photo: patient.photoUrl, exercise: session.prescription.exerciseName,
      low: session.prescription.low, high: session.prescription.high, reached: reachedBy(measurement),
    })
  }
  return rings
}

/** The record shows one series, the one the patient worked on last. Exercises, sides and versions never share a line. */
export function latestSeries(sessions: readonly HistoricalSession[]) {
  const last = (series: ProgressSeries) => Math.max(...series.points.map((point) => Date.parse(point.session.startedAt)))
  return rehabilitationProgress(sessions).reduce<ProgressSeries | null>((best, series) => (!best || last(series) > last(best) ? series : best), null)
}

export const romPoints = (series: ProgressSeries, label: (iso: string) => string): TrendPoint[] => series.points.map((point) => (
  { id: point.session.id, label: label(point.session.startedAt), value: point.rom === null ? null : roundDegrees(point.rom) }
))

export function recentFirst(summaries: readonly PatientSummary[]) {
  return [...summaries].sort((a, b) => (b.latest?.when ?? '').localeCompare(a.latest?.when ?? '') || a.name.localeCompare(b.name))
}
