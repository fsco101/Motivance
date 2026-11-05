import { describe, expect, it } from 'vitest'
import { ageOn, usernameBlocked, validAddress, validBirthdate, validContact, validDetails, validName, validUsername, type ProfileDetails } from './profile'

const today = new Date(2026, 10, 5)

describe('profile rules match PatientProfile.kt', () => {
  it.each(['Ana', 'Dela Cruz', "O'Brien", 'O’Brien', 'Jean-Luc', 'José', 'Jr.'])('accepts the name %s', (name) => expect(validName(name)).toBe(true))
  it.each(['', '   ', 'Ana2', 'Ana  Cruz', '-Ana', 'a'.repeat(61)])('refuses the name "%s"', (name) => expect(validName(name)).toBe(false))

  it.each(['+63 912 345 6789', '(02) 8123-4567', '1234567'])('accepts the number %s', (number) => expect(validContact(number)).toBe(true))
  it.each(['123456', '12+3456789', '1234567890123456', 'call me'])('refuses the number %s', (number) => expect(validContact(number)).toBe(false))

  it('needs 5 to 500 characters of address', () => {
    expect(validAddress('Quezon City')).toBe(true)
    expect(validAddress('  ab  ')).toBe(false)
    expect(validAddress('a'.repeat(501))).toBe(false)
  })

  it.each(['ana_cruz', 'A1b', 'x'.repeat(30)])('accepts the username %s', (name) => expect(validUsername(name)).toBe(true))
  it.each(['ab', 'x'.repeat(31), 'ana cruz', 'ana-cruz'])('refuses the username %s', (name) => expect(validUsername(name)).toBe(false))

  it('sees through spelling tricks in offensive usernames, as Android does', () => {
    expect(usernameBlocked('t4ng4')).toBe(true)
    expect(usernameBlocked('put_angina')).toBe(true)
    expect(validUsername('sh1t_happens')).toBe(false)
  })

  it('keeps the whole-word rule, so a harmless name is not caught', () => {
    expect(usernameBlocked('scunthorpe')).toBe(false)
    expect(usernameBlocked('computa')).toBe(true)
    expect(usernameBlocked('computation')).toBe(false)
  })

  it('needs a real date, not in the future and within 120 years', () => {
    expect(validBirthdate('1971-03-14', today)).toBe(true)
    expect(validBirthdate('2026-11-05', today)).toBe(true)
    expect(validBirthdate('2026-11-06', today)).toBe(false)
    expect(validBirthdate('1906-11-05', today)).toBe(true)
    expect(validBirthdate('1906-11-04', today)).toBe(false)
    expect(validBirthdate('2023-02-30', today)).toBe(false)
    expect(validBirthdate('', today)).toBe(false)
  })

  it('counts age from the last birthday', () => {
    expect(ageOn('1971-11-05', today)).toBe(55)
    expect(ageOn('1971-11-06', today)).toBe(54)
    expect(ageOn('not a date', today)).toBeNull()
  })

  it('needs every field and the agreement', () => {
    const details: ProfileDetails = { firstName: 'Ana', lastName: 'Cruz', username: 'ana_cruz', gender: 'female', birthdate: '1971-03-14', address: 'Quezon City', contact: '+63 912 345 6789', consent: true }
    expect(validDetails(details)).toBe(true)
    expect(validDetails({ ...details, consent: false })).toBe(false)
    expect(validDetails({ ...details, gender: '' })).toBe(false)
    expect(validDetails({ ...details, lastName: '' })).toBe(false)
  })
})
