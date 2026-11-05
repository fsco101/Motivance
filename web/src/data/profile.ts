import type { SupabaseClient } from '@supabase/supabase-js'
import { recoveryClient } from './client'
import type { Database } from './database.types'
import { must } from './workspace'

type Db = SupabaseClient<Database>

export const GENDERS = ['female', 'male', 'nonbinary', 'prefer_not_to_say'] as const

export type ProfileDetails = { firstName: string; lastName: string; username: string; gender: string; birthdate: string; address: string; contact: string; consent: boolean }
export type MyProfile = ProfileDetails & { email: string; photo: string | null; complete: boolean }

// The rules below mirror PatientProfile.kt on Android. The server enforces the same limits in write_patient_profile.
const NAME = /^[\p{L}\p{M}]+(?:[ .’'-][\p{L}\p{M}]+)*\.?$/u
const BLOCKED = /fuck|shit|bitch|(^cunt|cunt$)|motherfucker|putangina|tangina|gago|tanga|ulol|putang|pakyu|(^puta|puta$)|puto|mierda|pendejo|cabron|cojones|joder|merde|putain|salope|connard|scheisse|arschloch|ficken|fotze|caralho|porra|buceta|cazzo|vaffanculo|stronzo|anjing|bangsat|kontol|memek|goblok|bhenchod|madarchod|chutiya|harami|orospu|siktir/
const LOOKALIKES: Record<string, string> = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g' }

export const validName = (value: string) => { const name = value.trim(); return name.length >= 1 && name.length <= 60 && NAME.test(name) }
export const validAddress = (value: string) => { const length = value.trim().length; return length >= 5 && length <= 500 }
export const validContact = (value: string) => {
  const digits = value.replace(/\D/g, '').length
  return /^\+?[0-9 ()-]{7,25}$/.test(value) && digits >= 7 && digits <= 15
}
export const usernameBlocked = (value: string) => BLOCKED.test(value.toLowerCase().replace(/[01345789]/g, (digit) => LOOKALIKES[digit] ?? digit).replaceAll('_', ''))
export const validUsername = (value: string) => /^[A-Za-z0-9_]{3,30}$/.test(value) && !usernameBlocked(value)

const pad = (value: number) => String(value).padStart(2, '0')
const dayOf = (date: Date) => `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

export function validBirthdate(value: string, today = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime()) || dayOf(date) !== value) return false
  const oldest = new Date(today.getFullYear() - 120, today.getMonth(), today.getDate())
  return value <= dayOf(today) && value >= dayOf(oldest)
}

export function ageOn(birthdate: string, today = new Date()) {
  if (!validBirthdate(birthdate, today)) return null
  const [year, month, day] = birthdate.split('-').map(Number) as [number, number, number]
  const beforeBirthday = today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day)
  return today.getFullYear() - year - (beforeBirthday ? 1 : 0)
}

export const validDetails = (details: ProfileDetails) => (
  validName(details.firstName) && validName(details.lastName) && validBirthdate(details.birthdate) && (GENDERS as readonly string[]).includes(details.gender)
  && validAddress(details.address) && validContact(details.contact) && validUsername(details.username) && details.consent
)

export async function loadMyProfile(db: Db, account: string, email: string): Promise<MyProfile> {
  const [details, person] = await Promise.all([
    db.from('patient_profiles').select('username,first_name,last_name,full_name,gender,birthdate,address,contact,consented_at').eq('user_id', account).maybeSingle(),
    db.from('profiles').select('display_name,photo_url').eq('id', account).maybeSingle(),
  ])
  if (details.error) throw details.error
  if (person.error) throw person.error
  const row = details.data
  // Staff accounts start without details, so their display name fills in the first two fields.
  const [first = '', ...rest] = (row?.full_name ?? person.data?.display_name ?? '').split(' ')
  return {
    email, photo: person.data?.photo_url ?? null, complete: Boolean(row), consent: Boolean(row?.consented_at),
    firstName: row?.first_name ?? first, lastName: row?.last_name ?? rest.join(' '), username: row?.username ?? '', gender: row?.gender ?? '', birthdate: row?.birthdate ?? '',
    address: row?.address ?? '', contact: row?.contact ?? '',
  }
}

export async function saveMyProfile(db: Db, details: ProfileDetails) {
  must(await db.rpc('save_my_profile', {
    p_details: {
      username: details.username.trim(), first_name: details.firstName.trim(), last_name: details.lastName.trim(), gender: details.gender, birthdate: details.birthdate,
      address: details.address.trim(), contact: details.contact.trim(), consent: details.consent,
    },
  }))
}

export type PhotoProblem = 'unconfigured' | 'limit' | 'unreadable' | 'failed'
export class PhotoFailure extends Error {
  constructor(readonly problem: PhotoProblem) { super(problem) }
}

export const MAX_PHOTO_BYTES = 2_000_000
const CLOUD = /^[A-Za-z0-9_-]{1,64}$/
const PUBLIC_ID = /^motivance\/avatars\/[0-9a-f-]{36}\/[0-9a-f]{32}$/

type Ticket = { cloud_name: string; api_key: string; timestamp: number; public_id: string; signature: string }

/**
 * The same three steps as Android. The database signs a request bound to a server-chosen ID, the browser uploads straight to
 * Cloudinary, and the database verifies Cloudinary's signature before saving. The API secret stays in Supabase Vault.
 */
export async function uploadPhoto(db: Db, jpeg: Blob) {
  if (jpeg.size === 0 || jpeg.size > MAX_PHOTO_BYTES) throw new PhotoFailure('unreadable')
  const issued = await db.rpc('profile_photo_upload')
  if (issued.status === 503) throw new PhotoFailure('unconfigured')
  if (issued.status === 429) throw new PhotoFailure('limit')
  const ticket = must(issued) as unknown as Ticket
  if (!CLOUD.test(ticket.cloud_name) || !PUBLIC_ID.test(ticket.public_id)) throw new PhotoFailure('failed')
  const form = new FormData()
  form.set('file', jpeg, 'profile.jpg')
  form.set('api_key', ticket.api_key)
  form.set('timestamp', String(ticket.timestamp))
  form.set('public_id', ticket.public_id)
  form.set('signature', ticket.signature)
  const response = await fetch(`https://api.cloudinary.com/v1_1/${ticket.cloud_name}/image/upload`, { method: 'POST', body: form })
  if (!response.ok) throw new PhotoFailure('failed')
  const uploaded = await response.json() as { public_id: string; version: number; signature: string }
  if (uploaded.public_id !== ticket.public_id) throw new PhotoFailure('failed')
  must(await db.rpc('set_my_profile_photo', { p_public_id: uploaded.public_id, p_version: uploaded.version, p_signature: uploaded.signature }))
}

export async function removeMyPhoto(db: Db) {
  must(await db.rpc('clear_my_profile_photo'))
}

/**
 * Proves the current password on a separate session, so a wrong one can never affect the session in use. A password change
 * ends every other session, so the app then carries on with the one that made the change, as Android does.
 */
export async function changePassword(main: Db, account: string, email: string, current: string, next: string) {
  const client = recoveryClient()
  const verified = await client.auth.signInWithPassword({ email, password: current })
  if (verified.error) throw verified.error
  try {
    if (verified.data.user.id !== account) throw new Error('Account mismatch')
    const changed = await client.auth.updateUser({ password: next })
    if (changed.error) throw changed.error
  } catch (failure) {
    await client.auth.signOut({ scope: 'local' })
    throw failure
  }
  const adopted = await main.auth.setSession(verified.data.session)
  if (adopted.error) throw adopted.error
}
