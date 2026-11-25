import type { SessionVideo } from '@/data/sessionVideos'

/**
 * Session videos waiting to go to the therapist (#175). The smaller copy is made first, then kept in this browser's storage for
 * the signed-in account, so a lost connection, a reload or a closed tab does not lose it. It uploads by itself once the browser
 * is online, waits while the session's own result is still being saved, and is removed from the browser once uploaded, when the
 * patient cancels it, or when they sign out. A refusal from the server stops it and says why, rather than trying for ever.
 */
export type QueueState = 'waiting' | 'uploading' | 'failed'
export type QueuedVideo = {
  id: string; owner: string; sessionId: string; file: Blob; preview: Blob; width: number; height: number; durationMs: number
  state: QueueState; progress: number; reason: string | null; createdAt: number
}
export type Draft = Pick<QueuedVideo, 'file' | 'preview' | 'width' | 'height' | 'durationMs'>

export interface QueueStore {
  all(owner: string): Promise<QueuedVideo[]>
  put(video: QueuedVideo): Promise<void>
  remove(id: string): Promise<void>
}

/** The server's three steps, as `shareDraft` takes them: agree on the places, store both files, then share. */
export interface Uploader {
  start(id: string, sessionId: string, width: number, height: number, durationMs: number): Promise<{ mediaPath: string; previewPath: string }>
  upload(path: string, file: Blob, contentType: string): Promise<void>
  share(id: string): Promise<SessionVideo>
}

/** These answers will not change by trying again, so the video stops and the patient is told why. */
const REFUSALS = ['video_too_large', 'video_unavailable', 'video_rate_limited', 'video_already_shared', 'video_invalid', 'video_duration', 'video_not_owner']
export function refusalOf(error: unknown): string | null {
  const message = (error as { message?: string } | null)?.message ?? ''
  return REFUSALS.find((code) => message.includes(code)) ?? null
}

export type QueueEvent = { kind: 'changed'; owner: string } | { kind: 'shared'; owner: string; sessionId: string; video: SessionVideo }

export class VideoQueue {
  private listeners = new Set<(event: QueueEvent) => void>()
  private running = new Set<string>()
  private cancelled = new Set<string>()

  constructor(private store: QueueStore, private uploader: () => Uploader, private online: () => boolean = () => navigator.onLine) {}

  subscribe(listener: (event: QueueEvent) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private emit(event: QueueEvent) { this.listeners.forEach((listener) => listener(event)) }

  /** A video left uploading when the page closed is simply waiting again. */
  async list(owner: string) {
    const items = await this.store.all(owner)
    return items.map((item) => (item.state === 'uploading' && !this.running.has(item.id) ? { ...item, state: 'waiting' as const, progress: 0 } : item))
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  async enqueue(owner: string, sessionId: string, draft: Draft, id: string = crypto.randomUUID(), now = Date.now()) {
    const video: QueuedVideo = { id, owner, sessionId, ...draft, state: 'waiting', progress: 0, reason: null, createdAt: now }
    await this.store.put(video)
    this.emit({ kind: 'changed', owner })
    return video
  }

  async cancel(owner: string, id: string) {
    this.cancelled.add(id)
    await this.store.remove(id)
    this.emit({ kind: 'changed', owner })
  }

  async retry(owner: string, id: string) {
    const item = (await this.store.all(owner)).find((video) => video.id === id)
    if (!item) return
    await this.store.put({ ...item, state: 'waiting', reason: null, progress: 0 })
    this.emit({ kind: 'changed', owner })
  }

  /** Everything this account has waiting is removed from the browser, as on sign-out. */
  async clear(owner: string) {
    for (const item of await this.store.all(owner)) await this.store.remove(item.id)
    this.emit({ kind: 'changed', owner })
  }

  /**
   * Uploads each waiting video in turn. Returns true when something is still waiting, so the caller tries again later: offline,
   * a dropped connection, or the session's result not saved yet (`video_session_missing`). A refusal is final for that video.
   */
  async drain(owner: string): Promise<boolean> {
    let later = false
    for (const item of await this.list(owner)) {
      if (item.state === 'failed' || this.running.has(item.id)) continue
      if (!this.online()) return true
      this.running.add(item.id)
      this.cancelled.delete(item.id)
      const save = async (change: Partial<QueuedVideo>) => {
        if (this.cancelled.has(item.id)) return
        await this.store.put({ ...item, ...change })
        this.emit({ kind: 'changed', owner })
      }
      try {
        await save({ state: 'uploading', progress: 0.05 })
        const api = this.uploader()
        // The same ID again is safe, so a retry after a dropped connection carries on where it stopped.
        const places = await api.start(item.id, item.sessionId, item.width, item.height, item.durationMs)
        await save({ state: 'uploading', progress: 0.15 })
        await api.upload(places.mediaPath, item.file, 'video/mp4')
        await save({ state: 'uploading', progress: 0.9 })
        await api.upload(places.previewPath, item.preview, 'image/jpeg')
        if (this.cancelled.has(item.id)) continue
        const shared = await api.share(item.id)
        await this.store.remove(item.id)
        this.emit({ kind: 'shared', owner, sessionId: item.sessionId, video: shared })
        this.emit({ kind: 'changed', owner })
      } catch (error) {
        const refused = refusalOf(error)
        if (refused) await save({ state: 'failed', reason: refused, progress: 0 })
        else { later = true; await save({ state: 'waiting', progress: 0 }) }
      } finally {
        this.running.delete(item.id)
      }
    }
    return later
  }
}

/** Kept in memory: for tests, and for a browser that refuses storage. Nothing then survives a reload. */
export function memoryStore(): QueueStore & { items: Map<string, QueuedVideo> } {
  const items = new Map<string, QueuedVideo>()
  return {
    items,
    all: async (owner) => [...items.values()].filter((item) => item.owner === owner),
    put: async (video) => { items.set(video.id, video) },
    remove: async (id) => { items.delete(id) },
  }
}

const DB = 'motivance-video-uploads'
const STORE = 'videos'

function request<T>(work: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => { work.onsuccess = () => resolve(work.result); work.onerror = () => reject(work.error) })
}

/** The browser's own storage (IndexedDB), which keeps the files themselves across a reload or a closed tab. */
export function indexedStore(factory: IDBFactory = indexedDB): QueueStore {
  let opened: Promise<IDBDatabase> | null = null
  const db = () => {
    opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const open = factory.open(DB, 1)
      open.onupgradeneeded = () => { open.result.createObjectStore(STORE, { keyPath: 'id' }).createIndex('owner', 'owner') }
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => { opened = null; reject(open.error) }
    })
    return opened
  }
  const tx = async (mode: IDBTransactionMode) => (await db()).transaction(STORE, mode).objectStore(STORE)
  return {
    all: async (owner) => request((await tx('readonly')).index('owner').getAll(owner)) as Promise<QueuedVideo[]>,
    put: async (video) => { await request((await tx('readwrite')).put(video)) },
    remove: async (id) => { await request((await tx('readwrite')).delete(id)) },
  }
}
