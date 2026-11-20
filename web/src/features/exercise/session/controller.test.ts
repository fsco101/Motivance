import { describe, expect, it, vi } from 'vitest'
import { createRules, landmark, type ExerciseRules, type Landmark } from '../assessment'
import { SessionController, type SessionDeps } from './controller'

function pose(rules: ExerciseRules, angle: number): Landmark[] {
  const points = Array.from({ length: 33 }, () => landmark(0.5, 0.5, 1))
  const s = rules.side === 'RIGHT' ? 1 : 0
  points[11 + s] = landmark(0.5, 0.3, 1); points[23 + s] = landmark(0.5, 0.8, 1); points[13 + s] = landmark(0.5, 0.5, 1)
  points[15 + s] = landmark(0.5 + Math.sin((angle * Math.PI) / 180) * 0.15, 0.5 + Math.cos((angle * Math.PI) / 180) * 0.15, 1)
  return points
}

function setup(rules: ExerciseRules, options: { failSaves?: number } = {}) {
  let clock = 0, wall = 1_000_000, ids = 0, failures = options.failSaves ?? 0
  const timers: Array<{ at: number; run: () => void }> = []
  const saved: Array<{ sessionId: string; rules: Record<string, unknown>; metrics: { completed: number } }> = []
  const deps: SessionDeps = {
    ownerId: 'patient-1',
    grantConsent: vi.fn(async () => ({ id: 'consent-1', occurredAt: wall - 10 })),
    save: vi.fn(async (payload) => {
      if (failures > 0) { failures--; throw new Error('offline') }
      saved.push(payload as never)
      return { duplicate: false }
    }),
    now: () => clock,
    wall: () => wall,
    uuid: () => `session-${++ids}`,
    later: (run, ms) => { const timer = { at: clock + ms, run }; timers.push(timer); return () => { const at = timers.indexOf(timer); if (at >= 0) timers.splice(at, 1) } },
  }
  const session = new SessionController(rules, deps)
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }
  const frame = (angle: number) => { clock += 100; wall += 100; session.frame([pose(session.state.rules, angle)], 1000, 1000, clock) }
  const pass = async (ms: number) => {
    const end = clock + ms
    while (true) {
      const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0]
      if (!due) break
      timers.splice(timers.indexOf(due), 1); clock = due.at; due.run(); await flush()
    }
    clock = end
  }
  const ready = () => { for (let i = 0; i < 6; i++) frame(10) }
  const rep = (peak = 100) => [10, 10, 40, 60, peak, peak, peak, 70, 40, 10, 10].forEach(frame)
  return { session, deps, saved, frame, ready, rep, flush, pass }
}

const prescribed = (overrides: Parameters<typeof createRules>[0] = {}) => createRules({ demo: false, prescriptionVersionId: 'version-1', version: 'exercise-1', targetRepetitions: 2, ...overrides })

