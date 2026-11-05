import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ACTIVITY_PAGE, clearPhoto, loadAccounts, loadActivity, loadAdminCatalogue, loadLinks, loadSummary, publishExercise, setAccount, setExercise, setLink, setRole } from '../../src/data/admin'
import { loadMyProfile, PhotoFailure, saveMyProfile, uploadPhoto, type ProfileDetails } from '../../src/data/profile'
import { createCustomExercise } from '../../src/data/therapist'
import { createUser, removeUsers, signedIn, sql, type TestUser } from '../support/stack'

const PHOTO = 'https://res.cloudinary.com/demo/image/upload/v1/motivance/avatars/00000000-0000-0000-0000-000000000000/0123456789abcdef0123456789abcdef'

describe('administration on the local backend', () => {
  const users: TestUser[] = []
  let admin: TestUser
  let therapist: TestUser
  let patient: TestUser
  const tag = randomUUID().slice(0, 8)
  const add = async (...args: Parameters<typeof createUser>) => { const user = await createUser(...args); users.push(user); return user }
  const audit = (actor: string, target: string) => sql(`select action||'/'||target_type from public.audit_events where actor_id='${actor}' and target_id like '%${target}%' order by id`).split('\n').filter(Boolean)

  beforeAll(async () => {
    admin = await add(['admin'], `Mara ${tag}`)
    therapist = await add(['therapist'], `Tess ${tag}`)
    patient = await add(['patient'], `Paolo ${tag}`)
  })
  afterAll(() => {
    sql(`begin; set local session_replication_role=replica; delete from public.audit_events where actor_id='${admin.id}'; commit;`)
    removeUsers(users)
  })

  it('refuses every administrator function to anyone else', async () => {
    const calls = (db: Awaited<ReturnType<typeof signedIn>>) => [
      db.rpc('admin_accounts', {}), db.rpc('admin_summary'), db.rpc('admin_links'), db.rpc('admin_activity', {}), db.rpc('admin_set_account', { p_user: patient.id, p_active: false }),
      db.rpc('admin_set_role', { p_user: patient.id, p_role: 'admin', p_granted: true }), db.rpc('admin_set_link', { p_therapist: therapist.id, p_patient: patient.id, p_active: true }),
      db.rpc('admin_set_exercise', { p_exercise: randomUUID(), p_active: false }), db.rpc('admin_publish_exercise', { p_exercise: randomUUID(), p_name: 'x', p_english: 'x', p_filipino: 'x' }),
      db.rpc('admin_clear_photo', { p_user: patient.id }),
    ]
    for (const person of [therapist, patient]) {
      const results = await Promise.all(calls(await signedIn(person)))
      expect(results.map((result) => result.error?.code)).toEqual(Array(10).fill('42501'))
    }
    expect(sql(`select count(*) from public.user_roles where user_id='${patient.id}' and role='admin'`)).toBe('0')
  })

  it('searches the directory across name, email, username and ID, taking wildcards literally', async () => {
    const db = await signedIn(admin)
    sql(`insert into public.patient_profiles(user_id,username,full_name,gender,birthdate,address,contact) values('${patient.id}','paolo_${tag}','Paolo ${tag}','male','1990-01-01','Quezon City','0917 555 0142')`)
    for (const needle of [`Paolo ${tag}`, patient.email, `paolo_${tag}`, patient.id]) {
      expect((await loadAccounts(db, needle, null)).accounts.map((account) => account.id)).toEqual([patient.id])
    }
    expect((await loadAccounts(db, `Paolo_${tag}x`, null)).accounts).toEqual([])
    expect((await loadAccounts(db, '%', null)).accounts.every((account) => `${account.name}${account.email}${account.username ?? ''}`.includes('%'))).toBe(true)
  })

  it('reports join date, roles and ID for each account', async () => {
    const [account] = (await loadAccounts(await signedIn(admin), therapist.email, null)).accounts
    expect(account).toMatchObject({ id: therapist.id, name: `Tess ${tag}`, email: therapist.email, active: true, roles: ['therapist'] })
    expect(account?.joined).toBeTruthy()
  })

  it('counts the whole system, not one page', async () => {
    const summary = await loadSummary(await signedIn(admin))
    expect(summary.accounts).toBe(Number(sql('select count(*) from public.profiles')))
    expect(summary.activeExercises).toBe(Number(sql('select count(*) from public.exercises where active')))
  })

  it('never lets an administrator change their own account', async () => {
    const db = await signedIn(admin)
    await expect(setAccount(db, admin.id, false)).rejects.toThrow()
    await expect(setRole(db, admin.id, 'admin', false)).rejects.toThrow()
    expect(sql(`select active from public.profiles where id='${admin.id}'`)).toBe('t')
  })

  it('needs an active account before changing its roles', async () => {
    const db = await signedIn(admin)
    const disabled = await add(['patient'], `Dee ${tag}`)
    await setAccount(db, disabled.id, false)
    await expect(setRole(db, disabled.id, 'therapist', true)).rejects.toThrow('Active account required')
    await setAccount(db, disabled.id, true)
    await setRole(db, disabled.id, 'therapist', true)
    expect(sql(`select count(*) from public.user_roles where user_id='${disabled.id}' and role='therapist'`)).toBe('1')
  })

  it('writes one audit record for each account change', async () => {
    const db = await signedIn(admin)
    const person = await add(['patient'], `Audit ${tag}`)
    sql(`update public.profiles set photo_url='${PHOTO}' where id='${person.id}'`)
    await setAccount(db, person.id, false)
    await setAccount(db, person.id, true)
    await clearPhoto(db, person.id)
    expect(audit(admin.id, person.id)).toEqual(['disable/profiles', 'enable/profiles', 'remove_photo/profiles'])
    expect(sql(`select coalesce(photo_url,'none') from public.profiles where id='${person.id}'`)).toBe('none')
  })

  it('links, revokes and restores without bringing back an old prescription', async () => {
    const db = await signedIn(admin)
    await setLink(db, therapist.id, patient.id, true)
    expect((await loadLinks(db)).find((link) => link.therapist === therapist.id && link.patient === patient.id)).toMatchObject({ active: true, therapistName: `Tess ${tag}`, patientName: `Paolo ${tag}` })
    await setLink(db, therapist.id, patient.id, false)
    expect((await loadLinks(db)).find((link) => link.therapist === therapist.id)?.active).toBe(false)
    await setLink(db, therapist.id, patient.id, true)
    await expect(setLink(db, patient.id, patient.id, true)).rejects.toThrow('Invalid link')
    await expect(setLink(db, patient.id, therapist.id, true)).rejects.toThrow('Active therapist and patient required')
  })

  it('shows therapists’ exercises, active or not, and publishes a new version', async () => {
    const db = await signedIn(admin)
    const id = randomUUID()
    await createCustomExercise(await signedIn(therapist), { id, name: `Knee ${tag}`, joint: 'KNEE', english: 'Bend slowly.', filipino: 'Dahan-dahang ibaluktot.' })
    await setExercise(db, id, false)
    expect((await loadAdminCatalogue(db)).find((item) => item.id === id)).toMatchObject({ active: false, custom: true, version: 1, name: `Knee ${tag}`, filipino: 'Dahan-dahang ibaluktot.' })
    await setExercise(db, id, true)
    await publishExercise(db, id, `Knee v2 ${tag}`, 'Bend.', 'Ibaluktot.')
    expect((await loadAdminCatalogue(db)).find((item) => item.id === id)).toMatchObject({ active: true, version: 2, name: `Knee v2 ${tag}` })
    expect(audit(admin.id, id)).toEqual(['deactivate/exercises', 'activate/exercises'])
    await expect(publishExercise(db, id, 'x', 'x', '  ')).rejects.toThrow('Localized name/instructions required')
  })

  it('pages through activity without gaps or repeats', async () => {
    const db = await signedIn(admin)
    sql(`insert into public.audit_events(actor_id,action,target_type,target_id) select '${admin.id}','insert','sessions',g::text from generate_series(1,${ACTIVITY_PAGE + 5}) g`)
    const first = await loadActivity(db, null)
    expect(first.events).toHaveLength(ACTIVITY_PAGE)
    const second = await loadActivity(db, first.next)
    expect(second.events[0]!.id).toBeLessThan(first.events.at(-1)!.id)
    expect(new Set([...first.events, ...second.events].map((event) => event.id)).size).toBe(first.events.length + second.events.length)
  })
})

