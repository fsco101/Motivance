import { describe, expect, it } from 'vitest'
import { decodeInbox, decodeNotification, notificationTarget, type AppNotification } from './notifications'

const row = {
  id: 'n1', kind: 'rescheduled' as const, read_at: null, created_at: '2026-12-01T02:00:00+00:00',
  data: { reference_no: 'BK-2026-000001', starts_at: '2026-12-14T02:00:00+00:00', ends_at: '2026-12-14T03:00:00+00:00', previous_starts_at: '2026-12-07T02:00:00+00:00', patient_name: 'Ana', therapist_name: 'Dana', reason: 'Training' },
}

describe('reading a notification', () => {
  it('keeps the facts the text is written from', () => {
    expect(decodeNotification(row)).toMatchObject({ reference: 'BK-2026-000001', startsAt: row.data.starts_at, previousStartsAt: row.data.previous_starts_at, patient: 'Ana', therapist: 'Dana', reason: 'Training', readAt: null })
  })

  it('treats a fact the server left out as none', () => {
    const { reference_no, starts_at, ends_at } = row.data
    expect(decodeNotification({ ...row, data: { reference_no, starts_at, ends_at } })).toMatchObject({ previousStartsAt: null, reason: null, patient: null, therapist: null })
  })

  it('keeps when it was read', () => {
    expect(decodeNotification({ ...row, read_at: '2026-12-02T02:00:00+00:00' }).readAt).toBe('2026-12-02T02:00:00+00:00')
  })

  it('keeps who it is about, with their photo', () => {
    expect(decodeNotification({ ...row, subject_id: 't1', subject_name: 'Dana', subject_photo: 'https://res.cloudinary.com/x/image/upload/v1/a' }))
      .toMatchObject({ subjectId: 't1', subjectName: 'Dana', subjectPhoto: 'https://res.cloudinary.com/x/image/upload/v1/a' })
    expect(decodeNotification(row)).toMatchObject({ subjectId: null, subjectName: null, subjectPhoto: null })
  })

  it('reads a notification that is not about a session, which has no time', () => {
    expect(decodeNotification({ id: 'n2', kind: 'session_finished', read_at: null, created_at: row.created_at, data: { patient_name: 'Ana', completed: 6, target: 5 } }))
      .toMatchObject({ kind: 'session_finished', startsAt: null, endsAt: null, reference: '', patient: 'Ana', completed: 6, target: 5, days: null })
    expect(decodeNotification({ id: 'n3', kind: 'patient_inactive', read_at: null, created_at: row.created_at, data: { patient_name: 'Ana', days: 4 } }).days).toBe(4)
  })

  it('leaves out a kind this version does not know, so a newer server never shows a blank row', () => {
    const inbox = decodeInbox(2, [row, { ...row, id: 'n9', kind: 'something_new' }])
    expect(inbox.rows.map((note) => note.id)).toEqual(['n1'])
    expect(inbox.unread).toBe(2)
  })
})

describe('opening a notification', () => {
  const note = (kind: AppNotification['kind'], subjectId: string | null = null) => ({ ...decodeNotification(row), kind, subjectId })

  it('goes to the plan for exercise news, and home for care-team news, on the patient\'s side', () => {
    expect(notificationTarget(note('plan_updated'), 'patient')).toBe('/patient/exercises')
    expect(notificationTarget(note('practice_reminder'), 'patient')).toBe('/patient/exercises')
    expect(notificationTarget(note('care_linked', 't1'), 'patient')).toBe('/patient')
    expect(notificationTarget(note('care_unlinked', 't1'), 'patient')).toBe('/patient')
  })

  it('goes to the patient\'s record for a therapist, or the list when there is none to open', () => {
    expect(notificationTarget(note('session_finished', 'p1'), 'therapist')).toBe('/therapist/patients/p1')
    expect(notificationTarget(note('patient_inactive', 'p1'), 'therapist')).toBe('/therapist/patients/p1')
    expect(notificationTarget(note('patient_linked', 'p1'), 'therapist')).toBe('/therapist/patients/p1')
    expect(notificationTarget(note('patient_linked'), 'therapist')).toBe('/therapist/patients')
    expect(notificationTarget(note('patient_unlinked', 'p1'), 'therapist')).toBe('/therapist/patients')
  })

  it('goes where a booking can be seen, by workspace', () => {
    expect(notificationTarget(note('rescheduled'), 'patient')).toBe('/patient/bookings')
    expect(notificationTarget(note('session_assigned', 'p1'), 'therapist')).toBe('/therapist/schedule')
    expect(notificationTarget(note('request_received', 'p1'), 'scheduler')).toBe('/scheduler/requests')
  })
})
