import type { SupabaseClient } from '@supabase/supabase-js'
import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'
import { ACCOUNT_PAGE, ACTIVITY_PAGE, auditCategory, auditKind, decodeExercises, describeEvent, loadAccounts, loadActivity, type RawAudit } from './admin'
import type { Database } from './database.types'

const fake = (data: unknown) => ({ rpc: async () => ({ data, error: null }) }) as unknown as SupabaseClient<Database>
const t = ((key: string, values?: Record<string, string>) => (values ? `${key}:${Object.values(values).join('|')}` : key)) as unknown as TFunction

const event = (extra: Partial<RawAudit>): RawAudit => ({
  id: 1, action: 'insert', target_type: 'sessions', target_id: '12345678-aaaa', recorded_at: '2026-11-05T00:00:00Z', actor_id: 'abcdefgh-1234', actor_name: 'Mara Cruz', target_name: '', related_name: '', ...extra,
})

describe('audit events use the same wording as Android', () => {
  it.each([
    ['profiles', 'accounts'], ['user_roles', 'accounts'], ['patient_profiles', 'accounts'], ['therapist_patients', 'links'], ['patient_invitations', 'links'], ['exercises', 'catalogue'],
    ['exercise_versions', 'catalogue'], ['consents', 'privacy'], ['data_requests', 'privacy'], ['sessions', 'clinical'], ['prescription_versions', 'clinical'], ['anything_else', 'clinical'],
  ])('files %s under %s', (type, category) => expect(auditCategory(type)).toBe(category))

  it.each([
    ['profiles', 'enable', 'accountEnabled'], ['profiles', 'disable', 'accountDisabled'], ['profiles', 'update_photo', 'photoUpdated'], ['profiles', 'remove_photo', 'photoRemoved'],
    ['patient_profiles', 'update_profile', 'profileUpdated'], ['user_roles', 'insert', 'roleGranted'], ['user_roles', 'delete', 'roleRemoved'], ['user_roles', 'update', 'roleChanged'],
    ['therapist_patients', 'insert', 'linkCreated'], ['therapist_patients', 'update', 'linkUpdated'], ['patient_invitations', 'invite', 'invitation'], ['exercises', 'activate', 'exerciseActivated'],
    ['exercises', 'deactivate', 'exerciseDeactivated'], ['exercise_versions', 'publish', 'versionPublished'], ['prescription_versions', 'insert', 'prescription'], ['sessions', 'insert', 'session'],
    ['consents', 'insert', 'consent'], ['data_requests', 'insert', 'requestCreated'], ['data_requests', 'update', 'requestUpdated'], ['profiles', 'something_new', 'other'],
  ])('names %s %s as %s', (type, action, kind) => expect(auditKind(type, action)).toBe(kind))

  it.each([
    ['requested', 'bookingRequested'], ['confirmed', 'bookingConfirmed'], ['rejected', 'bookingRejected'], ['cancelled', 'bookingCancelled'], ['rescheduled', 'bookingRescheduled'],
    ['returned_to_pending', 'bookingReturned'], ['therapist_changed', 'bookingTherapist'], ['attendance_marked', 'bookingAttendance'],
  ])('names a booking that was %s as %s', (action, kind) => {
    expect(auditKind('bookings', action)).toBe(kind)
    expect(auditCategory('bookings')).toBe('bookings')
  })

  it('names a booking by its reference number, or falls back to part of its ID', () => {
    expect(describeEvent(event({ target_type: 'bookings', action: 'confirmed', target_name: 'BK-2026-000042' }), t).target).toBe('BK-2026-000042')
    expect(describeEvent(event({ target_type: 'bookings', action: 'confirmed' }), t).target).toBe('admin.eventReference:12345678')
  })

  it('names an account, or shows part of its ID', () => {
    expect(describeEvent(event({ target_type: 'profiles', action: 'enable', target_name: 'Ana Cruz' }), t).target).toBe('Ana Cruz')
    expect(describeEvent(event({ target_type: 'profiles', action: 'enable' }), t).target).toBe('12345678')
  })

  it('shows both people on a link', () => {
    const link = event({ target_type: 'therapist_patients', target_id: 'aaaaaaaa-1:bbbbbbbb-2', target_name: 'Tess Lim', related_name: '' })
    expect(describeEvent(link, t).target).toBe('admin.eventLink:Tess Lim|bbbbbbbb')
  })

  it('refers to anything else by reference', () => {
    expect(describeEvent(event({ target_type: 'sessions' }), t).target).toBe('admin.eventReference:12345678')
    expect(describeEvent(event({ target_type: 'patient_invitations' }), t).target).toBe('admin.eventReference:12345678')
  })

  it('leaves the actor empty for a system event, so the page can label it', () => {
    expect(describeEvent(event({ actor_id: null }), t).actor).toBeNull()
    expect(describeEvent(event({ actor_name: '' }), t).actor).toBe('abcdefgh')
  })
})

describe('paging', () => {
  const accounts = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `id-${index}`, display_name: `Person ${index}`, active: true, email: `${index}@example.test`, username: null, created_at: null, last_sign_in_at: null, photo_url: null, roles: ['patient'] }))

  it('keeps the extra account back and starts the next page after the last one shown', async () => {
    const page = await loadAccounts(fake(accounts(ACCOUNT_PAGE + 1)), '', null)
    expect(page.accounts).toHaveLength(ACCOUNT_PAGE)
    expect(page.next).toBe(`id-${ACCOUNT_PAGE - 1}`)
  })

  it('stops when no extra account came back', async () => {
    expect((await loadAccounts(fake(accounts(ACCOUNT_PAGE)), '', null)).next).toBeNull()
  })

  it('does the same for activity', async () => {
    const page = await loadActivity(fake(Array.from({ length: ACTIVITY_PAGE + 1 }, (_, index) => event({ id: 100 - index }))), null)
    expect(page.events).toHaveLength(ACTIVITY_PAGE)
    expect(page.next).toBe(100 - (ACTIVITY_PAGE - 1))
  })
})

describe('the catalogue', () => {
  it('shows each exercise at its newest version, and marks therapists’ own', () => {
    const [custom] = decodeExercises([{
      id: 'e', code: 'custom-1', active: false, exercise_versions: [
        { version: 1, algorithm_key: 'joint-angle-v1', definition: { name: 'Old', instructions_en: 'a', instructions_fil: 'b' } },
        { version: 2, algorithm_key: 'joint-angle-v1', definition: { name: 'New', instructions_en: 'c', instructions_fil: 'd' } },
      ],
    }])
    expect(custom).toEqual({ id: 'e', code: 'custom-1', active: false, version: 2, name: 'New', english: 'c', filipino: 'd', custom: true })
  })

  it('survives an exercise with no version', () => {
    expect(decodeExercises([{ id: 'e', code: 'x', active: true, exercise_versions: [] }])[0]).toMatchObject({ version: 0, name: '', custom: false })
  })
})
