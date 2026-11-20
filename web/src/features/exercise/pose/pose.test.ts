import { describe, expect, it, vi } from 'vitest'
import { CameraDiagnostics } from '../assessment'
import { FrameLoop, type Detection, type FrameSource, type PoseDetector } from './frameLoop'
import { LatestFrameGate } from './frameGate'
import { guardFetch, notStatistics } from './offOrigin'
import { toPeople } from './landmarks'
import { cameraSupport } from './support'

describe('toPeople', () => {
  it('takes the lower of visibility and presence for each landmark, as Android does', () => {
    const people = toPeople([[{ x: 0.25, y: 0.5, z: 0, visibility: 0.9, presence: 0.6 }, { x: 0.1, y: 0.2, z: 1, visibility: 0.3, presence: 0.8 }]])
    expect(people).toEqual([[{ x: 0.25, y: 0.5, visibility: Math.fround(0.6) }, { x: Math.fround(0.1), y: Math.fround(0.2), visibility: Math.fround(0.3) }]])
  })
  it('treats a missing presence as zero, as Android does', () => {
    expect(toPeople([[{ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }]])[0]?.[0]?.visibility).toBe(0)
  })
  it('keeps every person so the engine can refuse a second one', () => {
    expect(toPeople([[], []])).toHaveLength(2)
  })
})

describe('LatestFrameGate', () => {
  it('lets one frame through at a time and drops the rest instead of queuing them', () => {
    const gate = new LatestFrameGate()
    expect(gate.tryEnter()).toBe(true)
    expect(gate.tryEnter()).toBe(false)
    expect(gate.tryEnter()).toBe(false)
    expect(gate.dropped).toBe(2)
    gate.leave()
    expect(gate.tryEnter()).toBe(true)
  })
})

describe('guardFetch', () => {
  it('refuses requests that would leave the app, and passes the app own requests through', async () => {
    const inner = vi.fn(async () => new Response('ok'))
    const scope = { fetch: inner as typeof fetch, location: { origin: 'https://motivance.example' } }
    const blocked = guardFetch(scope)
    await expect(scope.fetch('https://odml.pa.googleapis.com/v1/log', { method: 'POST' })).rejects.toThrow(/blocked/i)
    await expect(scope.fetch(new URL('https://elsewhere.example/a'))).rejects.toThrow(/blocked/i)
    await expect((await scope.fetch('/assets/model.task')).text()).resolves.toBe('ok')
    await expect((await scope.fetch(new Request('https://motivance.example/assets/x.wasm'))).text()).resolves.toBe('ok')
    expect(inner).toHaveBeenCalledTimes(2)
    expect(blocked()).toEqual(['https://odml.pa.googleapis.com/v1/log', 'https://elsewhere.example/a'])
  })

  it('on the page thread refuses only MediaPipe statistics, so Supabase keeps working', async () => {
    const inner = vi.fn(async () => new Response('ok'))
    const scope = { fetch: inner as typeof fetch, location: { origin: 'https://motivance.example' } }
    guardFetch(scope, notStatistics)
    await expect(scope.fetch('https://odml.pa.googleapis.com/v1/log')).rejects.toThrow(/blocked/i)
    await expect((await scope.fetch('https://project.supabase.co/rest/v1/x')).text()).resolves.toBe('ok')
  })
})

describe('cameraSupport', () => {
  const capable = {
    isSecureContext: true, WebAssembly: {}, navigator: { mediaDevices: { getUserMedia: () => undefined } }, createImageBitmap: () => undefined,
    HTMLVideoElement: { prototype: { requestVideoFrameCallback: () => 0 } },
  }
  it('accepts a browser with a secure page, camera access, WebAssembly, image bitmaps and video frame callbacks', () => {
    expect(cameraSupport(capable)).toEqual({ ok: true })
  })
  it('names what is missing', () => {
    expect(cameraSupport({ ...capable, isSecureContext: false })).toEqual({ ok: false, reason: 'insecure' })
    expect(cameraSupport({ ...capable, navigator: {} })).toEqual({ ok: false, reason: 'no-camera' })
    expect(cameraSupport({ ...capable, WebAssembly: undefined })).toEqual({ ok: false, reason: 'unsupported' })
    expect(cameraSupport({ ...capable, createImageBitmap: undefined })).toEqual({ ok: false, reason: 'unsupported' })
    // The frame loop runs on each new video frame, so a browser without the callback cannot measure.
    expect(cameraSupport({ ...capable, HTMLVideoElement: { prototype: {} } })).toEqual({ ok: false, reason: 'unsupported' })
  })
})

