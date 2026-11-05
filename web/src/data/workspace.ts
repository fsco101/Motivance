import type { SupabaseClient } from '@supabase/supabase-js'
import { CATALOGUE_SELECT, decodeCatalogue } from './catalogue'
import type { Database } from './database.types'

type Db = SupabaseClient<Database>

export type Overview = {
  displayName: string
  patientIds: string[]
  sessions: Array<{ id: string; patientId: string; startedAt: string; status: string }>
  assignments: Array<{ id: string; patientId: string }>
}

const must = <T>(result: { data: T | null; error: unknown }) => {
  if (result.error) throw result.error
  return result.data as T
}

/** Mirrors loadOverview on Android: row-level security decides what comes back. */
export async function loadOverview(db: Db, account: string): Promise<Overview> {
  const [profile, patients, sessions, assignments] = await Promise.all([
    db.from('profiles').select('display_name').eq('id', account).maybeSingle(),
    db.from('patients').select('id'),
    db.from('sessions').select('id,patient_id,started_at,status').order('started_at', { ascending: false }).limit(20),
    db.from('exercise_assignments').select('id,patient_id').eq('active', true),
  ])
  return {
    displayName: must(profile)?.display_name ?? '',
    patientIds: must(patients).map((row) => row.id).filter((id) => id !== account),
    sessions: must(sessions).map((row) => ({ id: row.id, patientId: row.patient_id, startedAt: row.started_at, status: row.status })),
    assignments: must(assignments).map((row) => ({ id: row.id, patientId: row.patient_id })),
  }
}

export type LinkedPatient = { id: string; name: string; photoUrl: string | null }

export async function loadPatients(db: Db, account: string): Promise<LinkedPatient[]> {
  const rows = must(await db.from('patients').select('id,profiles:profiles!patients_id_fkey(display_name,photo_url)'))
  return rows.filter((row) => row.id !== account).map((row) => ({ id: row.id, name: row.profiles?.display_name ?? '', photoUrl: row.profiles?.photo_url ?? null }))
}

export async function loadCatalogue(db: Db, account: string) {
  const rows = must(await db.from('exercise_versions').select(CATALOGUE_SELECT).eq('published', true))
  return decodeCatalogue(rows, account)
}

export type PlanSummary = {
  assignmentId: string; versionId: string; patientId: string; exerciseId: string; version: number
  side: string; low: number; high: number; repetitions: number; parameters: Record<string, unknown>
}

/** Each assignment's newest version, the one patients are working to. */
export async function loadPlans(db: Db): Promise<PlanSummary[]> {
  const rows = must(await db.from('exercise_assignments')
    .select('id,patient_id,prescription_versions(id,version,exercise_version_id,side,minimum_degrees,maximum_degrees,target_repetitions,parameters)')
    .eq('active', true))
  return rows.flatMap((row) => {
    const latest = [...row.prescription_versions].sort((a, b) => b.version - a.version)[0]
    return latest ? [{
      assignmentId: row.id, versionId: latest.id, patientId: row.patient_id, exerciseId: latest.exercise_version_id, version: latest.version, side: latest.side,
      low: latest.minimum_degrees, high: latest.maximum_degrees, repetitions: latest.target_repetitions, parameters: (latest.parameters ?? {}) as Record<string, unknown>,
    }] : []
  })
}
