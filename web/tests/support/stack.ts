import { execFileSync, execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/data/database.types'

/** Disposable synthetic accounts on the local stack only, removed again after each suite. */
type Status = { API_URL: string; ANON_KEY: string; SERVICE_ROLE_KEY: string }

let cached: Status | undefined
export function stack(): Status {
  if (!cached) {
    const raw = execSync('npx --yes supabase@2.20.12 status -o json', { cwd: '..', encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh' })
    cached = JSON.parse(raw) as Status
    if (!/^http:\/\/(127\.0\.0\.1|localhost):54321/.test(cached.API_URL)) throw new Error('Local stack only')
  }
  return cached
}

export function sql(statement: string) {
  return execFileSync('docker', ['exec', '-i', 'supabase_db_motivance', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], { input: statement, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim()
}

export type TestUser = { id: string; email: string; password: string }
export type Role = 'patient' | 'therapist' | 'scheduler' | 'admin'

export const client = () => createClient<Database>(stack().API_URL, stack().ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

async function admin(path: string, body: unknown) {
  const { API_URL, SERVICE_ROLE_KEY } = stack()
  const response = await fetch(`${API_URL}${path}`, { method: 'POST', headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`${path} failed with ${response.status}`)
  return response.json() as Promise<Record<string, unknown>>
}

export async function createUser(roles: readonly Role[], name = 'Synthetic Person'): Promise<TestUser> {
  const email = `motivance-web-${randomUUID()}@example.test`
  const password = `${randomUUID()}Aa!9`
  const created = await admin('/auth/v1/admin/users', { email, password, email_confirm: true })
  const id = String(created.id)
  const values = roles.map((role) => `('${id}','${role}')`).join(',')
  sql(`delete from public.user_roles where user_id='${id}'; insert into public.user_roles(user_id,role) values${values}; update public.profiles set display_name='${name}' where id='${id}';`)
  return { id, email, password }
}

export async function recoveryCode(email: string) {
  const link = await admin('/auth/v1/admin/generate_link', { type: 'recovery', email })
  return String(link.email_otp)
}

export async function signedIn(user: TestUser) {
  const db = client()
  const { error } = await db.auth.signInWithPassword({ email: user.email, password: user.password })
  if (error) throw error
  return db
}

export async function link(therapist: TestUser, patient: TestUser) {
  const staff = await signedIn(therapist)
  const invite = await staff.rpc('invite_patient', { p_email: patient.email })
  if (invite.error) throw invite.error
  const person = await signedIn(patient)
  const accepted = await person.rpc('accept_patient_invitation', { p_code: (invite.data as { code: string }).code })
  if (accepted.error) throw accepted.error
}

export async function acceptInvitation(patient: TestUser, code: string) {
  const person = await signedIn(patient)
  const accepted = await person.rpc('accept_patient_invitation', { p_code: code })
  if (accepted.error) throw accepted.error
}

type SessionFixture = {
  kind: string; side: string; low: number; high: number; target: number; focusJoint: string
  min: number; max: number; completed: number; valid?: number; invalid?: number
}

/** Uploads a session the way the phone does, through the same database function. */
export async function ingestSession(patient: TestUser, prescription: string, session: SessionFixture) {
  const person = await signedIn(patient)
  const { data: version } = await person.from('prescription_versions').select('exercise_version_id').eq('id', prescription).single()
  const now = Date.now()
  const grant = randomUUID()
  const consent = await person.rpc('record_consent', { p_id: grant, p_event: 'granted', p_version: 'movement-summary-v1', p_occurred_at: new Date(now - 30_000).toISOString() })
  if (consent.error) throw consent.error
  const uploaded = await person.rpc('ingest_session', {
    p_payload: {
      schemaVersion: 2, sessionId: randomUUID(), ownerId: patient.id, consentId: grant, startedAt: now - 20_000, endedAt: now - 10_000,
      rules: {
        kind: session.kind, side: session.side, low: session.low, high: session.high, target: session.target, focusJoint: session.focusJoint, confidence: 0.7, stableFrames: 5, minimumCycleMs: 600,
        maximumCycleMs: 30000, peakHoldMs: 100, maxTrunkLean: 20, maxSpeed: 600, version: version!.exercise_version_id, prescription, demo: false,
      },
      metrics: { time: 1000, angle: 10, min: session.min, max: session.max, completed: session.completed, incomplete: 0, duration: 1000, valid: session.valid ?? 40, invalid: session.invalid ?? 2, reasons: {} },
    },
  })
  if (uploaded.error) throw uploaded.error
}

export function removeUsers(users: readonly TestUser[]) {
  if (users.length === 0) return
  const ids = users.map((user) => `'${user.id}'`).join(',')
  // Scoped fixture cleanup; immutable-history triggers are bypassed only in this admin transaction.
  sql(`begin; set local session_replication_role=replica;
delete from public.audit_events where target_type='bookings' and target_id in (select id::text from public.bookings where patient_id in (${ids}) or therapist_id in (${ids}));
delete from public.booking_events where booking_id in (select id from public.bookings where patient_id in (${ids}) or therapist_id in (${ids}));
delete from public.bookings where patient_id in (${ids}) or therapist_id in (${ids});
delete from public.session_measurements where session_id in (select id from public.sessions where patient_id in (${ids}));
delete from public.sessions where patient_id in (${ids}); delete from public.consents where patient_id in (${ids});
delete from public.prescription_versions where patient_id in (${ids}); delete from public.exercise_assignments where patient_id in (${ids});
delete from public.exercise_versions where exercise_id in (select id from public.exercises where owner_id in (${ids}));
delete from public.exercises where owner_id in (${ids});
delete from public.patient_invitations where therapist_id in (${ids});
delete from public.therapist_patients where therapist_id in (${ids}) or patient_id in (${ids});
delete from public.audit_events where actor_id in (${ids}) or target_id in (${ids});
delete from public.patient_profiles where user_id in (${ids}); delete from public.patients where id in (${ids}); delete from public.user_roles where user_id in (${ids});
delete from public.profiles where id in (${ids}); delete from auth.users where id in (${ids}); commit;`)
}