describe('FrameLoop', () => {
  class FakeVideo implements FrameSource {
    videoWidth = 640
    videoHeight = 480
    private next: ((now: number) => void) | null = null
    requestVideoFrameCallback(callback: (now: number) => void) { this.next = callback; return 1 }
    cancelVideoFrameCallback() { this.next = null }
    deliver() { const callback = this.next; this.next = null; callback?.(0) }
    get waiting() { return this.next !== null }
  }
  const image = () => ({ width: 640, height: 480, close: vi.fn() })
  function setup(options: { hidden?: () => boolean; latency?: number } = {}) {
    let clock = 1000
    const pending: Array<() => void> = []
    const detector: PoseDetector = {
      delegate: 'GPU',
      detect: vi.fn((_source: FrameSource, timestamp: number) => new Promise<Detection>((resolve) => {
        pending.push(() => { clock += options.latency ?? 20; resolve({ people: [[]], image: image(), width: 640, height: 480, timestampMs: timestamp }) })
      })),
    }
    const video = new FakeVideo()
    const onFrame = vi.fn(), onPause = vi.fn()
    const loop = new FrameLoop({ video, detector, now: () => clock, hidden: options.hidden ?? (() => false), onFrame, onPause, diagnostics: new CameraDiagnostics() })
    const finish = async () => { pending.shift()?.(); await Promise.resolve(); await Promise.resolve() }
    return { loop, video, detector, onFrame, onPause, finish, tick: (ms: number) => { clock += ms } }
  }

  it('processes a frame, hands it on with diagnostics and keeps asking for frames', async () => {
    const { loop, video, onFrame, finish } = setup()
    loop.start()
    video.deliver()
    await finish()
    expect(onFrame).toHaveBeenCalledTimes(1)
    expect(onFrame.mock.calls[0]?.[0]).toMatchObject({ people: [[]], width: 640, height: 480, timestampMs: 1000, diagnostics: { samples: 1, p95LatencyMs: 20 } })
    expect(video.waiting).toBe(true)
  })

  it('drops frames that arrive while one is being detected', async () => {
    const { loop, video, detector, finish, tick } = setup()
    loop.start()
    video.deliver(); tick(5); video.deliver(); tick(5); video.deliver()
    expect(detector.detect).toHaveBeenCalledTimes(1)
    expect(loop.dropped).toBe(2)
    await finish()
    tick(5); video.deliver()
    expect(detector.detect).toHaveBeenCalledTimes(2)
  })

  it('gives each frame a later timestamp than the last, as MediaPipe video mode requires', async () => {
    const { loop, video, detector, finish } = setup({ latency: 0 })
    loop.start()
    video.deliver(); await finish(); video.deliver(); await finish()
    const stamps = vi.mocked(detector.detect).mock.calls.map((call) => call[1])
    expect(stamps[1]).toBeGreaterThan(stamps[0]!)
  })

  it('stamps frames in whole milliseconds, as Android does, even from a fractional clock', async () => {
    const { loop, video, detector, finish, tick } = setup({ latency: 0 })
    tick(0.4)
    loop.start()
    video.deliver(); await finish()
    expect(Number.isInteger(vi.mocked(detector.detect).mock.calls[0]?.[1])).toBe(true)
  })

  it('skips a result that is more than a second old and frees its picture', async () => {
    const { loop, video, onFrame, finish } = setup({ latency: 1001 })
    loop.start()
    video.deliver()
    await finish()
    expect(onFrame).not.toHaveBeenCalled()
  })

  it('pauses instead of measuring while the tab is hidden, and says so once', async () => {
    let hidden = true
    const { loop, video, detector, onPause, onFrame, finish } = setup({ hidden: () => hidden })
    loop.start()
    video.deliver(); video.deliver()
    expect(detector.detect).not.toHaveBeenCalled()
    expect(onPause).toHaveBeenCalledTimes(1)
    hidden = false
    video.deliver()
    await finish()
    expect(onFrame).toHaveBeenCalledTimes(1)
  })

  it('stops asking for frames and ignores a late result once stopped', async () => {
    const { loop, video, onFrame, finish } = setup()
    loop.start()
    video.deliver()
    loop.stop()
    await finish()
    expect(onFrame).not.toHaveBeenCalled()
    expect(video.waiting).toBe(false)
  })
})
