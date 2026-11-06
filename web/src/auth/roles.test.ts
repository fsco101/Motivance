import { describe, expect, it } from 'vitest'
import { homePath, primaryRole, workspacesOf } from './roles'

describe('role routing, matching Android', () => {
  it('sends each account to its own workspace', () => {
    expect(homePath(['therapist'])).toBe('/therapist')
    expect(homePath(['admin'])).toBe('/admin')
    expect(homePath(['scheduler'])).toBe('/scheduler')
  })

  it('puts staff who are also patients on their staff workspace, in any order', () => {
    expect(homePath(['patient', 'therapist'])).toBe('/therapist')
    expect(homePath(['therapist', 'patient'])).toBe('/therapist')
    expect(homePath(['patient', 'therapist', 'admin'])).toBe('/admin')
    expect(primaryRole(['patient', 'admin'])).toBe('admin')
    expect(homePath(['patient', 'scheduler'])).toBe('/scheduler')
  })

  it('ranks a Scheduler above a therapist and below an administrator', () => {
    expect(primaryRole(['therapist', 'scheduler'])).toBe('scheduler')
    expect(primaryRole(['scheduler', 'admin'])).toBe('admin')
  })

  it('gives a patient their own workspace', () => {
    expect(homePath(['patient'])).toBe('/patient')
    expect(workspacesOf(['patient'])).toEqual(['patient'])
  })

  it('offers every workspace the account holds, most senior first', () => {
    expect(workspacesOf(['patient', 'therapist', 'admin'])).toEqual(['admin', 'therapist', 'patient'])
    expect(workspacesOf(['therapist', 'patient', 'scheduler', 'admin'])).toEqual(['admin', 'scheduler', 'therapist', 'patient'])
  })

  it('has no primary role for an account without roles', () => {
    expect(primaryRole([])).toBeNull()
  })
})
