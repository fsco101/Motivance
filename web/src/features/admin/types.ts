export type AdminSummary = {
  accounts: number; disabled: number; patients: number; therapists: number; schedulers: number; admins: number; activeLinks: number
  unlinkedPatients: number; exercises: number; activeExercises: number; sessionsWeek: number; pendingRequests: number
}

export type StaffRole = 'therapist' | 'scheduler' | 'admin'

export type AdminAccount = {
  id: string; name: string; email: string; username?: string | null; active: boolean; roles: ReadonlyArray<'patient' | StaffRole>
  joined?: string | null; lastSignIn?: string | null; photo?: string | null
}

export type AdminLink = { therapist: string; therapistName: string; therapistPhoto: string | null; patient: string; patientName: string; patientPhoto: string | null; active: boolean }

export type AdminExercise = { id: string; code: string; active: boolean; version: number; name: string; english: string; filipino: string; custom: boolean }

export type AuditCategory = 'accounts' | 'links' | 'catalogue' | 'clinical' | 'privacy' | 'bookings'

export type AuditEvent = {
  id: number; kind: string; category: AuditCategory; target: string; actor: string | null; actorPhoto: string | null; recordedAt: string
}

/** Mirrors AdminAccount.primaryRole on Android, used for grouping and badges. */
export const primaryRole = (account: AdminAccount) => (['admin', 'scheduler', 'therapist'] as const).find((role) => account.roles.includes(role)) ?? 'patient'

const ROLE_LABELS = { admin: 'admin.roleAdmin', scheduler: 'admin.roleScheduler', therapist: 'admin.roleTherapist', patient: 'admin.rolePatient' } as const
export const roleLabel = (role: AdminAccount['roles'][number]) => ROLE_LABELS[role]

export const label = (account: AdminAccount) => account.name || account.email || account.id.slice(0, 8)

/** How the backend is doing, from admin_backend(): sizes against the plan's limits, queues, jobs and daily activity. */
export type BackendStatus = {
  generatedAt: string
  plan: { name: string; databaseBytes: number; storageBytes: number }
  database: { bytes: number; tables: ReadonlyArray<{ name: string; bytes: number }> }
  storage: { bytes: number; files: number; buckets: ReadonlyArray<{ bucket: string; files: number; bytes: number }> }
  deliveries: { waiting: number; oldestWaiting: string | null; failedWeek: number; sentDay: number }
  accounts: { signedInWeek: number; newWeek: number; devices: number }
  activity: ReadonlyArray<{ day: string; sessions: number; messages: number; bookings: number; accounts: number }>
  /** Null when the scheduler cannot be read, which the page says rather than showing no jobs. */
  jobs: ReadonlyArray<{ name: string; schedule: string; lastStatus: string | null; lastRun: string | null; failuresDay: number }> | null
}
