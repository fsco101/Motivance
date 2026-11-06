import type { SupabaseClient } from '@supabase/supabase-js'
import type { TFunction } from 'i18next'
import type { AdminAccount, AdminExercise, AdminLink, AdminSummary, AuditCategory, AuditEvent } from '@/features/admin/types'
import { CUSTOM_ALGORITHM } from './catalogue'
import type { Database } from './database.types'
import { must } from './workspace'

type Db = SupabaseClient<Database>

export const ACCOUNT_PAGE = 50
export const ACTIVITY_PAGE = 30
export const CATALOGUE_LIMIT = 500

type RawAccount = {
  id: string; display_name: string | null; active: boolean; email: string | null; username: string | null
  created_at: string | null; last_sign_in_at: string | null; photo_url: string | null; roles: AdminAccount['roles']
}

/** One page of the directory. The server returns one row more than a page, which is how we know another page exists. */
export async function loadAccounts(db: Db, search: string, after: string | null) {
  const rows = must(await db.rpc('admin_accounts', { p_after: after ?? undefined, p_search: search || undefined })) as unknown as RawAccount[]
  const accounts = rows.slice(0, ACCOUNT_PAGE).map((row): AdminAccount => ({
    id: row.id, name: row.display_name ?? '', email: row.email ?? '', username: row.username, active: row.active, roles: row.roles,
    joined: row.created_at, lastSignIn: row.last_sign_in_at, photo: row.photo_url,
  }))
  return { accounts, next: rows.length > ACCOUNT_PAGE ? accounts.at(-1)!.id : null }
}

export async function loadSummary(db: Db): Promise<AdminSummary> {
  const row = must(await db.rpc('admin_summary')) as Record<string, number>
  const count = (key: string) => row[key] ?? 0
  return {
    accounts: count('accounts'), disabled: count('disabled'), patients: count('patients'), therapists: count('therapists'), schedulers: count('schedulers'), admins: count('admins'),
    activeLinks: count('active_links'), unlinkedPatients: count('unlinked_patients'), exercises: count('exercises'), activeExercises: count('active_exercises'),
    sessionsWeek: count('sessions_week'), pendingRequests: count('pending_requests'),
  }
}

export async function loadLinks(db: Db): Promise<AdminLink[]> {
  const rows = must(await db.rpc('admin_links')) as unknown as Array<{ therapist_id: string; patient_id: string; active: boolean; therapist_name: string | null; patient_name: string | null }>
  return rows.map((row) => ({ therapist: row.therapist_id, therapistName: row.therapist_name ?? '', patient: row.patient_id, patientName: row.patient_name ?? '', active: row.active }))
}

type RawExercise = { id: string; code: string; active: boolean; exercise_versions: Array<{ version: number; algorithm_key: string; definition: unknown }> }

export function decodeExercises(rows: readonly RawExercise[]): AdminExercise[] {
  return rows.map((row) => {
    const latest = [...row.exercise_versions].sort((a, b) => b.version - a.version)[0]
    const definition = (latest?.definition ?? {}) as Record<string, unknown>
    const text = (key: string) => (typeof definition[key] === 'string' ? definition[key] : '')
    return {
      id: row.id, code: row.code, active: row.active, version: latest?.version ?? 0, name: text('name'), english: text('instructions_en'), filipino: text('instructions_fil'),
      custom: latest?.algorithm_key === CUSTOM_ALGORITHM,
    }
  })
}

/** Administrators read every exercise, including inactive ones and therapists' own, through their row policy. */
export async function loadAdminCatalogue(db: Db) {
  const rows = must(await db.from('exercises').select('id,code,active,exercise_versions(version,algorithm_key,definition)').order('code').limit(CATALOGUE_LIMIT))
  return decodeExercises(rows)
}

export type RawAudit = {
  id: number; action: string; target_type: string; target_id: string; recorded_at: string
  actor_id: string | null; actor_name: string | null; target_name: string | null; related_name: string | null
}

export async function loadActivity(db: Db, before: number | null) {
  const rows = must(await db.rpc('admin_activity', { p_before: before ?? undefined })) as unknown as RawAudit[]
  const events = rows.slice(0, ACTIVITY_PAGE)
  return { events, next: rows.length > ACTIVITY_PAGE ? events.at(-1)!.id : null }
}