describe('staff profiles on the local backend', () => {
  const users: TestUser[] = []
  const tag = randomUUID().slice(0, 8)
  afterAll(() => removeUsers(users))
  const details: ProfileDetails = { firstName: 'Dana', lastName: 'Reyes', username: `dana_${tag}`, gender: 'female', birthdate: '1988-07-02', address: 'Quezon City', contact: '+63 917 555 0133', consent: true }

  it('starts an account with no details, using its display name', async () => {
    const staff = await createUser(['therapist'], 'Dana Maria Reyes')
    users.push(staff)
    expect(await loadMyProfile(await signedIn(staff), staff.id, staff.email)).toMatchObject({ complete: false, consent: false, firstName: 'Dana', lastName: 'Maria Reyes', username: '', photo: null })
  })

  it('saves details through save_my_profile, renames the account and records it', async () => {
    const staff = await createUser(['therapist'], 'Before Name')
    users.push(staff)
    const db = await signedIn(staff)
    await saveMyProfile(db, details)
    expect(await loadMyProfile(db, staff.id, staff.email)).toMatchObject({ ...details, complete: true, consent: true })
    expect(sql(`select display_name from public.profiles where id='${staff.id}'`)).toBe('Dana Reyes')
    expect(sql(`select action from public.audit_events where actor_id='${staff.id}' and target_type='patient_profiles'`)).toBe('update_profile')
  })

  it('reports a username already in use, which the form turns into its own message', async () => {
    const other = await createUser(['therapist'], 'Other Person')
    users.push(other)
    await expect(saveMyProfile(await signedIn(other), details)).rejects.toMatchObject({ code: '23505' })
  })

  it('refuses details the server would not accept, even past the form', async () => {
    const staff = await createUser(['therapist'], 'Bad Details')
    users.push(staff)
    const db = await signedIn(staff)
    await expect(saveMyProfile(db, { ...details, username: `ok_${tag}`, consent: false })).rejects.toThrow('Privacy agreement required')
    await expect(saveMyProfile(db, { ...details, username: 'tanga99' })).rejects.toThrow('Username contains prohibited wording')
  })

  it('says when photo uploads are not set up', async () => {
    const staff = await createUser(['therapist'], 'No Photos')
    users.push(staff)
    await expect(uploadPhoto(await signedIn(staff), new Blob(['x'], { type: 'image/jpeg' }))).rejects.toEqual(new PhotoFailure('unconfigured'))
  })

  it('stops a photo over the Android limit before anything is sent', async () => {
    const staff = await createUser(['therapist'], 'Big Photo')
    users.push(staff)
    await expect(uploadPhoto(await signedIn(staff), new Blob([new Uint8Array(2_000_001)]))).rejects.toEqual(new PhotoFailure('unreadable'))
  })
})
