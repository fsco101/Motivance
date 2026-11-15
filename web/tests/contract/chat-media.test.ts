import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  attachmentOf, CHAT_BUCKET, expired, loadChatConsent, loadConversations, loadMessages, mediaLink, MEDIA_LIMITS, sendAttachment, sendMedia,
  sendMessage, setChatConsent, startAttachment, uploadMedia, deleteMessage, type MediaDraft,
} from '../../src/data/chat'
import type { Database } from '../../src/data/database.types'
import { createUser, link, removeUsers, signedIn, sql, stack, type TestUser } from '../support/stack'

/** Photos and video in care chat against the real schema and the real Storage service. */
describe('chat media on the local backend', () => {
  const users: TestUser[] = []
  let therapist: TestUser
  let patient: TestUser
  let otherTherapist: TestUser
  let scheduler: TestUser
  let admin: TestUser
  let conversation: string
  const operator = () => createClient<Database>(stack().API_URL, stack().SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const bytes = (size: number, fill = 7) => new Blob([new Uint8Array(size).fill(fill)])
  const photo = (size = 200_000): MediaDraft => ({ kind: 'image', file: bytes(size), mime: 'image/jpeg', preview: bytes(20_000, 3), width: 1600, height: 1200, durationMs: null })
  const clip = (size = 3_000_000): MediaDraft => ({ kind: 'video', file: bytes(size), mime: 'video/webm', preview: bytes(20_000, 3), width: 854, height: 480, durationMs: 12_000 })
  const cleanup = () => execFileSync('python', ['../scripts/cleanup_chat_media.py', '--target', 'local', '--apply'], { encoding: 'utf8' })
  const stored = (path: string) => sql(`select count(*) from storage.objects where bucket_id='${CHAT_BUCKET}' and name='${path}'`)

  beforeAll(async () => {
    therapist = await createUser(['therapist'], 'Media Therapist')
    patient = await createUser(['patient'], 'Media Patient')
    otherTherapist = await createUser(['therapist'], 'Other Therapist')
    scheduler = await createUser(['scheduler'], 'Media Scheduler')
    admin = await createUser(['admin'], 'Media Admin')
    users.push(therapist, patient, otherTherapist, scheduler, admin)
    await link(therapist, patient)
    conversation = (await loadConversations(await signedIn(therapist)))[0]!.id
  }, 60_000)

  afterAll(() => {
    removeUsers(users)
    // Removing the accounts queued their files; this takes them out of Storage too.
    cleanup()
  })

  it('needs the second version of the agreement for media, while words work on the first', async () => {
    const person = await signedIn(patient)
    // A patient who agreed before photos existed.
    sql(`insert into public.consents(patient_id,consent_type,version,event,client_event_id,occurred_at) values('${patient.id}','care-chat','care-chat-v1','granted',gen_random_uuid(),now()-interval '1 day')`)
    expect(await loadChatConsent(person)).toMatchObject({ version: 'care-chat-v2', granted: true, media: false, accepted_version: 'care-chat-v1' })
    const staff = await signedIn(therapist)
    await expect(sendMessage(staff, randomUUID(), conversation, 'Words still work')).resolves.toMatchObject({ kind: 'text' })
    await expect(sendMedia(staff, randomUUID(), conversation, photo(), '')).rejects.toMatchObject({ message: 'chat_media_consent_required' })
    expect(await loadConversations(staff)).toMatchObject([{ consented: true, media: false }])
    // Agreeing again records the current version.
    expect(await setChatConsent(person, true)).toMatchObject({ granted: true, media: true, accepted_version: 'care-chat-v2' })
    expect(await loadConversations(staff)).toMatchObject([{ consented: true, media: true }])
  })

  it('sends a photo and a video that the other person can open, and nobody else can', async () => {
    const [staff, person] = await Promise.all([signedIn(therapist), signedIn(patient)])
    const image = await sendMedia(staff, randomUUID(), conversation, photo(), 'Your posture yesterday')
    const video = await sendMedia(person, randomUUID(), conversation, clip(), '')
    expect(image).toMatchObject({ kind: 'attachment', body: 'Your posture yesterday', senderId: therapist.id })
    const shownImage = attachmentOf((await loadMessages(person, conversation)).messages.find((m) => m.id === image.id)!)!
    expect(shownImage).toMatchObject({ kind: 'image', mime: 'image/jpeg', width: 1600, height: 1200, bytes: 200_000 })
    expect(expired(shownImage)).toBe(false)
    expect(Date.parse(shownImage.expiresAt) - Date.now()).toBeGreaterThan(14.9 * 86_400_000)
    const shownVideo = attachmentOf((await loadMessages(staff, conversation)).messages.find((m) => m.id === video.id)!)!
    expect(shownVideo).toMatchObject({ kind: 'video', mime: 'video/webm', durationMs: 12_000, bytes: 3_000_000 })

    // The other person opens both.
    for (const [db, path, size] of [[person, shownImage.mediaPath, 200_000], [staff, shownVideo.mediaPath, 3_000_000], [person, shownImage.previewPath, 20_000]] as const) {
      const response = await fetch(await mediaLink(db, path))
      expect(response.status).toBe(200)
      expect((await response.arrayBuffer()).byteLength).toBe(size)
    }
    // Nobody else can, by link or by path, and nobody can list the bucket.
    for (const outsider of [otherTherapist, scheduler, admin]) {
      const db = await signedIn(outsider)
      await expect(mediaLink(db, shownImage.mediaPath)).rejects.toBeTruthy()
      expect((await db.storage.from(CHAT_BUCKET).download(shownVideo.mediaPath)).error).toBeTruthy()
      expect((await db.storage.from(CHAT_BUCKET).list(conversation)).data ?? []).toEqual([])
    }
    // The public address of a private bucket gives nothing.
    expect((await fetch(`${stack().API_URL}/storage/v1/object/public/${CHAT_BUCKET}/${shownImage.mediaPath}`)).status).toBeGreaterThanOrEqual(400)
  })

  it('refuses files of the wrong type, size or shape, and leaves nothing behind', async () => {
    const staff = await signedIn(therapist)
    await expect(startAttachment(staff, randomUUID(), conversation, { kind: 'image', mime: 'image/gif', width: 100, height: 100, durationMs: null })).rejects.toMatchObject({ message: 'chat_media_invalid' })
    await expect(startAttachment(staff, randomUUID(), conversation, { kind: 'image', mime: 'image/jpeg', width: 4000, height: 3000, durationMs: null })).rejects.toMatchObject({ message: 'chat_media_too_large' })
    await expect(startAttachment(staff, randomUUID(), conversation, { kind: 'video', mime: 'video/mp4', width: 1920, height: 1080, durationMs: 10_000 })).rejects.toMatchObject({ message: 'chat_media_too_large' })
    await expect(startAttachment(staff, randomUUID(), conversation, { kind: 'video', mime: 'video/mp4', width: 854, height: 480, durationMs: 45_000 })).rejects.toMatchObject({ message: 'chat_media_too_large' })

    // A photo over its limit is stored by Storage, then refused when it is sent, and queued for removal.
    const id = randomUUID()
    const places = await startAttachment(staff, id, conversation, photo())
    await uploadMedia(staff, places.mediaPath, bytes(MEDIA_LIMITS.image + 1), 'image/jpeg')
    await uploadMedia(staff, places.previewPath, bytes(1_000), 'image/jpeg')
    await expect(sendAttachment(staff, id, '')).rejects.toMatchObject({ message: 'chat_media_too_large' })
    expect(sql(`select count(*) from public.chat_messages where id='${id}'`)).toBe('0')
    expect(sql(`select count(*) from public.chat_media_trash where path='${places.mediaPath}'`)).toBe('1')

    // A file whose stored type differs from what was agreed is refused the same way; a type the bucket does not take is refused by Storage.
    const lying = randomUUID()
    const lie = await startAttachment(staff, lying, conversation, photo())
    await uploadMedia(staff, lie.mediaPath, bytes(1_000), 'image/webp')
    await uploadMedia(staff, lie.previewPath, bytes(1_000), 'image/jpeg')
    await expect(sendAttachment(staff, lying, '')).rejects.toMatchObject({ message: 'chat_media_too_large' })
    const other = await startAttachment(staff, randomUUID(), conversation, photo())
    await expect(uploadMedia(staff, other.mediaPath, bytes(1_000), 'image/png')).rejects.toBeTruthy()

    // Sending before the files are there fails clearly.
    const early = randomUUID()
    await startAttachment(staff, early, conversation, photo())
    await expect(sendAttachment(staff, early, '')).rejects.toMatchObject({ message: 'chat_media_missing' })
  })

  it('lets files go only where the server said, and only for whoever started them', async () => {
    const [staff, person] = await Promise.all([signedIn(therapist), signedIn(patient)])
    expect((await staff.storage.from(CHAT_BUCKET).upload(`${conversation}/${randomUUID()}/media.jpg`, bytes(100), { contentType: 'image/jpeg' })).error).toBeTruthy()
    const places = await startAttachment(staff, randomUUID(), conversation, photo())
    expect((await person.storage.from(CHAT_BUCKET).upload(places.mediaPath, bytes(100), { contentType: 'image/jpeg' })).error).toBeTruthy()
    // Once there, a file cannot be replaced.
    await uploadMedia(staff, places.mediaPath, bytes(100), 'image/jpeg')
    expect((await staff.storage.from(CHAT_BUCKET).upload(places.mediaPath, bytes(200), { contentType: 'image/jpeg', upsert: true })).error).toBeTruthy()
  })

  it('stops a signed link working once it expires', async () => {
    const person = await signedIn(patient)
    const message = (await loadMessages(person, conversation)).messages.find((m) => attachmentOf(m)?.kind === 'image')!
    const link = await mediaLink(person, attachmentOf(message)!.mediaPath, 1)
    expect((await fetch(link)).status).toBe(200)
    await new Promise((resolve) => setTimeout(resolve, 2_500))
    expect((await fetch(link)).status).toBeGreaterThanOrEqual(400)
  })

  it('caps videos per conversation over 30 days', async () => {
    const staff = await signedIn(therapist)
    const tag = randomUUID()
    sql(`insert into public.chat_attachments(id,conversation_id,uploader_id,kind,mime,width,height,duration_ms,media_path,preview_path,sent_at,expires_at,removed_at)
      select gen_random_uuid(),'${conversation}','${therapist.id}','video','video/mp4',854,480,1000,'cap/${tag}/'||g||'/m','cap/${tag}/'||g||'/p',now(),now()+interval '15 days',now() from generate_series(1,19) g`)
    await expect(startAttachment(staff, randomUUID(), conversation, clip())).rejects.toMatchObject({ message: 'chat_video_cap' })
    await expect(startAttachment(staff, randomUUID(), conversation, photo())).resolves.toBeTruthy()
    sql(`delete from public.chat_attachments where media_path like 'cap/${tag}/%'`)
  })

  it('closes a file on day 15, and the cleanup removes it from Storage', async () => {
    const person = await signedIn(patient)
    const image = await sendMedia(await signedIn(therapist), randomUUID(), conversation, photo(), '')
    const shown = attachmentOf(image)!
    expect(stored(shown.mediaPath)).toBe('1')
    sql(`update public.chat_attachments set expires_at=now()-interval '1 second' where id='${image.id}'`)
    await expect(mediaLink(person, shown.mediaPath)).rejects.toBeTruthy()
    expect(cleanup()).toMatch(/Removed and marked \d+ of \d+/)
    expect(stored(shown.mediaPath)).toBe('0')
    expect(stored(shown.previewPath)).toBe('0')
    expect(sql(`select removed_at is not null from public.chat_attachments where id='${image.id}'`)).toBe('t')
    // The message stays, and the time it carries says it has expired.
    const kept = (await loadMessages(person, conversation)).messages.find((m) => m.id === image.id)!
    expect(expired(attachmentOf(kept)!)).toBe(false) // The message still carries the original date; the screen compares it with the clock.
    sql(`update public.chat_messages set data=jsonb_set(data,'{expires_at}',to_jsonb(now()-interval '1 second')) where id='${image.id}'`)
    expect(expired(attachmentOf((await loadMessages(person, conversation)).messages.find((m) => m.id === image.id)!)!)).toBe(true)
  })

  it('removes an upload that was started and never sent', async () => {
    const staff = await signedIn(therapist)
    const id = randomUUID()
    const places = await startAttachment(staff, id, conversation, photo())
    await uploadMedia(staff, places.mediaPath, bytes(1_000), 'image/jpeg')
    sql(`update public.chat_attachments set created_at=now()-interval '2 hours' where id='${id}'`)
    cleanup()
    expect(stored(places.mediaPath)).toBe('0')
  })

  it('a photo taken back is closed at once', async () => {
    const staff = await signedIn(therapist)
    const image = await sendMedia(staff, randomUUID(), conversation, photo(), '')
    await deleteMessage(staff, image.id)
    await expect(mediaLink(await signedIn(patient), attachmentOf(image)!.mediaPath)).rejects.toBeTruthy()
  })

  it('includes files in the export, and removes them with an erasure', async () => {
    const image = await sendMedia(await signedIn(therapist), randomUUID(), conversation, photo(), 'For the record')
    const { data } = await operator().rpc('export_patient_chat', { p_patient: patient.id })
    const messages = (data as { conversations: Array<{ messages: Array<{ text: string; attachment: { kind: string; file: string | null } | null }> }> }).conversations[0]!.messages
    expect(messages.find((m) => m.text === 'For the record')!.attachment).toMatchObject({ kind: 'image', file: attachmentOf(image)!.mediaPath })
    const { error } = await (await signedIn(patient)).rpc('request_patient_data', { p_id: randomUUID(), p_kind: 'delete' })
    expect(error).toBeNull()
    expect((await operator().rpc('erase_patient_chat', { p_patient: patient.id })).error).toBeNull()
    expect(stored(attachmentOf(image)!.mediaPath)).toBe('1')
    cleanup()
    expect(stored(attachmentOf(image)!.mediaPath)).toBe('0')
    expect(sql(`select count(*) from storage.objects where bucket_id='${CHAT_BUCKET}' and name like '${conversation}/%'`)).toBe('0')
  })
})
