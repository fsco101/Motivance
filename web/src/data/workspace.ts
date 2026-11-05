import type { SupabaseClient } from '@supabase/supabase-js'
import { CATALOGUE_SELECT, decodeCatalogue } from './catalogue'
import type { Database } from './database.types'

type Db = SupabaseClient<Database>

export type Overview = {
  displayName: string
  sessions: Array<{ id: string; patientId: string; startedAt: string; status: string }>
}

export const must = <T>(result: { data: T | null; error: unknown }) => {
  if (result.error) throw result.error
  return result.data as T
}

/**
 * Therapist pages show linked patients only. Row-level security is not enough on its own, because it also lets someone who
 * is both administrator and therapist read every patient. Pair this with an inner join on therapist_patients.
 */
export const LINKED = 'patients!inner(therapist_patients!inner(therapist_id))'
export const linkedTo = (account: string, path = 'patients.therapist_patients') => ({ [`${path}.therapist_id`]: account, [`${path}.active`]: true })

export async function loadOverview(db: Db, account: string): Promise<Overview> {
  const [profile, sessions] = await Promise.all([
    db.from('profiles').select('display_name').eq('id', account).maybeSingle(),
    db.from('sessions').select(`id,patient_id,started_at,status,${LINKED}`).match(linkedTo(account)).order('started_at', { ascending: false }).limit(20),
  ])
  return {
    displayName: must(profile)?.display_name ?? '',
    sessions: must(sessions).map((row) => ({ id: row.id, patientId: row.patient_id, startedAt: row.started_at, status: row.status })),
  }
}

export type LinkedPatient = { id: string; name: string; photoUrl: string | null }

export async function loadPatients(db: Db, account: string): Promise<LinkedPatient[]> {
  const rows = must(await db.from('patients').select('id,profiles:profiles!patients_id_fkey(display_name,photo_url),therapist_patients!inner(therapist_id)').match(linkedTo(account, 'therapist_patients')))
  return rows.filter((row) => row.id !== account).map((row) => ({ id: row.id, name: row.profiles?.display_name ?? '', photoUrl: row.profiles?.photo_url ?? null }))
}

export async function loadCatalogue(db: Db, account: string) {
  const rows = must(await db.from('exercise_versions').select(CATALOGUE_SELECT).eq('published', true))
  return decodeCatalogue(rows, account)
}

export type PlanSummary = {
  assignmentId: string; versionId: string; patientId: string; therapistId: string; exerciseId: string; version: number
  side: string; low: number; high: number; repetitions: number; parameters: Record<string, unknown>
}

/** Each assignment's newest version, the one patients are working to. */
export async function loadPlans(db: Db, account: string): Promise<PlanSummary[]> {
  const rows = must(await db.from('exercise_assignments')
    .select(`id,patient_id,therapist_id,${LINKED},prescription_versions(id,version,exercise_version_id,side,minimum_degrees,maximum_degrees,target_repetitions,parameters)`)
    .eq('active', true).match(linkedTo(account)))
  return rows.flatMap((row) => {
    const latest = [...row.prescription_versions].sort((a, b) => b.version - a.version)[0]
    return latest ? [{
      assignmentId: row.id, versionId: latest.id, patientId: row.patient_id, therapistId: row.therapist_id, exerciseId: latest.exercise_version_id, version: latest.version, side: latest.side,
      low: latest.minimum_degrees, high: latest.maximum_degrees, repetitions: latest.target_repetitions, parameters: (latest.parameters ?? {}) as Record<string, unknown>,
    }] : []
  })
}
