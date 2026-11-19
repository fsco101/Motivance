import {
  jointChain, jointLandmark, measurementChain, previewMapping, protractor as buildProtractor,
  type AssessmentSnapshot, type ExerciseRules, type FramePoint, type Landmark, type Protractor, type TrackingQuality,
} from '../assessment'

/** Android's camera palette (SkeletonPreview.kt), from the web's night tokens. */
export const PALETTE = {
  night: '#062229', panel: '#0e3640', line: '#285661', ink: '#bfe3dd', mint: '#6fe08f', caution: '#ffc56b',
  shade: 'rgba(2, 20, 24, 0.8)', white: '#ffffff',
} as const

/** Bones drawn between MediaPipe landmarks, as on Android. No face or hand mesh. */
export const SKELETON_BONES: readonly [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32], [15, 19], [16, 20],
]
const BODY_POINTS = [0, ...Array.from({ length: 22 }, (_, i) => i + 11)]

/** A landmark the overlay may draw: finite, inside the frame and at the confidence the rules ask for. */
export function visibleLandmark(p: Landmark | undefined, rules: ExerciseRules): p is Landmark {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.visibility) && p.visibility >= rules.confidence && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1
}
export const focusVisible = (points: readonly Landmark[], rules: ExerciseRules) => visibleLandmark(points[jointLandmark(rules.focusJoint, rules.side)], rules)

/** Nobody, several people or a pause: the picture shows, but no skeleton is drawn on it. */
export const showBody = (quality: TrackingQuality, hasImage: boolean) => hasImage && quality !== 'MULTIPLE_PEOPLE' && quality !== 'NO_PERSON' && quality !== 'PAUSED'

/** Android's durationText: "1 second", otherwise the seconds without trailing zeros. */
export const durationParts = (ms: number) => ({ one: ms === 1000, seconds: String(ms / 1000) })

export type CameraErrorKind = 'blocked' | 'noCamera' | 'inUse' | 'unavailable'
/** getUserMedia's error names, as the four things a patient can do something about. */
export function cameraErrorKind(error: unknown): CameraErrorKind {
  const name = error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'blocked'
  if (name === 'NotFoundError') return 'noCamera'
  if (name === 'NotReadableError' || name === 'AbortError') return 'inUse'
  return 'unavailable'
}

/** A camera facing the patient is shown mirrored, as on Android. Laptop webcams rarely report a direction, and face the user. */
export const mirrorFor = (settings: { facingMode?: string }) => settings.facingMode !== 'environment'

export interface StageFrame { image: CanvasImageSource; width: number; height: number; people: Landmark[][] }

interface DrawOptions {
  frame: StageFrame | null
  rules: ExerciseRules
  snapshot: AssessmentSnapshot
  mirrored: boolean
  /** CSS pixels; the context is already scaled for the screen's pixel ratio. */
  width: number
  height: number
  font: string
}

/**
 * Draws the camera picture, the skeleton and the protractor on one canvas, from the same frame, so the skeleton never
 * trails the body. The protractor appears only when the engine accepted the frame, as on Android.
 */
export function drawStage(ctx: CanvasRenderingContext2D, { frame, rules, snapshot, mirrored, width, height, font }: DrawOptions): Protractor | null {
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = PALETTE.night
  ctx.fillRect(0, 0, width, height)
  let drawn: Protractor | null = null
  if (frame) {
    const mapping = previewMapping(frame.width, frame.height, width, height, mirrored)
    ctx.save()
    if (mirrored) { ctx.translate(width, 0); ctx.scale(-1, 1) }
    ctx.drawImage(frame.image, mapping.left, mapping.top, mapping.width, mapping.height)
    ctx.restore()
    const points = frame.people[0] ?? []
    if (showBody(snapshot.quality, true) && frame.people.length === 1) {
      const at = (i: number) => mapping.map(points[i]!)
      const visible = (i: number) => visibleLandmark(points[i], rules)
      const caution = snapshot.quality === 'TRUNK_LEAN'
      const focus = caution ? PALETTE.caution : PALETTE.mint
      const chain = jointChain(rules.focusJoint, rules.side)
      const selected = jointLandmark(rules.focusJoint, rules.side)
      // The protractor's minimum is 48 screen pixels, converted to frame pixels through the same scale.
      const scale = mapping.width / frame.width
      drawn = snapshot.quality === 'READY' ? buildProtractor(points, rules, frame.width, frame.height, 48 / scale) : null
      // A restrained torso tint makes the active limb easier to tell apart.
      if ([11, 12, 24, 23].every(visible)) {
        ctx.beginPath()
        ;[11, 12, 24, 23].forEach((i, n) => { const [x, y] = at(i); if (n === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y) })
        ctx.closePath()
        ctx.fillStyle = 'rgba(191, 227, 221, 0.07)'
        ctx.fill()
      }
      const measured = measurementChain(rules)
      const measuredBones = [[measured.proximal, measured.vertex], [measured.vertex, measured.distal]]
      ctx.lineCap = 'round'
      for (const [a, b] of SKELETON_BONES) {
        if (!visible(a) || !visible(b)) continue
        const isSelected = chain.includes(a) && chain.includes(b)
        const measuring = drawn !== null && !isSelected && measuredBones.some(([x, y]) => (x === a && y === b) || (x === b && y === a))
        const color = isSelected ? focus : measuring ? 'rgba(255, 255, 255, 0.9)' : 'rgba(191, 227, 221, 0.65)'
        const lineWidth = isSelected ? 4 : measuring ? 3 : 2
        line(ctx, at(a), at(b), PALETTE.shade, lineWidth + 3)
        line(ctx, at(a), at(b), color, lineWidth)
      }
      for (const i of BODY_POINTS) {
        if (!visible(i)) continue
        const isSelected = chain.includes(i)
        const radius = isSelected ? 5 : 2.5
        circle(ctx, at(i), radius + 2, 'rgba(6, 34, 41, 0.85)')
        circle(ctx, at(i), radius, isSelected ? focus : PALETTE.ink)
        if (isSelected) ring(ctx, at(i), radius, PALETTE.white, 1.5)
      }
      if (visible(selected)) {
        circle(ctx, at(selected), 16, caution ? 'rgba(255, 197, 107, 0.12)' : 'rgba(111, 224, 143, 0.12)')
        ring(ctx, at(selected), 12, focus, 1.5)
      }
      if (drawn) drawProtractor(ctx, drawn, (p) => mapping.map(p as Landmark), rules, snapshot.angleDegrees, width, height, font)
    }
  }
  // Light brackets frame the picture without suggesting an anatomical target.
  ctx.strokeStyle = 'rgba(191, 227, 221, 0.6)'
  ctx.lineWidth = 1.5
  const inset = 16, length = 20
  for (const [x, y, dx, dy] of [[inset, inset, 1, 1], [width - inset, inset, -1, 1], [inset, height - inset, 1, -1], [width - inset, height - inset, -1, -1]] as const) {
    ctx.beginPath(); ctx.moveTo(x + length * dx, y); ctx.lineTo(x, y); ctx.lineTo(x, y + length * dy); ctx.stroke()
  }
  return drawn
}

