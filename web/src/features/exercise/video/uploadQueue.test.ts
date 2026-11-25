import { describe, expect, it } from 'vitest'
import type { SessionVideo } from '@/data/sessionVideos'
import { memoryStore, refusalOf, VideoQueue, type Uploader } from './uploadQueue'

const draft = { file: new Blob([new Uint8Array(64)], { type: 'video/mp4' }), preview: new Blob([new Uint8Array(8)], { type: 'image/jpeg' }), width: 480, height: 270, durationMs: 30_000 }
const shared = (id: string, sessionId: string): SessionVideo => ({ id, sessionId, patientId: 'ana', therapistId: 't', width: 480, height: 270, durationMs: 30_000,
  mediaPath: `ana/${id}.mp4`, previewPath: `ana/${id}.jpg`, sharedAt: '2026-11-25T00:00:00Z', expiresAt: '2026-12-10T00:00:00Z' })

/** A stand-in for the server: `fail` decides what each step answers, and `calls` records what was asked. */
function server() {
  const calls: string[] = []
  let fail: (step: string) => Error | null = () => null
  const step = async (name: string) => { calls.push(name); const error = fail(name); if (error) throw error }
  const uploader: Uploader = {
    start: async (id) => { await step('start'); return { mediaPath: `ana/${id}.mp4`, previewPath: `ana/${id}.jpg` } },
    upload: async (path) => { await step(path.endsWith('.mp4') ? 'media' : 'preview') },
    share: async (id) => { await step('share'); return shared(id, 's1') },
  }
  return { calls, uploader, failWith: (next: (step: string) => Error | null) => { fail = next } }
}
const offlineError = () => new TypeError('Failed to fetch')

/** The cases Android's VideoUploadQueueTest covers too (#175). */
describe('the video upload queue', () => {
  it('waits while offline, then uploads by itself once online', async () => {
    const store = memoryStore()
    const remote = server()
    let online = false
    const queue = new VideoQueue(store, () => remote.uploader, () => online)
    await queue.enqueue('ana', 's1', draft, 'v1')
    expect(await queue.drain('ana')).toBe(true)
    expect(remote.calls).toEqual([])
    expect((await queue.list('ana'))[0]?.state).toBe('waiting')
    online = true
    const events: string[] = []
    queue.subscribe((event) => events.push(event.kind))
    expect(await queue.drain('ana')).toBe(false)
    expect(remote.calls).toEqual(['start', 'media', 'preview', 'share'])
    expect(await queue.list('ana')).toEqual([])
    expect(events).toContain('shared')
  })

  it('waits for the session’s own result before the video can go', async () => {
    const remote = server()
    const queue = new VideoQueue(memoryStore(), () => remote.uploader, () => true)
    await queue.enqueue('ana', 's1', draft, 'v1')
    remote.failWith((step) => (step === 'start' ? new Error('video_session_missing') : null))
    expect(await queue.drain('ana')).toBe(true)
    expect((await queue.list('ana'))[0]).toMatchObject({ state: 'waiting', reason: null })
    remote.failWith(() => null)
    expect(await queue.drain('ana')).toBe(false)
    expect(await queue.list('ana')).toEqual([])
  })

  it('tries again after a dropped connection, with the same video ID', async () => {
    const remote = server()
    const queue = new VideoQueue(memoryStore(), () => remote.uploader, () => true)
    await queue.enqueue('ana', 's1', draft, 'v1')
    remote.failWith((step) => (step === 'media' ? offlineError() : null))
    expect(await queue.drain('ana')).toBe(true)
    remote.failWith(() => null)
    expect(await queue.drain('ana')).toBe(false)
    expect(remote.calls).toEqual(['start', 'media', 'start', 'media', 'preview', 'share'])
  })

  it('stops for a refusal and says why, rather than trying for ever', async () => {
    const remote = server()
    const queue = new VideoQueue(memoryStore(), () => remote.uploader, () => true)
    await queue.enqueue('ana', 's1', draft, 'v1')
    remote.failWith((step) => (step === 'share' ? new Error('video_too_large') : null))
    expect(await queue.drain('ana')).toBe(false)
    expect((await queue.list('ana'))[0]).toMatchObject({ state: 'failed', reason: 'video_too_large' })
    remote.calls.length = 0
    await queue.drain('ana')
    expect(remote.calls).toEqual([])
    // Try again puts it back in the queue.
    await queue.retry('ana', 'v1')
    remote.failWith(() => null)
    expect(await queue.drain('ana')).toBe(false)
    expect(await queue.list('ana')).toEqual([])
  })

  it('names each refusal, and treats anything else as worth trying again', () => {
    expect(refusalOf(new Error('video_unavailable'))).toBe('video_unavailable')
    expect(refusalOf(new Error('video_rate_limited'))).toBe('video_rate_limited')
    expect(refusalOf(new Error('video_session_missing'))).toBeNull()
    expect(refusalOf(offlineError())).toBeNull()
  })

  it('cancels a waiting video, which then never uploads', async () => {
    const remote = server()
    const queue = new VideoQueue(memoryStore(), () => remote.uploader, () => true)
    await queue.enqueue('ana', 's1', draft, 'v1')
    await queue.cancel('ana', 'v1')
    await queue.drain('ana')
    expect(remote.calls).toEqual([])
    expect(await queue.list('ana')).toEqual([])
  })

  it('keeps each account’s videos apart, and a reload finds a video left uploading as waiting', async () => {
    const store = memoryStore()
    const remote = server()
    const queue = new VideoQueue(store, () => remote.uploader, () => true)
    await queue.enqueue('ana', 's1', draft, 'v1')
    await queue.enqueue('ben', 's2', draft, 'v2')
    store.items.set('v1', { ...store.items.get('v1')!, state: 'uploading', progress: 0.5 })
    const reloaded = new VideoQueue(store, () => remote.uploader, () => true)
    expect(await reloaded.list('ana')).toMatchObject([{ id: 'v1', state: 'waiting', progress: 0 }])
    await reloaded.clear('ana')
    expect(await reloaded.list('ana')).toEqual([])
    expect(await reloaded.list('ben')).toHaveLength(1)
  })
})
