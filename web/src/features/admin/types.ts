export type AdminSummary = {
  accounts: number; disabled: number; patients: number; therapists: number; admins: number; activeLinks: number
  unlinkedPatients: number; exercises: number; activeExercises: number; sessionsWeek: number; pendingRequests: number
}

export type StaffRole = 'therapist' | 'admin'

export type AdminAccount = {
  id: string; name: string; email: string; username?: string | null; active: boolean; roles: ReadonlyArray<'patient' | StaffRole>
  joined?: string | null; lastSignIn?: string | null; photo?: string | null
}

export type AdminLink = { therapist: string; therapistName: string; patient: string; patientName: string; active: boolean }

export type AdminExercise = { id: string; code: string; active: boolean; version: number; name: string; english: string; filipino: string; custom: boolean }

export type AuditCategory = 'accounts' | 'links' | 'catalogue' | 'clinical' | 'privacy'

export type AuditEvent = {
  id: number; kind: string; category: AuditCategory; target: string; actor: string | null; recordedAt: string
}

/** Mirrors AdminAccount.primaryRole on Android, used for grouping and badges. */
export const primaryRole = (account: AdminAccount) => (account.roles.includes('admin') ? 'admin' : account.roles.includes('therapist') ? 'therapist' : 'patient')

export const label = (account: AdminAccount) => account.name || account.email || account.id.slice(0, 8)
