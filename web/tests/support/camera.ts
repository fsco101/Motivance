import type { Page } from '@playwright/test'

/**
 * Chrome's fake camera shows a test pattern, not a person, so the MediaPipe host module is replaced with one that reports a
 * left elbow bending from 10° to 100° and back every three seconds, after a second and a half at rest. Everything else is the
 * real app: the camera, the frame loop, the shared engine, the drawing, the controller and the save.
 */
export const SCRIPTED_HOST = `
let first = null
const host = {
  thread: 'worker', delegate: 'GPU',
  async init() { return 'GPU' },
  async detect(source, timestampMs) {
    const image = await createImageBitmap(source)
    first ??= timestampMs
    const t = (timestampMs - first) / 1000
    const angle = t < 1.5 ? 10 : 55 - 45 * Math.cos((2 * Math.PI * (t - 1.5)) / 3)
    const r = (angle * Math.PI) / 180
    const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }))
    points[11] = { x: 0.5, y: 0.3, visibility: 1 }; points[23] = { x: 0.5, y: 0.8, visibility: 1 }
    points[13] = { x: 0.5, y: 0.5, visibility: 1 }; points[15] = { x: 0.5 + Math.sin(r) * 0.15, y: 0.5 + Math.cos(r) * 0.15, visibility: 1 }
    return { people: [points], image, width: image.width, height: image.height, timestampMs }
  },
  close() {},
}
export async function preparePoseTracking() { return host }
export async function releasePoseTracking() { return [] }
`

/** A browser voice that records what it is asked to say and finishes each phrase after a moment, one at a time. */
export const FAKE_VOICE = `
  window.__spoken = []
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; this.lang = ''; this.voice = null; this.onend = null; this.onerror = null } }
  const queue = []
  const next = () => { const u = queue[0]; if (!u) return; setTimeout(() => { if (queue[0] !== u) return; queue.shift(); window.__spoken.push(u.text); u.onend && u.onend(); next() }, 300) }
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: Object.assign(new EventTarget(), {
    getVoices: () => [{ lang: 'en-US', name: 'Test voice', localService: true, default: true }],
    speak(u) { queue.push(u); if (queue.length === 1) next() },
    cancel() { const dropped = queue.splice(0); dropped.forEach((u) => u.onerror && u.onerror()) },
  }) })
`

/** Serves the scripted body in place of MediaPipe and installs the fake voice, before the app loads. */
export async function fakeBodyAndVoice(page: Page) {
  await page.route('**/src/features/exercise/pose/hosts.ts*', (route) => route.fulfill({ contentType: 'text/javascript', body: SCRIPTED_HOST }))
  await page.addInitScript(FAKE_VOICE)
}
