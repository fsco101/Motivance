import type { SupabaseClient } from '@supabase/supabase-js'
import type { ExerciseRules } from '@/features/exercise/assessment'
import { prescribedRules, type RawPrescription } from '@/features/exercise/session/rules'
import type { sessionPayload } from '@/features/exercise/session/payload'
import type { Database, Json } from './database.types'
import { decodeExercises, type RawPlan } from './patient'
import { must } from './workspace'

type Db = SupabaseClient<Database>

const SELECT = 'id,prescription_versions(id,version,parameters,side,minimum_degrees,maximum_degrees,target_repetitions,exercise_versions(id,algorithm_key,definition))'
type Row = { id: string; prescription_versions: Array<RawPrescription & { version: number }> }

export type SessionExercise = { rules: ExerciseRules; assignmentId: string; name: string; instructions: string }

/**
 * The rules for one of the patient's active exercises, read as Android reads them. Only the assignment's newest version
 * can be measured, as on the phone, so an older link finds nothing.
 */
export async function loadSessionRules(db: Db, account: string, versionId: string, language = 'en'): Promise<SessionExercise | null> {
  const rows = must(await db.from('exercise_assignments').select(SELECT).eq('active', true).eq('patient_id', account)) as unknown as Row[]
  for (const row of rows) {
    const latest = [...row.prescription_versions].sort((a, b) => b.version - a.version)[0]
    if (latest?.id !== versionId) continue
    const rules = prescribedRules(latest)
    const shown = decodeExercises([row as unknown as RawPlan], language)[0]
    return rules && shown ? { rules, assignmentId: row.id, name: shown.name, instructions: shown.instructions } : null
  }
  return null
}

/** A new movement-summary grant, recorded when the patient starts a session with saving allowed, as on Android. */
export async function grantConsent(db: Db, at = new Date()) {
  const id = crypto.randomUUID()
  must(await db.rpc('record_consent', { p_id: id, p_event: 'granted', p_version: 'movement-summary-v1', p_occurred_at: at.toISOString() }))
  return { id, occurredAt: at.getTime() }
}

/** Saves a finished session. Sending the same session again returns duplicate instead of saving it twice. */
export async function saveSession(db: Db, payload: ReturnType<typeof sessionPayload>): Promise<{ duplicate: boolean }> {
  const result = must(await db.rpc('ingest_session', { p_payload: payload as unknown as Json })) as { duplicate?: boolean } | null
  return { duplicate: result?.duplicate === true }
}
