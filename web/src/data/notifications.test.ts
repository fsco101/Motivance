import { describe, expect, it } from 'vitest'
import { decodeNotification } from './notifications'

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
})
