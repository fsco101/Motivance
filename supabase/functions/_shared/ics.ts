/** Plain functions with no Deno or network in them, so the web tests can run them directly. */

export type CalendarBooking = {
  id: string; reference_no: string; status: string; starts_at: string; ends_at: string; center_name: string; location: string; sequence: number; updated_at: string | null
}

const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
const escapeText = (value: string) => value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

/** RFC 5545 caps a line at 75 octets, and a longer one continues on a line starting with a space. */
function fold(line: string) {
  const bytes = new TextEncoder()
  const parts: string[] = []
  let current = ''
  for (const character of line) {
    const limit = parts.length === 0 ? 75 : 74
    if (bytes.encode(current + character).length > limit) {
      parts.push(current)
      current = ''
    }
    current += character
  }
  parts.push(current)
  return parts.join('\r\n ')
}

/**
 * One entry per booking, always under the same UID. A calendar that has it already replaces it when SEQUENCE rises, so a moved
 * session updates the entry instead of adding a second one. The file says nothing about who the patient is.
 */
export function renderCalendar(booking: CalendarBooking) {
  const gone = booking.status === 'cancelled' || booking.status === 'rejected'
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Motivance//Booking//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:${booking.id}@motivance`, `DTSTAMP:${stamp(booking.updated_at ?? booking.starts_at)}`, `SEQUENCE:${booking.sequence}`,
    `DTSTART:${stamp(booking.starts_at)}`, `DTEND:${stamp(booking.ends_at)}`, `SUMMARY:${escapeText(`${booking.center_name} session`)}`,
    ...(booking.location ? [`LOCATION:${escapeText(booking.location)}`] : []), `DESCRIPTION:${escapeText(`Reference ${booking.reference_no}`)}`,
    `STATUS:${gone ? 'CANCELLED' : booking.status === 'pending' ? 'TENTATIVE' : 'CONFIRMED'}`, 'END:VEVENT', 'END:VCALENDAR',
  ]
  return `${lines.map(fold).join('\r\n')}\r\n`
}
