import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BODY_JOINTS, CameraDiagnostics, createRules, frameAction, jointAngle, MovementAssessment, previewMapping, protractor,
  repetitionGuide, repOutcome, REP_FEEDBACK, romDegrees, shouldPause, slowCamera, landmark,
  type AssessmentSnapshot, type BodyJoint, type BodySide, type ExerciseKind, type ExerciseRules, type FramePoint, type Landmark, type Protractor,
} from '.'

/**
 * Replays shared/assessment/cases.txt and compares each answer with shared/assessment/expected.txt, which the Android
 * engine writes (android/core/assessment SharedCasesTest). If this fails after an Android change, make this engine match.
 */
const folder = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../shared/assessment')
const shared = (file: string) => readFileSync(resolve(folder, file), 'utf8')
const lines = (text: string) => text.split(/\r?\n/).filter((line) => line.trim() !== '')

describe('shared measurement cases', () => {
  const expected = lines(shared('expected.txt'))
  const actual = run(lines(shared('cases.txt')))

  it('answers every shared case', () => {
    expect(actual.length).toBe(expected.length)
  })

  it('gives the same answer as the Android engine for each case', () => {
    const mismatches: string[] = []
    expected.forEach((line, index) => {
      const ours = actual[index] ?? ''
      if (!sameAnswer(line, ours)) mismatches.push(`expected: ${line}\nactual:   ${ours}`)
    })
    expect(mismatches.slice(0, 3).join('\n\n')).toBe('')
  })
})

/** Numbers compare within a millionth; everything else must be identical. Kotlin prints 1.0 where JavaScript prints 1. */
function sameAnswer(expected: string, actual: string): boolean {
  const a = expected.split(' '), b = actual.split(' ')
  if (a.length !== b.length) return false
  return a.every((token, i) => {
    const other = b[i] ?? ''
    if (token === other) return true
    const parts = token.split(/([=,:;])/), others = other.split(/([=,:;])/)
    if (parts.length !== others.length) return false
    return parts.every((part, j) => {
      const mine = others[j] ?? ''
      if (part === mine) return true
      const x = Number(part), y = Number(mine)
      return part !== '' && mine !== '' && Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(x))
    })
  })
}

function run(commands: string[]): string[] {
  const out: string[] = []
  let name = '', step = 0, width = 1000, height = 1000
  let rules = createRules()
  let engine = new MovementAssessment(rules)
  for (const raw of commands) {
    const line = raw.trim()
    if (line.startsWith('#')) continue
    const tokens = line.split(/\s+/)
    const command = tokens[0] ?? ''
    const head = `${name} ${step++} ${command}`
    const arg = (i: number) => tokens[i] ?? ''
    switch (command) {
      case 'case':
        name = arg(1); step = 0; rules = createRules(); width = 1000; height = 1000; engine = new MovementAssessment(rules)
        break
      case 'rules':
        rules = parseRules(tokens.slice(1)); engine = new MovementAssessment(rules)
        break
      case 'size':
        width = Number(arg(1)); height = Number(arg(2))
        break
      case 'frame': {
        const before = engine.snapshot
        const people = parsePeople(tokens.slice(2))
        const after = engine.process(people, width, height, Number(arg(1)))
        const only = people.length === 1 ? people[0] : undefined
        const drawn = only ? protractor(only, rules, width, height) : null
        out.push(`${head} ${snapshot(after)} ${guide(rules, after)} out=${outcome(before, after)} ${protractorText(drawn)}`)
        break
      }
      case 'start': {
        const ok = engine.start(Number(arg(1)))
        out.push(`${head} ok=${ok} ${snapshot(engine.snapshot)}`)
        break
      }
      case 'pause':
        out.push(`${head} ${snapshot(engine.pause(Number(arg(1))))}`)
        break
      case 'restore':
        engine = new MovementAssessment(rules, engine.snapshot)
        out.push(`${head} ${snapshot(engine.snapshot)}`)
        break
      case 'angle': {
        const [a, b, c] = tokens.slice(1, 4).map((xy) => { const [x, y] = xy.split(',').map(Number); return landmark(x ?? 0, y ?? 0, 1) })
        out.push(`${head} included=${num(jointAngle(a!, b!, c!, Number(arg(4)), Number(arg(5))))}`)
        break
      }
      case 'map': {
        const m = previewMapping(Number(arg(1)), Number(arg(2)), Number(arg(3)), Number(arg(4)), arg(5) === 'true')
        const [x, y] = m.map(landmark(Number(arg(6)), Number(arg(7)), 1))
        out.push(`${head} w=${m.width} h=${m.height} left=${m.left} top=${m.top} x=${x} y=${y}`)
        break
      }
      case 'diag': {
        const d = new CameraDiagnostics(Number(arg(1)))
        out.push(`${head} ${tokens.slice(2).map((pair) => {
          const [t, l] = pair.split(':').map(Number)
          const s = d.record(t ?? 0, l ?? 0)
          return `${s.samples},${s.fps},${s.p95LatencyMs}`
        }).join(';')}`)
        break
      }
      case 'policy':
        out.push(`${head} action=${frameAction(shouldPause(Number(arg(1))), Number(arg(2)))}`)
        break
      case 'slow':
        out.push(`${head} slow=${slowCamera({ samples: Number(arg(1)), fps: 0, p95LatencyMs: Number(arg(2)) })}`)
        break
      default:
        throw new Error(`Unknown shared case command: ${line}`)
    }
  }
  return out
}

