import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { profileOf, usernameRefused, type Signup } from '../../src/auth/signup'
import { client, createUser, removeUsers, signedIn, signupLink, sql, type TestUser } from '../support/stack'

/**
 * Local Auth sends through a real mail account, so these never reach a send. The refusals fail in the database before any email,
 * and a successful account is made through the admin link, which writes through the same trigger and sends nothing.
 */
describe('web sign-up on the local backend', () => {
  const tag = randomUUID().slice(0, 8)
  const form = (username: string, consent = true): Signup => ({
    email: '', password: `Signup-${tag}-Aa9`, confirmation: '', firstName: 'Ana', lastName: 'Dela Cruz', birthdate: '1990-02-14', gender: 'female', address: '12 Mabini Street', contact: '+63 912 345 6789', username, consent,
  })
  const users: TestUser[] = []
  let taken: TestUser

  beforeAll(async () => {
    taken = await createUser(['patient'], `Taken ${tag}`)
    users.push(taken)
    sql(`insert into public.patient_profiles(user_id,username,full_name,first_name,last_name,gender,birthdate,address,contact) values('${taken.id}','taken_${tag}','Taken One','Taken','One','female','1990-01-01','12 Mabini Street','+63 912 345 6789')`)
  })
  afterAll(() => removeUsers(users))

  const attempt = (username: string, consent = true) => client().auth.signUp({
    email: `motivance-web-refused-${randomUUID()}@example.test`, password: form(username).password, options: { data: { patient_profile: profileOf(form(username, consent)) } },
  })

  it('reports a username already in use the way the page expects', async () => {
    const { error } = await attempt(`taken_${tag}`)
    expect(error).not.toBeNull()
    expect(usernameRefused(error)).toBe(true)
  })

  it('refuses an account without the agreement, whatever a client sends', async () => {
    const { error } = await attempt(`free_${tag}`, false)
    expect(error).not.toBeNull()
  })

  it('makes a patient, and only a patient, with the agreement on record', async () => {
    const email = `motivance-web-signup-${randomUUID()}@example.test`
    const result = await signupLink(email, form('x').password, { patient_profile: { ...profileOf(form(`made_${tag}`)), role: 'admin' }, role: 'admin' })
    expect(result.status).toBe(200)
    const id = String(result.body.id)
    users.push({ id, email, password: form('x').password })
    expect(sql(`select string_agg(role,',') from public.user_roles where user_id='${id}'`)).toBe('patient')
    expect(sql(`select username||','||(consented_at is not null) from public.patient_profiles where user_id='${id}'`)).toBe(`made_${tag},true`)
  })

  it('cannot sign in until the code is entered, and then can', async () => {
    const email = `motivance-web-signup-${randomUUID()}@example.test`
    const password = form('x').password
    const result = await signupLink(email, password, { patient_profile: profileOf(form(`code_${tag}`)) })
    const person = { id: String(result.body.id), email, password }
    users.push(person)
    const early = await client().auth.signInWithPassword({ email, password })
    expect(early.error?.code).toBe('email_not_confirmed')
    const db = client()
    const { error } = await db.auth.verifyOtp({ email, token: String(result.body.email_otp), type: 'signup' })
    expect(error).toBeNull()
    expect((await (await signedIn(person)).from('user_roles').select('role')).data).toEqual([{ role: 'patient' }])
  })
})
