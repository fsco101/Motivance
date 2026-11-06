/** Plain functions with no Deno or network in them, so the web tests can run them directly. */

export type Language = 'en' | 'fil'
export type Delivery = {
  id: string; kind: string; email: string | null; name: string | null; language: Language; calendar_token: string | null; location: string; center_name: string; time_zone: string
  data: { reference_no?: string; starts_at: string; ends_at: string; previous_starts_at?: string | null; patient_name?: string | null; therapist_name?: string | null; reason?: string | null }
}
export type Links = { site: string; functions: string }

type Line = { subject: string; body: string }

/** Filled from the same facts the apps use. {when} is the session, {was} the time a therapist had, and the names are who is involved. */
const LINES: Record<Language, Record<string, Line>> = {
  en: {
    confirmed: { subject: 'Your session is confirmed', body: 'Your session on {when} is confirmed with {therapist}.' },
    rejected: { subject: 'Your session request', body: 'Your request for {when} was not approved.' },
    cancelled: { subject: 'Your session was cancelled', body: 'Your session on {when} was cancelled.' },
    rescheduled: { subject: 'Your session has moved', body: 'Your session moved to {when}.' },
    therapist_changed: { subject: 'Your therapist has changed', body: 'Your therapist for {when} is now {therapist}.' },
    returned_to_pending: { subject: 'Your session needs a new therapist', body: 'Your session on {when} needs a new therapist. A Scheduler will confirm it again.' },
    session_assigned: { subject: 'New session: {patient}', body: '{patient} is booked with you on {when}.' },
    session_moved: { subject: 'Session moved: {patient}', body: 'Your session with {patient} moved to {when}.' },
    session_cancelled: { subject: 'Session cancelled: {patient}', body: 'Your session with {patient} on {when} was cancelled.' },
    session_removed: { subject: 'Session reassigned: {patient}', body: 'Your session with {patient} on {was} is no longer yours.' },
    request_received: { subject: 'New request: {patient}', body: '{patient} requested {when}.' },
    patient_cancelled: { subject: 'Patient cancelled: {patient}', body: '{patient} cancelled their session on {when}.' },
    needs_therapist: { subject: 'Needs a therapist: {patient}', body: 'The session with {patient} on {when} needs a therapist.' },
    reminder: { subject: 'Session reminder', body: 'Reminder: your session is on {when} with {therapist}.' },
    session_reminder: { subject: 'Session reminder: {patient}', body: 'Reminder: {patient} is booked with you on {when}.' },
    place_open: { subject: 'A place has opened', body: 'A place has opened on {when}. The first to book gets it.' },
  },
  fil: {
    confirmed: { subject: 'Kumpirmado ang iyong session', body: 'Kumpirmado ang iyong session sa {when} kasama si {therapist}.' },
    rejected: { subject: 'Ang iyong kahilingan sa session', body: 'Hindi naaprubahan ang iyong kahilingan para sa {when}.' },
    cancelled: { subject: 'Kinansela ang iyong session', body: 'Kinansela ang iyong session sa {when}.' },
    rescheduled: { subject: 'Inilipat ang iyong session', body: 'Inilipat ang iyong session sa {when}.' },
    therapist_changed: { subject: 'Nagbago ang iyong therapist', body: 'Si {therapist} na ang iyong therapist para sa {when}.' },
    returned_to_pending: { subject: 'Kailangan ng bagong therapist', body: 'Kailangan ng bagong therapist ang iyong session sa {when}. Kukumpirmahin itong muli ng Scheduler.' },
    session_assigned: { subject: 'Bagong session: {patient}', body: 'Naka-book sa iyo si {patient} sa {when}.' },
    session_moved: { subject: 'Inilipat ang session: {patient}', body: 'Inilipat ang session ninyo ni {patient} sa {when}.' },
    session_cancelled: { subject: 'Kinansela ang session: {patient}', body: 'Kinansela ang session ninyo ni {patient} sa {when}.' },
    session_removed: { subject: 'Inilipat sa iba ang session: {patient}', body: 'Hindi na sa iyo ang session kay {patient} sa {was}.' },
    request_received: { subject: 'Bagong kahilingan: {patient}', body: 'Humiling si {patient} ng {when}.' },
    patient_cancelled: { subject: 'Nagkansela ang pasyente: {patient}', body: 'Kinansela ni {patient} ang session sa {when}.' },
    needs_therapist: { subject: 'Kailangan ng therapist: {patient}', body: 'Kailangan ng therapist ang session ni {patient} sa {when}.' },
    reminder: { subject: 'Paalala sa session', body: 'Paalala: ang iyong session ay sa {when} kasama si {therapist}.' },
    session_reminder: { subject: 'Paalala sa session: {patient}', body: 'Paalala: naka-book sa iyo si {patient} sa {when}.' },
    place_open: { subject: 'May bakante na', body: 'May bakante na sa {when}. Makukuha ito ng unang mag-book.' },
  },
}

