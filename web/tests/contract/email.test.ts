import { describe, expect, it } from 'vitest'
import { renderEmail, type Delivery } from '../../../supabase/functions/_shared/email'
import { renderCalendar, type CalendarBooking } from '../../../supabase/functions/_shared/ics'

const KINDS = ['confirmed', 'rejected', 'cancelled', 'rescheduled', 'therapist_changed', 'returned_to_pending', 'session_assigned', 'session_moved', 'session_cancelled', 'session_removed', 'request_received', 'patient_cancelled', 'needs_therapist']
const links = { site: 'https://app.example.test', functions: 'https://api.example.test/functions/v1' }

const delivery = (overrides: Partial<Delivery> = {}): Delivery => ({
  id: 'd1', kind: 'confirmed', email: 'ana@example.test', name: 'Ana Dela Cruz', language: 'en', calendar_token: 'abc', location: '12 Mabini Street', center_name: 'Motivance Center', time_zone: 'Asia/Manila',
  data: { reference_no: 'BK-2026-000001', starts_at: '2026-12-14T01:00:00+00:00', ends_at: '2026-12-14T02:00:00+00:00', patient_name: 'Ana Dela Cruz', therapist_name: 'Dana Reyes' },
  ...overrides,
})

const plain = (value: string) => value.replace(/\u202f/g, ' ')

describe('a booking email', () => {
  it.each(KINDS.flatMap((kind) => [[kind, 'en'], [kind, 'fil']] as const))('has words for %s in %s', (kind, language) => {
    const { subject, text, html } = renderEmail(delivery({ kind, language }), links)
    expect(subject.length).toBeGreaterThan(3)
    expect(subject).not.toMatch(/[{}]/)
    expect(text).not.toMatch(/[{}]/)
    expect(html).toContain(`lang="${language}"`)
  })

  it('shows the date, specific time, therapist, location and reference', () => {
    const { text } = renderEmail(delivery(), links)
    expect(plain(text)).toContain('9:00 AM – 10:00 AM')
    expect(text).toContain('December 14, 2026')
    expect(text).toContain('Therapist: Dana Reyes')
    expect(text).toContain('Location: 12 Mabini Street')
    expect(text).toContain('Reference: BK-2026-000001')
  })

  it('reads the time in the center\'s zone, whatever the server\'s', () => {
    expect(plain(renderEmail(delivery({ time_zone: 'Asia/Manila' }), links).text)).toContain('9:00 AM')
    expect(plain(renderEmail(delivery({ time_zone: 'UTC' }), links).text)).toContain('1:00 AM')
  })

  it('is written in the reader\'s language', () => {
    const { subject, text } = renderEmail(delivery({ language: 'fil' }), links)
    expect(subject).toBe('Kumpirmado ang iyong session')
    expect(text).toContain('Lokasyon: 12 Mabini Street')
    expect(text).toContain('Kumusta Ana Dela Cruz,')
  })

  it('leaves out a location the center has not set', () => {
    expect(renderEmail(delivery({ location: '' }), links).text).not.toContain('Location')
  })

  it('says a therapist is still to come, rather than leaving a gap', () => {
    const { text } = renderEmail(delivery({ kind: 'request_received', data: { ...delivery().data, therapist_name: null } }), links)
    expect(text).toContain('Therapist: To be assigned')
  })

  it('gives a therapist who lost a session the time they had', () => {
    const { text } = renderEmail(delivery({ kind: 'session_removed', data: { ...delivery().data, previous_starts_at: '2026-12-07T05:00:00+00:00' } }), links)
    expect(plain(text)).toContain('December 7, 2026, 1:00 PM is no longer yours')
  })

  it('offers a calendar link only for a session that is on', () => {
    for (const kind of ['confirmed', 'rescheduled', 'therapist_changed', 'session_assigned', 'session_moved']) expect(renderEmail(delivery({ kind }), links).text).toContain('booking-calendar?token=abc')
    for (const kind of ['rejected', 'cancelled', 'session_cancelled', 'session_removed', 'request_received', 'patient_cancelled']) expect(renderEmail(delivery({ kind }), links).text).not.toContain('booking-calendar')
  })

  it('writes the system\'s reason for a lost therapist in words', () => {
    const { text } = renderEmail(delivery({ kind: 'returned_to_pending', data: { ...delivery().data, reason: 'therapist_unavailable' } }), links)
    expect(text).toContain('Your therapist is no longer available.')
    expect(text).not.toContain('therapist_unavailable')
  })

  it('cannot be injected through a name or reason', () => {
    const { html } = renderEmail(delivery({ name: '<img src=x>', data: { ...delivery().data, reason: '"><script>alert(1)</script>' } }), links)
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;script&gt;')
  })

  it('keeps a subject on one line, so a name cannot add a header', () => {
    const { subject } = renderEmail(delivery({ kind: 'request_received', data: { ...delivery().data, patient_name: 'Ana\r\nBcc: someone@example.test' } }), links)
    expect(subject).not.toMatch(/[\r\n]/)
  })

  it('refuses a kind it has no words for, rather than sending a blank email', () => {
    expect(() => renderEmail(delivery({ kind: 'unknown' }), links)).toThrow('Unknown notification kind')
  })
})

const booking = (overrides: Partial<CalendarBooking> = {}): CalendarBooking => ({
  id: 'b1', reference_no: 'BK-2026-000001', status: 'confirmed', starts_at: '2026-12-14T01:00:00+00:00', ends_at: '2026-12-14T02:00:00+00:00', center_name: 'Motivance Center', location: '12 Mabini Street', sequence: 0, updated_at: '2026-12-01T01:00:00+00:00', ...overrides,
})

describe('a calendar file', () => {
  it('holds one session in UTC, with lines ending as the standard asks', () => {
    const file = renderCalendar(booking())
    expect(file).toContain('DTSTART:20261214T010000Z\r\n')
    expect(file).toContain('DTEND:20261214T020000Z\r\n')
    expect(file.match(/BEGIN:VEVENT/g)).toHaveLength(1)
    expect(file.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
  })

  it('keeps the same entry when a session moves', () => {
    const before = renderCalendar(booking())
    const after = renderCalendar(booking({ starts_at: '2026-12-15T01:00:00+00:00', ends_at: '2026-12-15T02:00:00+00:00', sequence: 1 }))
    expect(after.match(/UID:.*/)![0]).toBe(before.match(/UID:.*/)![0])
    expect(after).toContain('SEQUENCE:1')
  })

  it('says what state the session is in', () => {
    expect(renderCalendar(booking({ status: 'rescheduled' }))).toContain('STATUS:CONFIRMED')
    expect(renderCalendar(booking({ status: 'pending' }))).toContain('STATUS:TENTATIVE')
    expect(renderCalendar(booking({ status: 'cancelled' }))).toContain('STATUS:CANCELLED')
    expect(renderCalendar(booking({ status: 'rejected' }))).toContain('STATUS:CANCELLED')
  })

  it('escapes what would break a line', () => {
    expect(renderCalendar(booking({ location: 'Unit 3, Mabini; Quezon City' }))).toContain('LOCATION:Unit 3\\, Mabini\\; Quezon City')
  })

  it('leaves out a location the center has not set', () => {
    expect(renderCalendar(booking({ location: '' }))).not.toContain('LOCATION')
  })

  it('folds a long line without splitting a character', () => {
    const file = renderCalendar(booking({ location: 'Ñ'.repeat(120) }))
    for (const line of file.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    expect(file.replace(/\r\n /g, '')).toContain(`LOCATION:${'Ñ'.repeat(120)}`)
  })
})
