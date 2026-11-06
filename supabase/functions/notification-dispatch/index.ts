import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import nodemailer from 'npm:nodemailer@6.9.16'
import { renderEmail, type Delivery } from '../_shared/email.ts'

const required = (name: string) => {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

/** Compares without stopping at the first difference, so the time taken says nothing about the secret. */
function sameSecret(given: string | null, expected: string) {
  if (given === null || given.length !== expected.length) return false
  let difference = 0
  for (let index = 0; index < expected.length; index += 1) difference |= given.charCodeAt(index) ^ expected.charCodeAt(index)
  return difference === 0
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (request) => {
  if (!sameSecret(request.headers.get('x-dispatch-secret'), required('NOTIFICATION_DISPATCH_SECRET'))) return json({ error: 'Not allowed' }, 401)

  const db = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
  const port = Number(required('NOTIFICATION_SMTP_PORT'))
  const user = Deno.env.get('SMTP_USER')
  const transport = nodemailer.createTransport({ host: required('SMTP_HOST'), port, secure: port === 465, auth: user ? { user, pass: required('SMTP_PASS') } : undefined })
  const from = { name: Deno.env.get('SMTP_SENDER_NAME') ?? 'Motivance', address: required('SMTP_FROM_EMAIL') }
  const links = { site: required('PUBLIC_SITE_URL'), functions: required('PUBLIC_FUNCTIONS_URL') }

  const { data, error } = await db.rpc('claim_notification_deliveries', { p_channel: 'email', p_limit: 20 })
  if (error) return json({ error: 'Could not read the queue' }, 500)
  const claimed = data as Delivery[]

  const results = { sent: 0, failed: 0 }
  for (const delivery of claimed) {
    try {
      if (!delivery.email) throw new Error('No email address')
      await transport.sendMail({ from, to: delivery.email, ...renderEmail(delivery, links) })
      await db.rpc('finish_notification_delivery', { p_id: delivery.id, p_sent: true })
      results.sent += 1
    } catch (failure) {
      // Only the message: an SMTP error can quote the conversation, but never the password.
      await db.rpc('finish_notification_delivery', { p_id: delivery.id, p_sent: false, p_error: failure instanceof Error ? failure.message : 'Send failed' })
      results.failed += 1
    }
  }
  return json({ claimed: claimed.length, ...results })
})