/** Mirrors AuditEvent.category on Android. */
export function auditCategory(targetType: string): AuditCategory {
  if (['profiles', 'user_roles', 'patient_profiles'].includes(targetType)) return 'accounts'
  if (['therapist_patients', 'patient_invitations'].includes(targetType)) return 'links'
  if (['exercises', 'exercise_versions'].includes(targetType)) return 'catalogue'
  if (['consents', 'data_requests'].includes(targetType)) return 'privacy'
  if (targetType === 'bookings') return 'bookings'
  return 'clinical'
}

export const KINDS: Record<string, string> = {
  'profiles:enable': 'accountEnabled', 'profiles:disable': 'accountDisabled', 'profiles:update_photo': 'photoUpdated', 'profiles:remove_photo': 'photoRemoved',
  'patient_profiles:update_profile': 'profileUpdated', 'user_roles:insert': 'roleGranted', 'user_roles:delete': 'roleRemoved', 'user_roles:update': 'roleChanged',
  'therapist_patients:insert': 'linkCreated', 'therapist_patients:update': 'linkUpdated', 'patient_invitations:invite': 'invitation', 'exercises:activate': 'exerciseActivated',
  'exercises:deactivate': 'exerciseDeactivated', 'exercise_versions:publish': 'versionPublished', 'prescription_versions:insert': 'prescription', 'sessions:insert': 'session',
  'consents:insert': 'consent', 'data_requests:insert': 'requestCreated', 'data_requests:update': 'requestUpdated', 'bookings:requested': 'bookingRequested', 'bookings:confirmed': 'bookingConfirmed',
  'bookings:rejected': 'bookingRejected', 'bookings:cancelled': 'bookingCancelled', 'bookings:rescheduled': 'bookingRescheduled', 'bookings:returned_to_pending': 'bookingReturned',
  'bookings:therapist_changed': 'bookingTherapist', 'bookings:attendance_marked': 'bookingAttendance', 'bookings:export': 'bookingExported',
}

/** Mirrors AuditEvent.kind on Android. */
export const auditKind = (targetType: string, action: string) => KINDS[`${targetType}:${action}`] ?? 'other'

const shortId = (id: string) => id.slice(0, 8)

/** The same wording as Android: names where the server resolved them, and a short reference otherwise. */
export function describeEvent(row: RawAudit, t: TFunction): AuditEvent {
  const category = auditCategory(row.target_type)
  const reference = () => t('admin.eventReference', { reference: shortId(row.target_id) })
  const [therapist = '', patient = ''] = row.target_id.split(':')
  const target = category === 'accounts' ? row.target_name || shortId(row.target_id)
    : row.target_type === 'bookings' && row.action === 'export' ? t('admin.eventExport', { format: therapist.toUpperCase(), rows: patient })
    : category === 'bookings' ? row.target_name || reference()
    : category === 'links' && row.target_type === 'therapist_patients' ? t('admin.eventLink', { therapist: row.target_name || shortId(therapist), patient: row.related_name || shortId(patient) })
      : reference()
  return {
    id: row.id, kind: auditKind(row.target_type, row.action), category, target, recordedAt: row.recorded_at,
    actor: row.actor_id === null ? null : row.actor_name || shortId(row.actor_id),
  }
}

export const setAccount = async (db: Db, user: string, active: boolean) => { must(await db.rpc('admin_set_account', { p_user: user, p_active: active })) }
export const setRole = async (db: Db, user: string, role: string, granted: boolean) => { must(await db.rpc('admin_set_role', { p_user: user, p_role: role, p_granted: granted })) }
export const clearPhoto = async (db: Db, user: string) => { must(await db.rpc('admin_clear_photo', { p_user: user })) }
export const setLink = async (db: Db, therapist: string, patient: string, active: boolean) => { must(await db.rpc('admin_set_link', { p_therapist: therapist, p_patient: patient, p_active: active })) }
export const setExercise = async (db: Db, exercise: string, active: boolean) => { must(await db.rpc('admin_set_exercise', { p_exercise: exercise, p_active: active })) }
export const publishExercise = async (db: Db, exercise: string, name: string, english: string, filipino: string) => {
  must(await db.rpc('admin_publish_exercise', { p_exercise: exercise, p_name: name, p_english: english, p_filipino: filipino }))
}