function parseRules(tokens: string[]): ExerciseRules {
  const v = Object.fromEntries(tokens.map((t) => [t.slice(0, t.indexOf('=')), t.slice(t.indexOf('=') + 1)]))
  const n = (key: string) => (v[key] === undefined ? undefined : Number(v[key]))
  const joint = v.joint as BodyJoint | undefined
  if (joint && !BODY_JOINTS.includes(joint)) throw new Error(`Unknown joint ${joint}`)
  return createRules({
    kind: (v.kind ?? 'ELBOW_FLEXION') as ExerciseKind, side: (v.side ?? 'LEFT') as BodySide,
    lowDegrees: n('low'), highDegrees: n('high'), confidence: n('conf'), stableFrames: n('stable'),
    minimumCycleMs: n('min'), maximumCycleMs: n('max'), peakHoldMs: n('hold'), maxTrunkLeanDegrees: n('lean'),
    maxSpeedDegreesPerSecond: n('speed'), demo: v.demo === undefined ? true : v.demo === 'true',
    prescriptionVersionId: v.prescription ?? null, measuredJoint: joint, exerciseName: v.name ?? null,
  })
}

function parsePeople(tokens: string[]): Landmark[][] {
  const people: Landmark[][] = []
  let i = 0
  while (i < tokens.length) {
    if (tokens[i] !== 'p') throw new Error(`Expected p at ${tokens[i]}`)
    i++
    let length = 33
    const points = new Map<number, Landmark>()
    while (i < tokens.length && tokens[i] !== 'p') {
      const token = tokens[i++] ?? ''
      if (token.startsWith('n=')) { length = Number(token.slice(2)); continue }
      const [index, value] = token.split(':')
      const [x, y, visibility] = (value ?? '').split(',').map(Number)
      points.set(Number(index), landmark(x ?? 0, y ?? 0, visibility ?? 0))
    }
    people.push(Array.from({ length }, (_, k) => points.get(k) ?? landmark(0.5, 0.5, 1)))
  }
  return people
}

const num = (value: number | null) => (value === null ? '-' : String(value))
const point = (p: FramePoint) => `${p.x},${p.y}`
const arc = (points: FramePoint[]) => `${points.length}:${point(points[0]!)}:${point(points[points.length - 1]!)}`

function snapshot(s: AssessmentSnapshot): string {
  const failures = REP_FEEDBACK.flatMap((r) => (s.failureReasons[r] === undefined ? [] : [`${r}:${s.failureReasons[r]}`])).join(',') || '-'
  return `t=${s.timestampMs} q=${s.quality} a=${num(s.angleDegrees)} min=${num(s.minimumDegrees)} max=${num(s.maximumDegrees)} ` +
    `rom=${num(romDegrees(s))} done=${s.completed} inc=${s.incomplete} dur=${s.durationMs} valid=${s.validFrames} ` +
    `bad=${s.invalidFrames} ph=${s.phase} fb=${s.feedback} run=${s.running} hold=${s.holdElapsedMs} fail=${failures}`
}

function guide(rules: ExerciseRules, s: AssessmentSnapshot): string {
  const g = repetitionGuide(rules, s)
  return `step=${g.step ?? '-'} prog=${num(g.targetProgress)} hp=${g.holdProgress}`
}

function outcome(before: AssessmentSnapshot, after: AssessmentSnapshot): string {
  const o = repOutcome(before, after)
  if (!o) return '-'
  return o.type === 'counted' ? `counted:${o.count}` : `missed:${o.reason}`
}

function protractorText(p: Protractor | null): string {
  if (!p) return 'pr=-'
  return `pr=${p.rawAngleDegrees} v=${point(p.vertex)} ref=${point(p.referenceEnd)} mov=${point(p.movingEnd)} ` +
    `arc=${arc(p.measuredArc)} sz=${arc(p.startZone)} tz=${arc(p.targetZone)} ` +
    `lt=${point(p.lowTick[0])};${point(p.lowTick[1])} ht=${point(p.highTick[0])};${point(p.highTick[1])} ` +
    `ll=${point(p.lowLabel)} hl=${point(p.highLabel)} al=${point(p.angleLabel)}`
}
