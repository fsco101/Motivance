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
