import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { loadSessionVideos, shareSessionVideo, startSessionVideo, stopSharingVideo, uploadVideoFile, videoLink } from '../../src/data/sessionVideos'
import { publishPrescription } from '../../src/data/therapist'
import { createUser, ingestSession, link, removeUsers, signedIn, sql, stack, type TestUser } from '../support/stack'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/data/database.types'

/** Session videos shared with the therapist (#129), against the real schema and Storage. */
const ELBOW = '21000000-0000-0000-0000-000000000001'
const timing = { focus: 'ELBOW' as const, minimumCycleMs: 600, maximumCycleMs: 30000, peakHoldMs: 100, maxTrunkLean: 20, confidence: 0.7 }
const video = () => new Blob([new Uint8Array(4096).fill(7)], { type: 'video/mp4' })
const still = (bytes = 2048) => new Blob([new Uint8Array(bytes).fill(9)], { type: 'image/jpeg' })
const failure = async (work: Promise<unknown>) => (await work.then(() => null, (error: unknown) => error)) as { code?: string; message?: string } | null

describe('session videos on the local backend', () => {
  const users: TestUser[] = []
  let therapist: TestUser
  let colleague: TestUser
  let stranger: TestUser
  let admin: TestUser
  let patient: TestUser
  let other: TestUser
  let version = ''

  /** A finished session on the server, as the phone uploads it. */
  const session = async () => {
    await ingestSession(patient, version, { kind: 'ELBOW_FLEXION', side: 'LEFT', low: 20, high: 90, target: 8, focusJoint: 'ELBOW', min: 22, max: 88, completed: 8 })
    return sql(`select id from public.sessions where patient_id='${patient.id}' order by started_at desc limit 1`)
  }
  /** All of the phone's steps. */
  const shared = async (sessionId: string) => {
    const db = await signedIn(patient)
    const id = randomUUID()
    const places = await startSessionVideo(db, id, sessionId, 480, 270, 95_000)
    await uploadVideoFile(db, places.mediaPath, video(), 'video/mp4')
    await uploadVideoFile(db, places.previewPath, still(), 'image/jpeg')
    return shareSessionVideo(db, id)
  }
  const visible = async (who: TestUser) => (await loadSessionVideos(await signedIn(who), patient.id)).map((item) => item.id)

  beforeAll(async () => {
    ;[therapist, colleague, stranger, admin, patient, other] = await Promise.all([
      createUser(['therapist'], 'Video Therapist'), createUser(['therapist'], 'Second Therapist'), createUser(['therapist'], 'Stranger Therapist'),
      createUser(['admin'], 'Video Admin'), createUser(['patient'], 'Video Patient'), createUser(['patient'], 'Other Patient'),
    ])
    users.push(therapist, colleague, stranger, admin, patient, other)
    await link(therapist, patient)
    await link(colleague, patient)
    version = randomUUID()
    await publishPrescription(await signedIn(therapist), { ...timing, assignmentId: randomUUID(), requestId: version, patientId: patient.id, exerciseId: ELBOW, side: 'left', low: 20, high: 90, repetitions: 8 })
  }, 90_000)

  // Each test starts with a fresh hour, so the limit of five uploads an hour is tested on its own.
  beforeEach(() => { sql(`update public.session_videos set created_at=created_at-interval '2 hours' where patient_id='${patient.id}'`) })

  afterAll(async () => {
    // Storage files can only be removed through the Storage API, as with profile photos.
    const paths = sql(`select name from storage.objects where bucket_id='session-videos' and split_part(name,'/',1)='${patient.id}'`).split(/\r?\n/).filter(Boolean)
    const { API_URL, SERVICE_ROLE_KEY } = stack()
    if (paths.length) await createClient<Database>(API_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } }).storage.from('session-videos').remove(paths)
    sql(`begin; set local session_replication_role=replica; delete from public.session_videos where patient_id='${patient.id}'; delete from public.session_video_trash; commit;`)
    removeUsers(users)
  })

  it('shares a video for 15 days with the patient and the exercise\'s therapist only', async () => {
    const shown = await shared(await session())
    expect(Math.round((Date.parse(shown.expiresAt) - Date.parse(shown.sharedAt)) / 86_400_000)).toBe(15)
    expect(await visible(patient)).toContain(shown.id)
    expect(await visible(therapist)).toContain(shown.id)
    // Another linked therapist, an unlinked one and an administrator see nothing, and cannot open the file.
    for (const outsider of [colleague, stranger, admin, other]) {
      expect(await visible(outsider)).toEqual([])
      expect(await failure(videoLink(await signedIn(outsider), shown.mediaPath))).not.toBeNull()
    }
    expect(await videoLink(await signedIn(therapist), shown.mediaPath)).toMatch(/^http/)
    expect(await videoLink(await signedIn(patient), shown.previewPath)).toMatch(/^http/)
  })

  it('shows nothing to the therapist until the patient shares it', async () => {
    const db = await signedIn(patient)
    const id = randomUUID()
    const places = await startSessionVideo(db, id, await session(), 480, 270, 60_000)
    await uploadVideoFile(db, places.mediaPath, video(), 'video/mp4')
    expect(await visible(therapist)).not.toContain(id)
    expect(await failure(videoLink(await signedIn(therapist), places.mediaPath))).not.toBeNull()
    // Sharing needs both files.
    expect((await failure(shareSessionVideo(db, id)))?.message).toBe('video_missing')
  })

  it('stops sharing at once when the patient says so, and queues the files for removal', async () => {
    const shown = await shared(await session())
    await stopSharingVideo(await signedIn(patient), shown.id)
    expect(await visible(therapist)).not.toContain(shown.id)
    expect(await visible(patient)).not.toContain(shown.id)
    expect(await failure(videoLink(await signedIn(therapist), shown.mediaPath))).not.toBeNull()
    expect(sql(`select count(*) from unnest(public.session_video_due(1000)) p where p in ('${shown.mediaPath}','${shown.previewPath}')`)).toBe('2')
    // Someone else cannot stop it for them.
    const again = await shared(await session())
    expect((await failure(stopSharingVideo(await signedIn(therapist), again.id)))?.message).toBe('video_invalid')
  })

  it('hides a video once its 15 days are over, and the cleanup can mark it removed', async () => {
    const shown = await shared(await session())
    sql(`update public.session_videos set expires_at=now()-interval '1 minute' where id='${shown.id}'`)
    expect(await visible(therapist)).not.toContain(shown.id)
    expect(await failure(videoLink(await signedIn(patient), shown.mediaPath))).not.toBeNull()
    // The cleanup removes the files through the Storage API and marks the video removed.
    const out = execFileSync('python', ['../scripts/cleanup_chat_media.py', '--target', 'local', '--apply'], { encoding: 'utf8' })
    expect(out).toMatch(/session video file\(s\) due for removal/)
    expect(sql(`select count(*) from storage.objects where bucket_id='session-videos' and name in ('${shown.mediaPath}','${shown.previewPath}')`)).toBe('0')
    expect(sql(`select removed_at is not null from public.session_videos where id='${shown.id}'`)).toBe('t')
  })

  it('ends the therapist\'s access when their link ends', async () => {
    const shown = await shared(await session())
    sql(`update public.therapist_patients set active=false where therapist_id='${therapist.id}' and patient_id='${patient.id}'`)
    expect(await visible(therapist)).not.toContain(shown.id)
    expect(await visible(patient)).toContain(shown.id)
    expect((await failure(startSessionVideo(await signedIn(patient), randomUUID(), await session().catch(() => ''), 480, 270, 1000)))).not.toBeNull()
    sql(`update public.therapist_patients set active=true where therapist_id='${therapist.id}' and patient_id='${patient.id}'`)
  })

  it('refuses what the server did not agree to', async () => {
    const db = await signedIn(patient)
    const sessionId = await session()
    expect((await failure(startSessionVideo(db, randomUUID(), sessionId, 480, 270, 301_000)))?.message).toBe('video_too_large')
    expect((await failure(startSessionVideo(db, randomUUID(), sessionId, 1280, 720, 60_000)))?.message).toBe('video_too_large')
    expect((await failure(startSessionVideo(await signedIn(other), randomUUID(), sessionId, 480, 270, 60_000)))?.message).toBe('video_session_missing')
    expect((await failure(startSessionVideo(await signedIn(therapist), randomUUID(), sessionId, 480, 270, 60_000)))?.code).toBe('42501')
    // A preview over its limit is refused at sharing, and the files are queued for removal.
    const id = randomUUID()
    const places = await startSessionVideo(db, id, sessionId, 480, 270, 60_000)
    await uploadVideoFile(db, places.mediaPath, video(), 'video/mp4')
    await uploadVideoFile(db, places.previewPath, still(210_000), 'image/jpeg')
    expect((await failure(shareSessionVideo(db, id)))?.message).toBe('video_too_large')
    expect(sql(`select count(*) from public.session_videos where id='${id}'`)).toBe('0')
    expect(sql(`select count(*) from public.session_video_trash where path in ('${places.mediaPath}','${places.previewPath}')`)).toBe('2')
    // Only one live share per session.
    await shared(sessionId)
    expect((await failure(startSessionVideo(db, randomUUID(), sessionId, 480, 270, 60_000)))?.message).toBe('video_already_shared')
  })

  it('allows five uploads an hour', async () => {
    const db = await signedIn(patient)
    for (let index = 0; index < 5; index += 1) await startSessionVideo(db, randomUUID(), await session(), 480, 270, 1000)
    expect((await failure(startSessionVideo(db, randomUUID(), await session(), 480, 270, 1000)))?.message).toBe('video_rate_limited')
  })

  it('cannot be written around the functions', async () => {
    const db = await signedIn(patient)
    const direct = await db.from('session_videos').insert({ id: randomUUID(), session_id: await session(), patient_id: patient.id, therapist_id: therapist.id, width: 480, height: 270, duration_ms: 1, media_path: 'x', preview_path: 'y' })
    expect(direct.error).not.toBeNull()
    // Uploading to a place the server never issued is refused.
    expect(await failure(uploadVideoFile(db, `${patient.id}/${randomUUID()}/media.mp4`, video(), 'video/mp4'))).not.toBeNull()
  })
})