const LABELS = {
  en: { hello: 'Hello {name},', date: 'Date', time: 'Time', therapist: 'Therapist', location: 'Location', reference: 'Reference', reason: 'Reason', calendar: 'Add to calendar', open: 'Open Motivance', pending: 'To be assigned', unavailable: 'Your therapist is no longer available.', expired: 'The time passed before this request could be confirmed.' },
  fil: { hello: 'Kumusta {name},', date: 'Petsa', time: 'Oras', therapist: 'Therapist', location: 'Lokasyon', reference: 'Reference', reason: 'Dahilan', calendar: 'Idagdag sa kalendaryo', open: 'Buksan ang Motivance', pending: 'Itatalaga pa', unavailable: 'Hindi na available ang iyong therapist.', expired: 'Lumipas ang oras bago makumpirma ang kahilingang ito.' },
}

/** These kinds leave a session on the reader's calendar. A session that has gone needs no link to add it. */
const CALENDAR_KINDS = new Set(['confirmed', 'rescheduled', 'therapist_changed', 'session_assigned', 'session_moved'])

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '')
/** A subject is one header line, so a name must not be able to start another. */
const oneLine = (value: string) => value.replace(/[\r\n]+/g, ' ').trim()

function timeIn(delivery: Delivery) {
  const locale = delivery.language === 'fil' ? 'fil-PH' : 'en-PH'
  const day = new Intl.DateTimeFormat(locale, { timeZone: delivery.time_zone, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const time = new Intl.DateTimeFormat(locale, { timeZone: delivery.time_zone, hour: 'numeric', minute: '2-digit' })
  const clock = (iso: string) => time.format(new Date(iso)).replace(/\u202f/g, ' ')
  return { day: (iso: string) => day.format(new Date(iso)), clock }
}

export function renderEmail(delivery: Delivery, links: Links) {
  const lines = LINES[delivery.language][delivery.kind]
  if (!lines) throw new Error(`Unknown notification kind: ${delivery.kind}`)
  const label = LABELS[delivery.language]
  const { day, clock } = timeIn(delivery)
  const { data } = delivery
  const range = `${clock(data.starts_at)} – ${clock(data.ends_at)}`
  const was = data.previous_starts_at ?? data.starts_at
  const values = { when: `${day(data.starts_at)}, ${range}`, was: `${day(was)}, ${clock(was)}`, patient: data.patient_name ?? '', therapist: data.therapist_name ?? label.pending }
  const reason = data.reason === 'therapist_unavailable' ? label.unavailable : data.reason === 'request_expired' ? label.expired : data.reason ?? null
  // A place on the waitlist is a time, not yet a session, so it has no therapist or reference.
  const facts: Array<[string, string]> = [[label.date, day(data.starts_at)], [label.time, range]]
  if (data.reference_no) facts.push([label.therapist, data.therapist_name ?? label.pending])
  if (delivery.location) facts.push([label.location, delivery.location])
  if (data.reference_no) facts.push([label.reference, data.reference_no])
  if (reason) facts.push([label.reason, reason])
  const calendar = CALENDAR_KINDS.has(delivery.kind) && delivery.calendar_token ? `${links.functions}/booking-calendar?token=${encodeURIComponent(delivery.calendar_token)}` : null
  const hello = fill(label.hello, { name: delivery.name ?? '' }).replace(' ,', ',')
  const sentence = fill(lines.body, values)
  // The first to book gets a place, so this one goes straight to where it can be booked.
  const site = delivery.kind === 'place_open' ? `${links.site}/patient/bookings` : links.site

  const text = [hello, '', sentence, '', ...facts.map(([term, value]) => `${term}: ${value}`), '', ...(calendar ? [`${label.calendar}: ${calendar}`] : []), `${label.open}: ${site}`, '', delivery.center_name].join('\n')
  const button = (href: string, title: string) => `<a href="${escapeHtml(href)}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 16px;border-radius:8px;background:#0e7c86;color:#ffffff;text-decoration:none;font-weight:600">${escapeHtml(title)}</a>`
  const html = `<!doctype html><html lang="${delivery.language}"><body style="margin:0;padding:24px;background:#f1f5f4;font-family:Arial,sans-serif;color:#0f2b35">
<div style="max-width:520px;margin:0 auto;padding:24px;border-radius:12px;background:#ffffff">
<p style="margin:0 0 12px">${escapeHtml(hello)}</p>
<p style="margin:0 0 16px;font-size:17px;font-weight:600">${escapeHtml(sentence)}</p>
<table role="presentation" style="margin:0 0 20px;border-collapse:collapse">${facts.map(([term, value]) => `<tr><td style="padding:3px 16px 3px 0;color:#4c6670">${escapeHtml(term)}</td><td style="padding:3px 0;font-weight:600">${escapeHtml(value)}</td></tr>`).join('')}</table>
${calendar ? button(calendar, label.calendar) : ''}${button(site, label.open)}
<p style="margin:16px 0 0;font-size:13px;color:#4c6670">${escapeHtml(delivery.center_name)}</p>
</div></body></html>`
  return { subject: oneLine(fill(lines.subject, values)), text, html }
}
