import { describe, expect, it } from 'vitest'
import { homePath, primaryRole, workspacesOf } from './roles'

describe('role routing, matching Android', () => {
  it('sends each account to its own workspace', () => {
    expect(homePath(['therapist'])).toBe('/therapist')
    expect(homePath(['admin'])).toBe('/admin')
  })

  it('puts staff who are also patients on their staff workspace, in any order', () => {
    expect(homePath(['patient', 'therapist'])).toBe('/therapist')
    expect(homePath(['therapist', 'patient'])).toBe('/therapist')
    expect(homePath(['patient', 'therapist', 'admin'])).toBe('/admin')
    expect(primaryRole(['patient', 'admin'])).toBe('admin')
  })

  it('tells a patient-only account to use the mobile app', () => {
    expect(homePath(['patient'])).toBe('/use-mobile')
    expect(workspacesOf(['patient'])).toEqual([])
  })

  it('offers every staff workspace the account holds, most senior first', () => {
    expect(workspacesOf(['patient', 'therapist', 'admin'])).toEqual(['admin', 'therapist'])
  })

  it('has no primary role for an account without roles', () => {
    expect(primaryRole([])).toBeNull()
  })
})
