import { describe, expect, it } from 'vitest'
import { patientChoices, pickerValue, resolveAccount, therapistChoices } from './links'
import type { AdminAccount } from './types'

const person = (id: string, email: string): AdminAccount => ({ id, name: 'Maria Santos', email, active: true, roles: ['patient'] })
const first = person('00000000-0000-4000-8000-000000000001', 'maria.one@example.test')
const second = person('00000000-0000-4000-8000-000000000002', 'maria.two@example.test')

describe('choosing an account for a link', () => {
  it('tells apart two people with the same name', () => {
    expect(pickerValue(first)).not.toBe(pickerValue(second))
    expect(resolveAccount(pickerValue(second), [first, second])).toBe(second.id)
  })

  it('never resolves a bare name, because it could mean the wrong patient', () => {
    expect(resolveAccount('Maria Santos', [first, second])).toBeNull()
  })

  it('accepts a pasted ID, even for an account that is not loaded', () => {
    expect(resolveAccount(first.id, [first, second])).toBe(first.id)
    expect(resolveAccount('00000000-0000-4000-8000-000000000009', [first])).toBe('00000000-0000-4000-8000-000000000009')
  })
})

describe('who can be linked', () => {
  const person = (id: string, roles: AdminAccount['roles'], active = true): AdminAccount => ({ id, name: id, email: `${id}@example.test`, active, roles })
  const accounts = [person('therapist', ['patient', 'therapist']), person('patient', ['patient']), person('admin', ['patient', 'admin']), person('off-therapist', ['therapist'], false), person('off-patient', ['patient'], false)]

  it('offers active therapists only', () => expect(therapistChoices(accounts).map((account) => account.id)).toEqual(['therapist']))
  it('offers active patients and never staff, though every account holds the patient role', () => expect(patientChoices(accounts).map((account) => account.id)).toEqual(['patient']))
})
