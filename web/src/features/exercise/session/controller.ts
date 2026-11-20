import { createRules, MovementAssessment, repOutcome, type AssessmentSnapshot, type BodySide, type ExerciseRules, type Landmark, type RepOutcome } from '../assessment'
import { sessionPayload } from './payload'
import { SIDE_SET, sideEvent } from './sideSet'

export interface SessionDeps {
  ownerId: string
  /** Records a movement-summary grant on the server. */
  grantConsent: () => Promise<{ id: string; occurredAt: number }>
  save: (payload: ReturnType<typeof sessionPayload>) => Promise<unknown>
  /** The camera clock frames are stamped with (performance.now in the browser). */
  now: () => number
  /** Wall-clock milliseconds, for the saved start and end times. */
  wall: () => number
  uuid: () => string
  /** Runs `run` after `ms` and returns a cancel function. */
  later: (run: () => void, ms: number) => () => void
}

/** Announcing waits for the voice to say which side is next, so the countdown never talks over it (SwitchStage on Android). */
export type SwitchStage = 'announcing' | 'counting' | 'paused' | 'waiting'
export interface SideSwitch { next: BodySide; stage: SwitchStage; secondsLeft: number }
export interface SideResult { side: BodySide; target: number; snapshot: AssessmentSnapshot }
export interface SaveRecord { side: BodySide; sessionId: string; status: 'saving' | 'saved' | 'failed' }
/** What the session says out loud apart from each repetition (SetCue on Android). */
export type SetCue = { type: 'targetReached' } | { type: 'sideDone'; done: BodySide; next: BodySide } | { type: 'count'; n: number } | { type: 'go' } | { type: 'complete' }

export interface SessionState {
  /** The rules of the side being measured. */
  rules: ExerciseRules
  snapshot: AssessmentSnapshot
  /** The session being measured; null before Start and between sides. */
  sessionId: string | null
  phase: 'measuring' | 'done'
  starting: boolean
  /** Start was pressed but tracking was lost before measuring could begin. */
  startRefused: boolean
  consentFailed: boolean
  switching: SideSwitch | null
  /** Sides finished in this run, in order. */
  sides: SideResult[]
  saves: SaveRecord[]
  /** A finished side has not reached the server yet. */
  unsaved: boolean
  /** The latest repetition result; the engine's own feedback lasts one frame. `sequence` grows with every result. */
  result: { outcome: RepOutcome; sequence: number } | null
}

/**
 * One exercise run on the web, as ExerciseSessionViewModel runs it on Android: consent at the first Start, the shared
 * engine, both-sides sets with a countdown between sides, and each side saved as its own session under one consent.
 * Instead of a phone's outbox, a session that fails to save stays here with Try again, and a retry sends the same
 * session, which the server accepts once.
 */
export class SessionController {
  private engine: MovementAssessment
  private consent: { id: string; occurredAt: number } | null = null
  private startedAt = 0
  private payloads = new Map<string, ReturnType<typeof sessionPayload>>()
  private cancelTimer: (() => void) | null = null
  private listeners = new Set<() => void>()
  private cueListeners = new Set<(cue: SetCue) => void>()
  private sequence = 0
  state: SessionState

  /** The camera clock in whole milliseconds, like the frames' timestamps. */
  private now() { return Math.round(this.deps.now()) }

  constructor(rules: ExerciseRules, private readonly deps: SessionDeps) {
    this.engine = new MovementAssessment(rules)
    this.state = {
      rules, snapshot: this.engine.snapshot, sessionId: null, phase: 'measuring', starting: false, startRefused: false, consentFailed: false,
      switching: null, sides: [], saves: [], unsaved: false, result: null,
    }
  }

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  onCue(listener: (cue: SetCue) => void) { this.cueListeners.add(listener); return () => { this.cueListeners.delete(listener) } }
  getState = () => this.state

  private set(next: Partial<SessionState>) {
    const merged = { ...this.state, ...next }
    this.state = { ...merged, unsaved: merged.saves.some((save) => save.status !== 'saved') }
    this.listeners.forEach((listener) => listener())
  }
  private cue(cue: SetCue) { this.cueListeners.forEach((listener) => listener(cue)) }

  frame(people: readonly (readonly Landmark[])[], width: number, height: number, time: number): AssessmentSnapshot {
    if (this.state.phase === 'done') return this.state.snapshot
    const before = this.engine.snapshot
    const after = this.engine.process(people, width, height, time)
    const outcome = repOutcome(before, after)
    this.set({ snapshot: after, result: outcome ? { outcome, sequence: ++this.sequence } : this.state.result })
    const { switching, sessionId, rules } = this.state
    if (!switching && sessionId) {
      const event = sideEvent(rules, before, after)
      if (event?.type === 'targetReached') this.cue({ type: 'targetReached' })
      else if (event?.type === 'sideEnded') this.endSide(event.next)
      else if (event?.type === 'setComplete') this.endSide(null)
    } else if (switching?.stage === 'waiting' && after.quality === 'READY') this.beginNextSide()
    return this.state.snapshot
  }

