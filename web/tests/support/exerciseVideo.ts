import { appendFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'

/**
 * A recorded exercise for the regression (#141): the app's own guide figure doing elbow flexion, three repetitions with
 * the left arm toward the camera, then three with the right. There is no recording of a real person in the repository,
 * so this is drawn, and drawn the same way every time. MediaPipe finds the figure as a person, so the browser and Android
 * can run real body tracking on the very same frames. It says nothing about accuracy on real bodies.
 */
export const VIDEO = { fps: 30, width: 640, height: 480 } as const
const REST = 5, PEAK = 125
const UP = 0.8, HOLD = 0.5, DOWN = 0.8, PAUSE = 0.7, LEAD = 1.5, TAIL = 0.6, REPS = 3
const REP = UP + HOLD + DOWN + PAUSE
export const SIDE_SECONDS = LEAD + REPS * REP + TAIL
export const TOTAL_FRAMES = Math.round(2 * SIDE_SECONDS * VIDEO.fps)

const ease = (x: number) => (1 - Math.cos(Math.PI * Math.min(Math.max(x, 0), 1))) / 2

/** Which arm faces the camera and the drawn elbow angle at `seconds` into the video. */
export function exerciseAt(seconds: number): { side: 'LEFT' | 'RIGHT'; angle: number } {
  const side = seconds < SIDE_SECONDS ? 'LEFT' : 'RIGHT'
  const t = seconds - (side === 'LEFT' ? 0 : SIDE_SECONDS) - LEAD
  if (t < 0 || t >= REPS * REP) return { side, angle: REST }
  const r = t % REP
  const angle = r < UP ? REST + (PEAK - REST) * ease(r / UP)
    : r < UP + HOLD ? PEAK
      : r < UP + HOLD + DOWN ? PEAK - (PEAK - REST) * ease((r - UP - HOLD) / DOWN)
        : REST
  return { side, angle }
}

/** Outside test-results, which Playwright empties before each run; ignored by git. */
export const videoDir = (root: string) => join(root, 'test-videos', 'recorded-exercise')
export const framePath = (dir: string, index: number) => join(dir, 'frames', `frame-${String(index).padStart(4, '0')}.jpg`)

/**
 * Draws every frame in the page with the app's guide renderer. Each is written as a JPEG, for the offline runs on both apps,
 * and into one `.y4m` (I420, full range), which Chrome's fake camera plays at 30 frames a second, looping. Skipped when the
 * files are already there.
 */
export async function makeExerciseVideo(page: Page, dir: string) {
  const y4m = join(dir, 'exercise.y4m')
  const done = join(dir, 'complete')
  if (existsSync(done) && existsSync(y4m) && readdirSync(join(dir, 'frames')).length === TOTAL_FRAMES) return y4m
  mkdirSync(join(dir, 'frames'), { recursive: true })
  writeFileSync(y4m, `YUV4MPEG2 W${VIDEO.width} H${VIDEO.height} F${VIDEO.fps}:1 Ip A1:1 C420jpeg\n`)
  const BATCH = 30
  for (let from = 0; from < TOTAL_FRAMES; from += BATCH) {
    const poses = Array.from({ length: Math.min(BATCH, TOTAL_FRAMES - from) }, (_, k) => exerciseAt((from + k) / VIDEO.fps))
    const encoded = await page.evaluate(async ({ poses, size }) => {
      const draw = await import('/src/features/exercise/guide/draw.ts' as string)
      const rig = await import('/src/features/exercise/guide/rig.ts' as string)
      const canvas = document.createElement('canvas')
      canvas.width = size.width; canvas.height = size.height
      const ctx = canvas.getContext('2d')!
      const out: { jpeg: string; yuv: string }[] = []
      for (const pose of poses) {
        const motion = rig.guideMotion('ELBOW', pose.side)
        const shapes = draw.guideShapes(motion, pose.angle, draw.ON_LIGHT, size.width, size.height, false) as Array<Record<string, string | number | undefined>>
        const body = shapes.map((s) => s.kind === 'ellipse'
          ? `<ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}" style="fill:${s.fill}"/>`
          : `<path d="${s.d}" style="fill:${s.fill ?? 'none'};stroke:${s.stroke ?? 'none'}" stroke-width="${s.width ?? 0}" stroke-linecap="${s.cap ?? 'butt'}"/>`).join('')
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}"><rect width="100%" height="100%" fill="#e8eef0"/>${body}</svg>`
        const image = new Image()
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
        await image.decode()
        ctx.drawImage(image, 0, 0)
        const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.9))
        // The fake camera gets exactly the JPEG's picture: decoded back, then converted to I420.
        const decoded = await createImageBitmap(blob)
        ctx.drawImage(decoded, 0, 0)
        decoded.close()
        const rgba = ctx.getImageData(0, 0, size.width, size.height).data
        const w = size.width, h = size.height
        const yuv = new Uint8Array(w * h * 1.5)
        for (let p = 0; p < w * h; p++) yuv[p] = Math.round(0.299 * rgba[p * 4]! + 0.587 * rgba[p * 4 + 1]! + 0.114 * rgba[p * 4 + 2]!)
        for (let y = 0; y < h / 2; y++) for (let x = 0; x < w / 2; x++) {
          let r = 0, g = 0, b = 0
          for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const p = ((2 * y + dy!) * w + 2 * x + dx!) * 4; r += rgba[p]!; g += rgba[p + 1]!; b += rgba[p + 2]! }
          r /= 4; g /= 4; b /= 4
          yuv[w * h + y * (w / 2) + x] = Math.min(255, Math.max(0, Math.round(128 - 0.168736 * r - 0.331264 * g + 0.5 * b)))
          yuv[w * h * 1.25 + y * (w / 2) + x] = Math.min(255, Math.max(0, Math.round(128 + 0.5 * r - 0.418688 * g - 0.081312 * b)))
        }
        const pack = (bytes: Uint8Array) => { let text = ''; for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(text) }
        out.push({ jpeg: pack(new Uint8Array(await blob.arrayBuffer())), yuv: pack(yuv) })
      }
      return out
    }, { poses, size: { width: VIDEO.width, height: VIDEO.height } })
    encoded.forEach((frame, k) => {
      writeFileSync(framePath(dir, from + k), Buffer.from(frame.jpeg, 'base64'))
      appendFileSync(y4m, Buffer.concat([Buffer.from('FRAME\n'), Buffer.from(frame.yuv, 'base64')]))
    })
  }
  writeFileSync(done, String(TOTAL_FRAMES))
  return y4m
}
