import { describe, expect, it } from 'vitest'
import { accessToken, fcmUrl, pushMessage, pushOutcome, readServiceAccount, sendToDevices, signedAssertion, type PushDelivery, type ServiceAccount } from '../../../supabase/functions/_shared/push'

const delivery = (overrides: Partial<PushDelivery> = {}): PushDelivery => ({
  id: 'd1', kind: 'confirmed', email: null, name: 'Ana', language: 'en', calendar_token: 'secret', location: '12 Mabini Street', center_name: 'Motivance', time_zone: 'Asia/Manila', booking_id: 'b1', tokens: ['one'],
  data: { reference_no: 'BK-2026-000001', starts_at: '2026-12-07T01:00:00Z', ends_at: '2026-12-07T02:00:00Z', therapist_name: 'Dana Reyes', patient_name: 'Ana Dela Cruz' }, ...overrides,
})

async function serviceAccount(): Promise<{ account: ServiceAccount; publicKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  const body = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64')
  return { publicKey: pair.publicKey, account: { project_id: 'motivance-test', client_email: 'push@motivance-test.iam.gserviceaccount.com', private_key: `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`, token_uri: 'https://stub.test/token' } }
}

const answer = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status })
const fcmError = (code: string) => ({ error: { details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: code }] } })

describe('a push message', () => {
  it('carries only data, so the app builds the notification and a lock screen stays private', () => {
    const { message } = pushMessage('one', delivery())
    expect(message.token).toBe('one')
    expect(message).not.toHaveProperty('notification')
    expect(message.android.priority).toBe('HIGH')
    expect(message.data).toMatchObject({ title: 'Your session is confirmed', kind: 'confirmed', booking_id: 'b1' })
    expect(message.data.body).toContain('Dana Reyes')
    expect(Object.values(message.data).every((value) => typeof value === 'string')).toBe(true)
  })

  it('uses the same words as the email, in the reader\'s language', () => {
    expect(pushMessage('one', delivery({ language: 'fil' })).message.data.title).toBe('Kumpirmado ang iyong session')
  })

  it('sends nothing secret', () => {
    expect(JSON.stringify(pushMessage('one', delivery()))).not.toContain('secret')
  })

  it('leaves a booking out when there is none, because FCM takes only strings', () => {
    expect(pushMessage('one', delivery({ kind: 'place_open', booking_id: null })).message.data.booking_id).toBe('')
  })
})

describe('what FCM answers', () => {
  it.each([[200, '{}', 'sent'], [404, '{}', 'dead'], [404, JSON.stringify(fcmError('UNREGISTERED')), 'dead'], [403, JSON.stringify(fcmError('SENDER_ID_MISMATCH')), 'dead'], [400, JSON.stringify(fcmError('INVALID_ARGUMENT')), 'dead'],
    [429, JSON.stringify(fcmError('QUOTA_EXCEEDED')), 'retry'], [500, '{}', 'retry'], [503, JSON.stringify(fcmError('UNAVAILABLE')), 'retry'], [401, '{}', 'retry'], [403, '{}', 'retry']] as const)('%i %s means %s', (status, body, outcome) => {
    expect(pushOutcome(status, body)).toBe(outcome)
  })

  it('counts any phone that got it as sent, because trying again would repeat it there', async () => {
    const send = async (_: unknown, init?: RequestInit) => (String(init?.body).includes('"token":"good"') ? answer(200) : answer(404, fcmError('UNREGISTERED')))
    expect(await sendToDevices(delivery({ tokens: ['good', 'gone'] }), 'https://stub.test', 'token', send as typeof fetch)).toMatchObject({ overall: 'sent', dead: ['gone'] })
  })

  it('tries again while a phone may come back, and gives up on one that is gone', async () => {
    const send = async (_: unknown, init?: RequestInit) => (String(init?.body).includes('"token":"busy"') ? answer(503) : answer(404))
    expect(await sendToDevices(delivery({ tokens: ['busy', 'gone'] }), 'https://stub.test', 'token', send as typeof fetch)).toMatchObject({ overall: 'retry', dead: ['gone'], detail: 'FCM 503' })
    expect(await sendToDevices(delivery({ tokens: ['gone'] }), 'https://stub.test', 'token', send as typeof fetch)).toMatchObject({ overall: 'dead', dead: ['gone'] })
  })

  it('sends with the access token, to the project\'s address', async () => {
    let seen: { url: string; authorization: string | null } | undefined
    const send = async (url: unknown, init?: RequestInit) => { seen = { url: String(url), authorization: new Headers(init?.headers).get('Authorization') }; return answer(200) }
    const { account } = await serviceAccount()
    await sendToDevices(delivery(), fcmUrl('https://fcm.googleapis.com/', account), 'access-token', send as typeof fetch)
    expect(seen).toEqual({ url: 'https://fcm.googleapis.com/v1/projects/motivance-test/messages:send', authorization: 'Bearer access-token' })
  })
})

describe('a service account', () => {
  it('needs its three fields, and reaches Google by default', () => {
    expect(() => readServiceAccount('{"project_id":"p"}')).toThrow('FCM_SERVICE_ACCOUNT')
    expect(readServiceAccount('{"project_id":"p","client_email":"e","private_key":"k"}').token_uri).toBe('https://oauth2.googleapis.com/token')
  })

  it('signs a request Google can check, for the messaging scope only, for one hour', async () => {
    const { account, publicKey } = await serviceAccount()
    const [header, claims, signature] = (await signedAssertion(account, 1_000)).split('.') as [string, string, string]
    const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString()) as Record<string, unknown>
    expect(decode(header)).toEqual({ alg: 'RS256', typ: 'JWT' })
    expect(decode(claims)).toEqual({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: account.token_uri, iat: 1_000, exp: 4_600 })
    expect(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, Buffer.from(signature, 'base64url'), new TextEncoder().encode(`${header}.${claims}`))).toBe(true)
  })

  it('exchanges it for an access token, and says so if it cannot', async () => {
    const { account } = await serviceAccount()
    expect(await accessToken(account, (async () => answer(200, { access_token: 'abc' })) as typeof fetch)).toBe('abc')
    await expect(accessToken(account, (async () => answer(401)) as typeof fetch)).rejects.toThrow('Could not get an FCM access token (401)')
  })
})