  /** Start or resume measuring. `consent` is the patient's "allow saving" choice; demo rules are never recorded. */
  async start(consent: boolean) {
    const s = this.state
    if (!consent || s.starting || s.phase === 'done' || s.switching || s.rules.demo || s.snapshot.running) return
    this.set({ starting: true, consentFailed: false })
    try {
      this.consent ??= await this.deps.grantConsent()
    } catch {
      this.set({ starting: false, consentFailed: true })
      return
    }
    // Tracking can drop while consent is saved; say so instead of leaving Start looking pressed.
    if (!this.engine.start(this.now())) { this.set({ starting: false, startRefused: true }); return }
    if (this.state.sessionId === null) this.startedAt = Math.max(this.deps.wall(), this.consent.occurredAt)
    this.set({ starting: false, startRefused: false, snapshot: this.engine.snapshot, sessionId: this.state.sessionId ?? this.deps.uuid() })
  }

  /** The patient's own pause. */
  pause() { this.set({ snapshot: this.engine.pause(this.now()) }) }

  /** Measuring stops because the tab was hidden. A countdown between sides is held rather than run unwatched. */
  interrupt() {
    if (this.state.switching && this.state.switching.stage !== 'paused') this.pauseSwitch()
    this.pause()
  }

  finish() {
    const s = this.state
    if (s.phase === 'done') return
    // Between sides, the finished side is already saved: the set simply ends there.
    if (s.switching) { this.cancelTimer?.(); this.set({ switching: null, phase: 'done' }); return }
    if (!s.sessionId) return
    this.endSide(null)
  }

  /** Sends every session that failed to save again. Each keeps its id, so a session that did arrive is not saved twice. */
  retry() {
    for (const save of this.state.saves) if (save.status === 'failed') this.send(save.sessionId)
  }

  pauseSwitch() {
    const switching = this.state.switching
    if (!switching) return
    this.cancelTimer?.()
    this.set({ switching: { ...switching, stage: 'paused' } })
  }

  startNextSide() {
    const switching = this.state.switching
    if (switching?.stage !== 'paused') return
    this.set({ switching: { ...switching, stage: 'waiting' } })
  }

  private endSide(next: BodySide | null) {
    const finished = this.engine.pause(this.now())
    const { rules, sessionId } = this.state
    const sides = [...this.state.sides, { side: rules.side, target: rules.targetRepetitions, snapshot: finished }]
    if (sessionId && this.consent) {
      this.payloads.set(sessionId, sessionPayload({ sessionId, ownerId: this.deps.ownerId, consentId: this.consent.id, rules, snapshot: finished, startedAt: this.startedAt, endedAt: this.deps.wall() }))
      this.set({ saves: [...this.state.saves, { side: rules.side, sessionId, status: 'saving' }] })
      this.send(sessionId)
    }
    if (next === null) {
      this.set({ snapshot: finished, sides, phase: 'done', sessionId: null })
      this.cue({ type: 'complete' })
      return
    }
    const nextRules = createRules({ ...rules, side: next })
    this.engine = new MovementAssessment(nextRules)
    this.set({ rules: nextRules, snapshot: this.engine.snapshot, sides, sessionId: null, result: null, startRefused: false, switching: { next, stage: 'announcing', secondsLeft: SIDE_SET.countdownSeconds } })
    this.cancelTimer?.()
    // Without word from the voice, the countdown starts anyway. Set before the cue, which can end the announcement at once.
    this.cancelTimer = this.deps.later(() => this.announced(), SIDE_SET.announcementLimitMs)
    this.cue({ type: 'sideDone', done: rules.side, next })
  }

  /** The next-side announcement has been said, or there is no voice to wait for: start the countdown. */
  announced() {
    const switching = this.state.switching
    if (switching?.stage !== 'announcing') return
    this.cancelTimer?.()
    this.set({ switching: { ...switching, stage: 'counting', secondsLeft: SIDE_SET.countdownSeconds } })
    this.cue({ type: 'count', n: SIDE_SET.countdownSeconds })
    this.tick()
  }

  private tick() {
    this.cancelTimer = this.deps.later(() => {
      const switching = this.state.switching
      if (!switching || switching.stage !== 'counting') return
      if (switching.secondsLeft > 1) {
        this.set({ switching: { ...switching, secondsLeft: switching.secondsLeft - 1 } })
        this.cue({ type: 'count', n: switching.secondsLeft - 1 })
        this.tick()
      } else {
        this.set({ switching: { ...switching, stage: 'waiting' } })
        this.cue({ type: 'go' })
      }
    }, 1000)
  }

  /** Starts the next side under the consent given at the first Start, once tracking is ready. */
  private beginNextSide() {
    if (!this.consent || !this.engine.start(this.now())) return
    this.startedAt = Math.max(this.deps.wall(), this.consent.occurredAt)
    this.set({ switching: null, sessionId: this.deps.uuid(), snapshot: this.engine.snapshot, startRefused: false })
  }

  private send(sessionId: string) {
    const payload = this.payloads.get(sessionId)
    if (!payload) return
    const mark = (status: SaveRecord['status']) => this.set({ saves: this.state.saves.map((save) => (save.sessionId === sessionId ? { ...save, status } : save)) })
    mark('saving')
    this.deps.save(payload).then(() => mark('saved'), () => mark('failed'))
  }
}
