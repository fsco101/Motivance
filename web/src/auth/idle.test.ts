import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACTIVITY_KEY, IDLE_LIMIT_MS, IDLE_WARNING_MS, clearActivity, idleState, readActivity, writeActivity } from './idle'

describe('idle sign-out', () => {
  const now = 1_000_000_000

  it('stays active until the warning starts', () => {
    expect(idleState(now, now)).toBe('active')
    expect(idleState(now, now - (IDLE_LIMIT_MS - IDLE_WARNING_MS) + 1)).toBe('active')
  })

  it('warns in the final minute', () => {
    expect(idleState(now, now - (IDLE_LIMIT_MS - IDLE_WARNING_MS))).toBe('warning')
    expect(idleState(now, now - IDLE_LIMIT_MS + 1)).toBe('warning')
  })

  it('expires at the limit, including after the browser was closed for hours', () => {
    expect(idleState(now, now - IDLE_LIMIT_MS)).toBe('expired')
    expect(idleState(now, now - 8 * 60 * 60_000)).toBe('expired')
  })

  it('treats a brand new session as active', () => {
    expect(idleState(now, null)).toBe('active')
  })
})

describe('activity storage', () => {
  beforeEach(() => { clearActivity(); localStorage.clear() })
  afterEach(() => vi.restoreAllMocks())

  it('round-trips the last activity time', () => {
    writeActivity(1234)
    expect(readActivity()).toBe(1234)
    clearActivity()
    expect(readActivity()).toBeNull()
  })

  it('still times out when the browser refuses storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    writeActivity(1000)
    expect(readActivity()).toBe(1000)
    expect(idleState(1000 + IDLE_LIMIT_MS, readActivity())).toBe('expired')
  })

  it('ignores a value it cannot read', () => {
    localStorage.setItem(ACTIVITY_KEY, 'not-a-time')
    expect(readActivity()).toBeNull()
  })
})
