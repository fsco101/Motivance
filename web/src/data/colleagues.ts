import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

type Db = SupabaseClient<Database>

/**
 * Therapist colleagues (#173): two therapists linked so each can follow the progress of the other's patients, read-only. A patient
 * is seen only if they turned on "Let my therapist's colleagues see my progress". Opening one is recorded in the audit trail, and
 * the server lets a colleague's reads through only for 30 minutes after that.
 */
export type ColleagueState = 'requested' | 'active'
export type Colleague = { id: string; state: ColleagueState; incoming: boolean; otherId: string; name: string; photo: string | null; createdAt: string; startedAt: string | null }
export type ColleaguePatient = { id: string; name: string; photo: string | null; therapistId: string; therapistName: string }
export type ColleagueAccess = { sharing: boolean; colleagues: Array<{ id: string; name: string; photo: string | null; lastViewedAt: string | null }> }
export type ColleagueLink = { id: string; state: ColleagueState; firstId: string; firstName: string; secondId: string; secondName: string; createdAt: string; startedAt: string | null }

type RawColleague = { id: string; state: ColleagueState; incoming: boolean; other_id: string; other_name: string | null; other_photo: string | null; created_at: string; started_at: string | null }

const rpc = async <T>(db: Db, name: string, args?: Record<string, unknown>) => {
  const { data, error } = await (db.rpc as unknown as (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: Error | null }>)(name, args)
  if (error) throw error
  return data as T
}

export const decodeColleague = (row: RawColleague): Colleague => ({
  id: row.id, state: row.state, incoming: row.incoming, otherId: row.other_id, name: row.other_name ?? '', photo: row.other_photo, createdAt: row.created_at, startedAt: row.started_at,
})

export const loadColleagues = async (db: Db) => (await rpc<RawColleague[]>(db, 'my_colleagues')).map(decodeColleague)
export const inviteColleague = async (db: Db, email: string) => decodeColleague(await rpc<RawColleague>(db, 'invite_colleague', { p_email: email.trim() }))
export const respondColleague = async (db: Db, id: string, accept: boolean) => decodeColleague(await rpc<RawColleague>(db, 'respond_colleague', { p_link: id, p_accept: accept }))
export const endColleague = async (db: Db, id: string) => { await rpc(db, 'end_colleague', { p_link: id }) }

export async function loadColleaguePatients(db: Db): Promise<ColleaguePatient[]> {
  const rows = await rpc<Array<{ id: string; name: string | null; photo: string | null; therapist_id: string; therapist_name: string | null }>>(db, 'colleague_patients')
  return rows.map((row) => ({ id: row.id, name: row.name ?? '', photo: row.photo, therapistId: row.therapist_id, therapistName: row.therapist_name ?? '' }))
}

/** Must come before any read of the patient's progress: it is what the server audits, and what lets the reads through. */
export async function openColleaguePatient(db: Db, patientId: string) {
  const row = await rpc<{ id: string; name: string | null; photo: string | null; therapists: string[] }>(db, 'open_colleague_patient', { p_patient: patientId })
  return { id: row.id, name: row.name ?? '', photo: row.photo, therapists: row.therapists }
}

export async function loadColleagueAccess(db: Db, patientId: string): Promise<ColleagueAccess> {
  const row = await rpc<{ sharing: boolean; colleagues: Array<{ id: string; name: string | null; photo: string | null; last_viewed_at: string | null }> }>(db, 'patient_colleague_access', { p_patient: patientId })
  return { sharing: row.sharing, colleagues: row.colleagues.map((c) => ({ id: c.id, name: c.name ?? '', photo: c.photo, lastViewedAt: c.last_viewed_at })) }
}

/** The patient's own choice, off until they turn it on. */
export const loadColleagueSharing = async (db: Db) => (await rpc<{ granted: boolean }>(db, 'my_colleague_sharing')).granted
export const setColleagueSharing = async (db: Db, granted: boolean) => (await rpc<{ granted: boolean }>(db, 'set_colleague_sharing', { p_granted: granted })).granted

export async function loadColleagueLinks(db: Db): Promise<ColleagueLink[]> {
  const { data, error } = await db.rpc('admin_colleague_links')
  if (error) throw error
  const rows = data as unknown as Array<{ id: string; state: ColleagueState; first_id: string; first_name: string | null; second_id: string; second_name: string | null; created_at: string; started_at: string | null }>
  return rows.map((row) => ({ id: row.id, state: row.state, firstId: row.first_id, firstName: row.first_name ?? '', secondId: row.second_id, secondName: row.second_name ?? '', createdAt: row.created_at, startedAt: row.started_at }))
}
export async function setColleagues(db: Db, first: string, second: string, active: boolean) {
  const { error } = await db.rpc('admin_set_colleagues', { p_first: first, p_second: second, p_active: active })
  if (error) throw error
}

/** The server's refusals, in the reader's words. */
export function colleagueFailureKey(error: unknown) {
  const message = (error as { message?: string } | null)?.message ?? ''
  for (const code of ['colleague_not_found', 'colleague_self', 'colleague_exists', 'colleague_state', 'colleague_unavailable']) if (message.includes(code)) return `colleagues.errors.${code.slice('colleague_'.length)}`
  return null
}

export type ColleaguePlanItem = { assignmentId: string; exercise: string; side: string; low: number; high: number; repetitions: number; version: number }

/** The plan a colleague may read: each active exercise at its newest version. Only after openColleaguePatient. */
export async function loadColleaguePlan(db: Db, patientId: string): Promise<ColleaguePlanItem[]> {
  const { data, error } = await db.from('exercise_assignments')
    .select('id,prescription_versions(version,side,minimum_degrees,maximum_degrees,target_repetitions,exercise:exercise_versions(definition))')
    .eq('patient_id', patientId).eq('active', true)
  if (error) throw error
  return (data as unknown as Array<{ id: string; prescription_versions: Array<{ version: number; side: string; minimum_degrees: number; maximum_degrees: number; target_repetitions: number; exercise: { definition: { name?: unknown } } | null }> }>)
    .flatMap((row) => {
      const latest = [...row.prescription_versions].sort((a, b) => b.version - a.version)[0]
      if (!latest) return []
      const name = latest.exercise?.definition?.name
      return [{ assignmentId: row.id, exercise: typeof name === 'string' ? name : '', side: latest.side, low: latest.minimum_degrees, high: latest.maximum_degrees, repetitions: latest.target_repetitions, version: latest.version }]
    })
}
