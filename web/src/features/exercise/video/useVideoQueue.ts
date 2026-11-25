import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/data/client'
import { shareSessionVideo, startSessionVideo, uploadVideoFile, type SessionVideo } from '@/data/sessionVideos'
import { indexedStore, memoryStore, VideoQueue, type Draft, type QueuedVideo, type QueueStore } from './uploadQueue'

function store(): QueueStore {
  try { return typeof indexedDB === 'undefined' ? memoryStore() : indexedStore() } catch { return memoryStore() }
}

/** One queue for the page, so every screen shows the same videos and one upload runs at a time. */
export const videoQueue = new VideoQueue(store(), () => {
  const db = supabase()
  return {
    start: (id, session, width, height, ms) => startSessionVideo(db, id, session, width, height, ms),
    upload: (path, file, type) => uploadVideoFile(db, path, file, type),
    share: (id) => shareSessionVideo(db, id),
  }
}, () => (typeof navigator === 'undefined' ? true : navigator.onLine))

/** How long to wait before trying again while something still waits: 15 seconds, doubling to at most five minutes. */
export const retryDelay = (attempt: number) => Math.min(15_000 * 2 ** attempt, 300_000)

const runners = new Map<string, { attempt: number; timer: ReturnType<typeof setTimeout> | null; busy: boolean }>()

/** Uploads what is waiting for this account now, and again later while something still waits. */
export async function runQueue(owner: string) {
  const runner = runners.get(owner) ?? { attempt: 0, timer: null, busy: false }
  runners.set(owner, runner)
  if (runner.busy) return
  runner.busy = true
  if (runner.timer) { clearTimeout(runner.timer); runner.timer = null }
  try {
    const later = await videoQueue.drain(owner)
    if (later) {
      runner.timer = setTimeout(() => { void runQueue(owner) }, retryDelay(runner.attempt))
      runner.attempt += 1
    } else runner.attempt = 0
  } catch { /* The browser refused its storage; nothing can wait here. */ } finally { runner.busy = false }
}

/**
 * The account's waiting videos and the ones that went up while this page was open. Mounting it also starts the uploads: when the
 * patient opens Motivance, and whenever the browser says it is back online.
 */
export function useVideoQueue(owner: string | null) {
  const [items, setItems] = useState<QueuedVideo[]>([])
  const [shared, setShared] = useState<Record<string, SessionVideo>>({})
  useEffect(() => {
    if (!owner) return
    let current = true
    const refresh = () => { void videoQueue.list(owner).then((next) => { if (current) setItems(next) }, () => undefined) }
    const off = videoQueue.subscribe((event) => {
      if (event.owner !== owner) return
      if (event.kind === 'shared') setShared((map) => ({ ...map, [event.sessionId]: event.video }))
      refresh()
    })
    const online = () => { const runner = runners.get(owner); if (runner) runner.attempt = 0; void runQueue(owner) }
    window.addEventListener('online', online)
    refresh()
    void runQueue(owner)
    return () => { current = false; off(); window.removeEventListener('online', online) }
  }, [owner])
  const enqueue = useCallback(async (sessionId: string, draft: Draft) => {
    if (!owner) return
    await videoQueue.enqueue(owner, sessionId, draft)
    void runQueue(owner)
  }, [owner])
  const retry = useCallback(async (id: string) => { if (owner) { await videoQueue.retry(owner, id); void runQueue(owner) } }, [owner])
  const cancel = useCallback(async (id: string) => { if (owner) await videoQueue.cancel(owner, id) }, [owner])
  return { items, shared, enqueue, retry, cancel }
}
