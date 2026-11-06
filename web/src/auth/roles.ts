export type Role = 'admin' | 'scheduler' | 'therapist' | 'patient'
/** The workspaces that exist on the web. Patients use the Android app, because exercises need the camera. */
export type Workspace = 'admin' | 'scheduler' | 'therapist'

const ORDER: readonly Role[] = ['admin', 'scheduler', 'therapist', 'patient']

/**
 * Every account starts as a patient, so staff also hold that role: the most senior role decides where they land.
 * Mirrors UserSession.primaryRole on Android.
 */
export function primaryRole(roles: readonly Role[]): Role | null {
  return ORDER.find((role) => roles.includes(role)) ?? null
}

export const workspacePath = (workspace: Workspace) => `/${workspace}`

export function workspacesOf(roles: readonly Role[]): Workspace[] {
  return ORDER.filter((role): role is Workspace => role !== 'patient' && roles.includes(role))
}

/** Where a signed-in account belongs. The address decides the workspace, so a choice can never outlive its sign-in. */
export function homePath(roles: readonly Role[]) {
  const [first] = workspacesOf(roles)
  return first ? workspacePath(first) : '/use-mobile'
}
