export type Role = 'admin' | 'scheduler' | 'therapist' | 'patient'
/** Every role has a workspace on the web. Only the camera exercise needs the phone. */
export type Workspace = Role

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
  return ORDER.filter((role) => roles.includes(role))
}

/** Where a signed-in account belongs. The address decides the workspace, so a choice can never outlive its sign-in. */
export function homePath(roles: readonly Role[]) {
  const [first] = workspacesOf(roles)
  return first ? workspacePath(first) : '/sign-in'
}
