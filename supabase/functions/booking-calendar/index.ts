import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import { renderCalendar, type CalendarBooking } from '../_shared/ics.ts'

const required = (name: string) => {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

/** Public by design, because a calendar app has no way to sign in. The long random token is the only key, and the file names no patient. */
Deno.serve(async (request) => {
  const token = new URL(request.url).searchParams.get('token')
  if (!token || !/^[0-9a-f]{48}$/.test(token)) return new Response('Not found', { status: 404 })
  const db = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await db.rpc('booking_calendar', { p_token: token })
  if (error) return new Response('Unavailable', { status: 503 })
  if (!data) return new Response('Not found', { status: 404 })
  return new Response(renderCalendar(data as CalendarBooking), {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="motivance-session.ics"', 'Cache-Control': 'no-store' },
  })
})
