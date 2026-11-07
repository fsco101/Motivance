/** Plain functions with no Deno in them, so the web tests can run them directly. The network is passed in. */
import { renderEmail, type Delivery } from './email.ts'

export type ServiceAccount = { project_id: string; client_email: string; private_key: string; token_uri: string }
export type PushDelivery = Delivery & { tokens: string[]; booking_id: string | null }
export type PushOutcome = 'sent' | 'dead' | 'retry'

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token'

/** Read once, so a pasted file with a field missing fails loudly here rather than on every send. */
export function readServiceAccount(raw: string): ServiceAccount {
  const account = JSON.parse(raw) as Partial<ServiceAccount>
  if (!account.project_id || !account.client_email || !account.private_key) throw new Error('FCM_SERVICE_ACCOUNT needs project_id, client_email and private_key')
  return { project_id: account.project_id, client_email: account.client_email, private_key: account.private_key, token_uri: account.token_uri || DEFAULT_TOKEN_URI }
}

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const encoded = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)))

function pemBytes(pem: string) {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  return Uint8Array.from(atob(body), (character) => character.charCodeAt(0))
}

/** The signed request a Google service account exchanges for an access token. */
export async function signedAssertion(account: ServiceAccount, now = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey('pkcs8', pemBytes(account.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const unsigned = `${encoded({ alg: 'RS256', typ: 'JWT' })}.${encoded({ iss: account.client_email, scope: SCOPE, aud: account.token_uri, iat: now, exp: now + 3600 })}`
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))
  return `${unsigned}.${base64url(new Uint8Array(signature))}`
}

export async function accessToken(account: ServiceAccount, send: typeof fetch = fetch) {
  const response = await send(account.token_uri, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: await signedAssertion(account) }).toString(),
  })
  if (!response.ok) throw new Error(`Could not get an FCM access token (${response.status})`)
  return (await response.json() as { access_token: string }).access_token
}

/**
 * Data only, so the app always builds the notification itself: a lock screen shows the private version rather than a patient's name.
 * The words are the email's, so the two cannot disagree, and they arrive in the reader's language because the server knows it.
 */
export function pushMessage(token: string, delivery: PushDelivery) {
  const { subject, sentence } = renderEmail(delivery, { site: '', functions: '' })
  return { message: { token, data: { title: subject, body: sentence, kind: delivery.kind, booking_id: delivery.booking_id ?? '' }, android: { priority: 'HIGH' as const } } }
}

/** What FCM's answer means for this token. A bad token will never work, and anything else may work later. */
export function pushOutcome(status: number, body: string): PushOutcome {
  if (status >= 200 && status < 300) return 'sent'
  const code = /"errorCode"\s*:\s*"([A-Z_]+)"/.exec(body)?.[1]
  if (status === 404 || code === 'UNREGISTERED' || code === 'SENDER_ID_MISMATCH' || (status === 400 && code === 'INVALID_ARGUMENT')) return 'dead'
  return 'retry'
}

export const fcmUrl = (base: string, account: ServiceAccount) => `${base.replace(/\/$/, '')}/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`

/**
 * One delivery reaches every phone the person has. Any phone that got it counts as sent, because trying again would repeat it there.
 * Otherwise a phone that may come back means trying again, and only dead phones means nobody is left to reach.
 */
export async function sendToDevices(delivery: PushDelivery, url: string, token: string, send: typeof fetch = fetch) {
  const outcomes: Array<{ device: string; outcome: PushOutcome; detail: string }> = []
  for (const device of delivery.tokens) {
    const response = await send(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(pushMessage(device, delivery)) })
    const body = await response.text()
    outcomes.push({ device, outcome: pushOutcome(response.status, body), detail: `FCM ${response.status}` })
  }
  const dead = outcomes.filter((item) => item.outcome === 'dead').map((item) => item.device)
  const overall: PushOutcome = outcomes.some((item) => item.outcome === 'sent') ? 'sent' : outcomes.some((item) => item.outcome === 'retry') ? 'retry' : 'dead'
  return { overall, dead, detail: outcomes.find((item) => item.outcome === 'retry')?.detail ?? null }
}
