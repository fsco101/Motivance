import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { must } from './workspace'

type Db = SupabaseClient<Database>

/**
 * A patient's own records. Row-level security alone is not enough here, because it also lets an administrator read every
 * patient, and an administrator can open this workspace for their own care. So every read below filters to one account.
 */

export type MyExercise = {
  assignmentId: string; versionId: string; exerciseVersionId: string; name: string; instructions: string; side: string
  low: number; high: number; repetitions: number; focus: string | null; version: number
}

const PLAN_SELECT = 'id,prescription_versions(id,version,parameters,side,minimum_degrees,maximum_degrees,target_repetitions,exercise_versions(id,algorithm_key,definition))'

type RawVersion = {
  id: string; version: number; parameters: unknown; side: string; minimum_degrees: number; maximum_degrees: number; target_repetitions: number
  exercise_versions: { id: string; algorithm_key: string; definition: unknown } | null
}
export type RawPlan = { id: string; prescription_versions: readonly RawVersion[] }

const text = (value: unknown) => (typeof value === 'string' ? value : '')

/** Only each assignment's newest version counts, the one the patient is working to. */
export function decodeExercises(rows: readonly RawPlan[], language: string): MyExercise[] {
  return rows.flatMap((row) => {
    const latest = [...row.prescription_versions].sort((a, b) => b.version - a.version)[0]
    if (!latest?.exercise_versions) return []
    const definition = (latest.exercise_versions.definition ?? {}) as Record<string, unknown>
    const parameters = (latest.parameters ?? {}) as Record<string, unknown>
    const english = text(definition.instructions_en)
    return [{
      assignmentId: row.id, versionId: latest.id, exerciseVersionId: latest.exercise_versions.id, name: text(definition.name) || latest.exercise_versions.algorithm_key,
      // A therapist's own exercise may have instructions in only one language, so one is never left blank.
      instructions: language === 'fil' ? text(definition.instructions_fil) || english : english,
      side: latest.side, low: latest.minimum_degrees, high: latest.maximum_degrees, repetitions: latest.target_repetitions,
      focus: text(parameters.focus_joint) || null, version: latest.version,
    }]
  })
}

export async function loadMyExercises(db: Db, account: string, language: string) {
  const rows = must(await db.from('exercise_assignments').select(PLAN_SELECT).eq('active', true).eq('patient_id', account))
  return decodeExercises(rows as unknown as RawPlan[], language)
}

export type RecentSession = { id: string; startedAt: string; status: string }

export async function loadMySessions(db: Db, account: string): Promise<RecentSession[]> {
  const rows = must(await db.from('sessions').select('id,started_at,status').eq('patient_id', account).order('started_at', { ascending: false }).limit(30))
  return rows.map((row) => ({ id: row.id, startedAt: row.started_at, status: row.status }))
}

/** Monday to Sunday of the week holding `today`, each marked if a session was completed that day. */
export function thisWeek(sessions: readonly RecentSession[], today: Date) {
  const key = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
  const done = new Set(sessions.filter((session) => session.status === 'completed').map((session) => key(new Date(session.startedAt))))
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7))
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index)
    return { day, done: done.has(key(day)) }
  })
}

export type ConsentState = 'granted' | 'withdrawn' | null

/** The newest movement-summary event. Android records grants, and the web can withdraw one. */
export async function loadConsent(db: Db, account: string): Promise<ConsentState> {
  const rows = must(await db.from('consents').select('event').eq('patient_id', account).eq('consent_type', 'movement-summary').order('occurred_at', { ascending: false }).limit(1))
  return (rows[0]?.event as ConsentState | undefined) ?? null
}

export async function withdrawConsent(db: Db) {
  must(await db.rpc('record_consent', { p_id: crypto.randomUUID(), p_event: 'withdrawn', p_version: 'movement-summary-v1', p_occurred_at: new Date().toISOString() }))
}

export type DataRequestKind = 'export' | 'delete'
export type DataRequest = { id: string; kind: DataRequestKind; status: 'requested' | 'fulfilled' | 'declined'; createdAt: string }

export async function loadDataRequests(db: Db, account: string): Promise<DataRequest[]> {
  const rows = must(await db.from('data_requests').select('id,kind,status,created_at').eq('patient_id', account).order('created_at', { ascending: false }))
  return rows.map((row) => ({ id: row.id, kind: row.kind as DataRequestKind, status: row.status as DataRequest['status'], createdAt: row.created_at }))
}

export async function requestData(db: Db, kind: DataRequestKind) {
  must(await db.rpc('request_patient_data', { p_id: crypto.randomUUID(), p_kind: kind }))
}

export const validInvitation = (code: string) => /^[a-fA-F0-9]{48}$/.test(code.trim())

export async function joinTherapist(db: Db, code: string) {
  must(await db.rpc('accept_patient_invitation', { p_code: code.trim() }))
}
