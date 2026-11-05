import type { SupabaseClient } from '@supabase/supabase-js'
import type { Joint } from './catalogue'
import type { Database, Json } from './database.types'
import { HISTORY_SELECT, decodeSessions, type HistoricalSession, type RawSession } from './history'
import { linkedTo, must } from './workspace'

type Db = SupabaseClient<Database>

const USABLE_SELECT = HISTORY_SELECT.replace('session_measurements(', 'session_measurements!inner(')

/**
 * Each linked patient's latest sessions with a usable measurement, in one request, newest first. Asking per patient, and for
 * usable sessions only, matters: otherwise a busy patient, or a run of blocked camera sessions, would push real results out of
 * the request and the card would wrongly read "No sessions yet".
 */
export async function loadLatestSessions(db: Db, account: string, perPatient = 5): Promise<HistoricalSession[]> {
  const patients = must(await db.from('patients').select(`id,therapist_patients!inner(therapist_id),sessions!sessions_patient_id_fkey(${USABLE_SELECT})`)
    .match(linkedTo(account, 'therapist_patients'))
    .in('sessions.session_measurements.quality', ['valid', 'limited']).gt('sessions.session_measurements.valid_frames', 0)
    .order('started_at', { referencedTable: 'sessions', ascending: false }).order('id', { referencedTable: 'sessions', ascending: false })
    .limit(perPatient, { referencedTable: 'sessions' })) as unknown as Array<{ sessions: RawSession[] }>
  return decodeSessions(patients.flatMap((patient) => patient.sessions)).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
}

export type PatientProfile = { username: string; fullName: string; gender: string; birthdate: string; contact: string; address: string }

export async function loadPatientProfile(db: Db, patientId: string): Promise<PatientProfile | null> {
  const { data, error } = await db.from('patient_profiles').select('username,full_name,gender,birthdate,contact,address').eq('user_id', patientId).maybeSingle()
  if (error) throw error
  return data && { username: data.username, fullName: data.full_name, gender: data.gender, birthdate: data.birthdate, contact: data.contact, address: data.address }
}

export async function invitePatient(db: Db, email: string) {
  return (must(await db.rpc('invite_patient', { p_email: email })) as { code: string }).code
}

export async function revokePatientLink(db: Db, patientId: string) {
  must(await db.rpc('revoke_patient_link', { p_patient: patientId }))
}

export type PrescriptionDraft = {
  exerciseId: string; side: 'left' | 'right'; focus: Joint | null; low: number; high: number; repetitions: number
  minimumCycleMs: number; maximumCycleMs: number; peakHoldMs: number; maxTrunkLean: number; confidence: number
}
export type Timing = Pick<PrescriptionDraft, 'minimumCycleMs' | 'maximumCycleMs' | 'peakHoldMs' | 'maxTrunkLean'>

export const validRange = (low: number, high: number) => low >= 0 && high <= 180 && high > low + 10
export const validRepetitions = (count: number) => Number.isInteger(count) && count >= 1 && count <= 1000

const whole = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text) : Number.NaN)
const decimal = (text: string) => (text.trim() ? Number(text) : Number.NaN)

/** The server's limits, as on Android. Null until every field is right: a blank is a mistake, never zero, and it casts milliseconds to whole numbers. */
export function readTiming(text: { minimum: string; maximum: string; hold: string; lean: string }): Timing | null {
  const timing = { minimumCycleMs: whole(text.minimum), maximumCycleMs: whole(text.maximum), peakHoldMs: whole(text.hold), maxTrunkLean: decimal(text.lean) }
  const valid = timing.minimumCycleMs >= 100 && timing.minimumCycleMs <= 30000 && timing.maximumCycleMs > timing.minimumCycleMs && timing.maximumCycleMs <= 300000
    && timing.peakHoldMs >= 0 && timing.peakHoldMs <= 5000 && timing.maxTrunkLean >= 0 && timing.maxTrunkLean <= 90
  return valid ? timing : null
}

/** assignmentId names the plan, and requestId names this version of it, which makes a retry safe. */
export type PrescriptionRequest = PrescriptionDraft & { assignmentId: string; requestId: string; patientId: string }

/** The same parameters Android sends, so a prescription behaves the same whichever app published it. */
export async function publishPrescription(db: Db, request: PrescriptionRequest) {
  const parameters: Record<string, Json> = {
    minimum_cycle_ms: request.minimumCycleMs, maximum_cycle_ms: request.maximumCycleMs, peak_hold_ms: request.peakHoldMs,
    max_trunk_lean_degrees: request.maxTrunkLean, confidence: request.confidence,
  }
  if (request.focus) parameters.focus_joint = request.focus
  must(await db.rpc('publish_prescription', {
    p_assignment: request.assignmentId, p_version: request.requestId, p_patient: request.patientId, p_exercise: request.exerciseId, p_side: request.side,
    p_low: request.low, p_high: request.high, p_repetitions: request.repetitions, p_parameters: parameters,
  }))
}

export const NAME_LIMIT = 120
export const INSTRUCTIONS_LIMIT = 4000

export type CustomExerciseDraft = { id: string; name: string; joint: Joint; english: string; filipino: string }

export const validDraft = (draft: Omit<CustomExerciseDraft, 'id'>) => (
  draft.name.trim().length >= 1 && draft.name.trim().length <= NAME_LIMIT && draft.english.trim().length >= 1
  && draft.english.trim().length <= INSTRUCTIONS_LIMIT && draft.filipino.trim().length <= INSTRUCTIONS_LIMIT
)

/** Returns the published version to prescribe. */
export async function createCustomExercise(db: Db, draft: CustomExerciseDraft) {
  return must(await db.rpc('create_custom_exercise', {
    p_id: draft.id, p_name: draft.name.trim(), p_joint: draft.joint, p_english: draft.english.trim(), p_filipino: draft.filipino.trim() || undefined,
  })) as string
}

export async function archiveCustomExercise(db: Db, exerciseId: string) {
  must(await db.rpc('archive_custom_exercise', { p_exercise: exerciseId }))
}