describe('SessionController', () => {
  it('needs consent and a ready camera before it starts, as on Android', async () => {
    const { session, deps, ready, flush } = setup(prescribed())
    await session.start(false)
    expect(deps.grantConsent).not.toHaveBeenCalled()
    await session.start(true)
    await flush()
    expect(session.state.startRefused).toBe(true)
    expect(session.state.sessionId).toBeNull()
    ready()
    await session.start(true)
    expect(session.state.snapshot.running).toBe(true)
    expect(session.state.sessionId).toBe('session-1')
  })

  it('records one consent for the run and saves the finished session with it', async () => {
    const { session, deps, saved, ready, rep, flush } = setup(prescribed())
    ready()
    await session.start(true)
    rep(); rep()
    session.finish()
    await flush()
    expect(deps.grantConsent).toHaveBeenCalledTimes(1)
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ sessionId: 'session-1', consentId: 'consent-1', client: 'web', metrics: { completed: 2 } })
    expect(session.state.phase).toBe('done')
    expect(session.state.saves.map((s) => s.status)).toEqual(['saved'])
  })

  it('keeps a failed save to try again, and a retry sends the same session', async () => {
    const { session, saved, ready, rep, flush } = setup(prescribed(), { failSaves: 1 })
    ready()
    await session.start(true)
    rep()
    session.finish()
    await flush()
    expect(session.state.saves.map((s) => s.status)).toEqual(['failed'])
    expect(session.state.unsaved).toBe(true)
    session.retry()
    await flush()
    expect(saved.map((s) => s.sessionId)).toEqual(['session-1'])
    expect(session.state.unsaved).toBe(false)
  })

  it('pauses, and a resumed session keeps its count and id', async () => {
    const { session, ready, rep } = setup(prescribed({ targetRepetitions: 5 }))
    ready()
    await session.start(true)
    rep()
    session.pause()
    expect(session.state.snapshot.running).toBe(false)
    ready()
    await session.start(true)
    rep()
    expect(session.state.snapshot.completed).toBe(2)
    expect(session.state.sessionId).toBe('session-1')
  })

  it('runs an untimed both-sides set: left ends at the target, a countdown, then the right side under the same consent', async () => {
    const { session, deps, saved, ready, rep, frame, flush, pass } = setup(prescribed({ bilateral: true, targetRepetitions: 1 }))
    ready()
    await session.start(true)
    rep()
    await flush()
    expect(session.state.switching).toMatchObject({ next: 'RIGHT', stage: 'announcing', secondsLeft: 5 })
    expect(saved.map((s) => s.rules.side)).toEqual(['LEFT'])
    session.announced()
    expect(session.state.switching).toMatchObject({ stage: 'counting', secondsLeft: 5 })
    await pass(5000)
    expect(session.state.switching).toMatchObject({ stage: 'waiting' })
    expect(session.state.rules.side).toBe('RIGHT')
    for (let i = 0; i < 6; i++) frame(10)
    await flush()
    expect(session.state.switching).toBeNull()
    expect(session.state.snapshot.running).toBe(true)
    rep()
    session.finish()
    await flush()
    expect(saved.map((s) => [s.rules.side, s.sessionId])).toEqual([['LEFT', 'session-1'], ['RIGHT', 'session-2']])
    expect(deps.grantConsent).toHaveBeenCalledTimes(1)
    expect(session.state.sides.map((s) => s.side)).toEqual(['LEFT', 'RIGHT'])
  })

  it('waits for the next-side announcement before counting down, and counts anyway if the voice never says it is done', async () => {
    const { session, ready, rep, flush, pass } = setup(prescribed({ bilateral: true, targetRepetitions: 1 }))
    const cues: string[] = []
    session.onCue((cue) => cues.push(cue.type === 'count' ? `count ${cue.n}` : cue.type))
    ready()
    await session.start(true)
    rep()
    await flush()
    expect(cues).toEqual(['sideDone'])
    await pass(5999)
    expect(session.state.switching).toMatchObject({ stage: 'announcing' })
    await pass(1)
    expect(session.state.switching).toMatchObject({ stage: 'counting', secondsLeft: 5 })
    session.announced()
    await pass(5000)
    expect(cues).toEqual(['sideDone', 'count 5', 'count 4', 'count 3', 'count 2', 'count 1', 'go'])
    expect(session.state.switching).toMatchObject({ stage: 'waiting' })
  })

  it('counts down at once when the announcement is done straight away, as with the voice off', async () => {
    const { session, ready, rep, flush, pass } = setup(prescribed({ bilateral: true, targetRepetitions: 1 }))
    session.onCue((cue) => { if (cue.type === 'sideDone') session.announced() })
    ready()
    await session.start(true)
    rep()
    await flush()
    expect(session.state.switching).toMatchObject({ stage: 'counting', secondsLeft: 5 })
    await pass(5000)
    expect(session.state.switching).toMatchObject({ stage: 'waiting' })
  })

  it('holds the countdown when paused and starts the next side on Start', async () => {
    const { session, ready, rep, flush, pass } = setup(prescribed({ bilateral: true, targetRepetitions: 1 }))
    ready()
    await session.start(true)
    rep()
    await flush()
    session.pauseSwitch()
    await pass(10_000)
    expect(session.state.switching).toMatchObject({ stage: 'paused' })
    session.startNextSide()
    expect(session.state.switching).toMatchObject({ stage: 'waiting' })
  })

  it('ends a timed side when its time is up, even before the target', async () => {
    const { session, saved, ready, frame, flush } = setup(prescribed({ sideSeconds: 15, targetRepetitions: 50 }))
    ready()
    await session.start(true)
    for (let i = 0; i < 160; i++) frame(10)
    await flush()
    expect(session.state.phase).toBe('done')
    expect(saved).toHaveLength(1)
  })

  it('finishing between sides ends the set with the finished side already saved', async () => {
    const { session, saved, ready, rep, flush } = setup(prescribed({ bilateral: true, targetRepetitions: 1 }))
    ready()
    await session.start(true)
    rep()
    await flush()
    session.finish()
    await flush()
    expect(session.state.phase).toBe('done')
    expect(saved).toHaveLength(1)
    expect(session.state.sides.map((s) => s.side)).toEqual(['LEFT'])
  })

  it('remembers the latest repetition result, which the engine keeps for one frame only', async () => {
    const { session, ready, rep } = setup(prescribed({ targetRepetitions: 5 }))
    ready()
    await session.start(true)
    rep(60)
    expect(session.state.result).toMatchObject({ outcome: { type: 'missed', reason: 'INCOMPLETE_RANGE' }, sequence: 1 })
    rep()
    expect(session.state.result).toMatchObject({ outcome: { type: 'counted', count: 1 }, sequence: 2 })
  })

  it('a hidden tab pauses measuring without ending the session', async () => {
    const { session, ready } = setup(prescribed())
    ready()
    await session.start(true)
    session.interrupt()
    expect(session.state.snapshot.running).toBe(false)
    expect(session.state.phase).toBe('measuring')
  })

  it('saves whole milliseconds, which the server stores, even from a fractional clock', async () => {
    const { session, deps, saved, ready, rep, flush } = setup(prescribed())
    let fraction = 0.3
    const whole = deps.now
    deps.now = () => whole() + (fraction += 0.37)
    ready()
    await session.start(true)
    rep()
    session.finish()
    await flush()
    const metrics = saved[0]!.metrics as unknown as { duration: number; time: number }
    expect(Number.isInteger(metrics.duration)).toBe(true)
    expect(Number.isInteger(metrics.time)).toBe(true)
  })

  it('never records demo rules, as a release phone does not', async () => {
    const { session, deps, ready } = setup(createRules())
    ready()
    await session.start(true)
    expect(deps.grantConsent).not.toHaveBeenCalled()
    expect(session.state.snapshot.running).toBe(false)
  })
})
