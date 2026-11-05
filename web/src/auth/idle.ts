export const IDLE_LIMIT_MS = 15 * 60_000
export const IDLE_WARNING_MS = 60_000

/** A time, never patient data. Stored so that closing the browser still counts as being away, and tabs agree. */
export const ACTIVITY_KEY = 'motivance.lastActivity'

/** Kept here too, so idle sign-out still works in a browser that refuses storage. */
let inMemory: number | null = null

export type IdleState = 'active' | 'warning' | 'expired'

export function idleState(now: number, lastActivity: number | null): IdleState {
  if (lastActivity === null) return 'active'
  const away = now - lastActivity
  if (away >= IDLE_LIMIT_MS) return 'expired'
  return away >= IDLE_LIMIT_MS - IDLE_WARNING_MS ? 'warning' : 'active'
}

export function readActivity(): number | null {
  try {
    const value = Number(localStorage.getItem(ACTIVITY_KEY))
    return Number.isFinite(value) && value > 0 ? value : inMemory
  } catch {
    return inMemory
  }
}

export function writeActivity(now: number) {
  inMemory = now
  try {
    localStorage.setItem(ACTIVITY_KEY, String(now))
  } catch {
    // Private windows may refuse storage; the in-memory time keeps this tab's timer running.
  }
}

export function clearActivity() {
  inMemory = null
  try {
    localStorage.removeItem(ACTIVITY_KEY)
  } catch {
    // Nothing to clear.
  }
}