type Point = readonly [number, number]

function line(ctx: CanvasRenderingContext2D, a: Point, b: Point, color: string, width: number, dash: number[] = []) {
  ctx.beginPath(); ctx.setLineDash(dash); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1])
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(); ctx.setLineDash([])
}
function circle(ctx: CanvasRenderingContext2D, [x, y]: Point, radius: number, color: string) {
  ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill()
}
function ring(ctx: CanvasRenderingContext2D, [x, y]: Point, radius: number, color: string, width: number) {
  ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke()
}
function polyline(ctx: CanvasRenderingContext2D, points: Point[], color: string, width: number, cap: CanvasLineCap) {
  if (points.length === 0) return
  ctx.beginPath(); ctx.moveTo(points[0]![0], points[0]![1])
  for (const p of points.slice(1)) ctx.lineTo(p[0], p[1])
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = cap; ctx.stroke(); ctx.lineCap = 'round'
}

/** Protractor at the measured joint: dashed 0° reference, start and target zones, threshold ticks and the live arc. */
function drawProtractor(ctx: CanvasRenderingContext2D, p: Protractor, map: (point: FramePoint) => Point, rules: ExerciseRules, angle: number | null, width: number, height: number, font: string) {
  const o = (point: FramePoint) => map(point)
  const vertex = o(p.vertex)
  line(ctx, vertex, o(p.referenceEnd), PALETTE.shade, 3.5)
  line(ctx, vertex, o(p.referenceEnd), 'rgba(255, 255, 255, 0.8)', 1.5, [6, 5])
  polyline(ctx, p.startZone.map(o), 'rgba(191, 227, 221, 0.45)', 7, 'butt')
  polyline(ctx, p.targetZone.map(o), 'rgba(111, 224, 143, 0.5)', 7, 'butt')
  const measured = angle ?? p.rawAngleDegrees
  const arcColor = measured >= rules.highDegrees ? PALETTE.mint : measured <= rules.lowDegrees ? PALETTE.ink : PALETTE.white
  polyline(ctx, p.measuredArc.map(o), PALETTE.shade, 5, 'round')
  polyline(ctx, p.measuredArc.map(o), arcColor, 2.5, 'round')
  for (const [a, b] of [p.lowTick, p.highTick]) { line(ctx, o(a), o(b), PALETTE.shade, 4); line(ctx, o(a), o(b), PALETTE.white, 2) }
  const chip = (text: string, [x, y]: Point, background: string, foreground: string, bold = false) => {
    ctx.font = `${bold ? 700 : 500} 11px ${font}`
    const pad = 4, w = ctx.measureText(text).width + pad * 2, h = 11 + pad * 1.5
    const left = Math.min(Math.max(x - w / 2, 0), Math.max(width - w, 0)), top = Math.min(Math.max(y - h / 2, 0), Math.max(height - h, 0))
    ctx.beginPath(); ctx.roundRect(left, top, w, h, h / 2); ctx.fillStyle = background; ctx.fill()
    ctx.fillStyle = foreground; ctx.textBaseline = 'middle'; ctx.fillText(text, left + pad, top + h / 2)
  }
  chip(`${Math.trunc(rules.lowDegrees)}°`, o(p.lowLabel), 'rgba(6, 34, 41, 0.85)', PALETTE.ink)
  chip(`${Math.trunc(rules.highDegrees)}°`, o(p.highLabel), 'rgba(6, 34, 41, 0.85)', PALETTE.mint)
  chip(`${Math.round(measured)}°`, o(p.angleLabel), arcColor, PALETTE.night, true)
}
