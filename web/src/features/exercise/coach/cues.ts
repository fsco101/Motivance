import type { BodySide, RepOutcome } from '../assessment'
import type { SetCue } from '../session/controller'

/** The phrases in one language (cue_* and cue_finish_* on Android). `sideDone` and `finishShort` are filled in here. */
export interface CueWords {
  counted: readonly string[]
  missed: Record<'INCOMPLETE_RANGE' | 'TOO_FAST' | 'TIMED_OUT', string>
  targetReached: string
  /** Takes {{done}}, {{next}} and {{name}}. */
  sideDone: string
  go: string
  complete: string
  sides: Record<BodySide, string>
  finishTarget: string
  /** Takes {{done}} and {{target}}. */
  finishShort: string
  dayDone: string
}

const fill = (text: string, values: Record<string, string | number>) => text.replace(/{{\s*(\w+)\s*}}/g, (_, key: string) => String(values[key] ?? ''))

/** The words for one repetition result (RepCueScript on Android). Praise rotates, and the line just spoken is never picked again next. */
export class RepCueScript {
  private last: string | null = null
  constructor(private readonly words: CueWords, private readonly random: () => number = Math.random) {}
  lineFor(outcome: RepOutcome) {
    let line: string
    if (outcome.type === 'counted') {
      const fresh = this.words.counted.filter((word) => word !== this.last)
      const pool = fresh.length > 0 ? fresh : this.words.counted
      line = pool[Math.min(Math.floor(this.random() * pool.length), pool.length - 1)]!
    } else line = this.words.missed[outcome.reason as keyof CueWords['missed']] ?? this.words.missed.INCOMPLETE_RANGE
    this.last = line
    return line
  }
}

/** What the voice says about the set, apart from each repetition (SetCueLines on Android). */
export function setCueLine(words: CueWords, cue: SetCue, exerciseName: string) {
  switch (cue.type) {
    case 'targetReached': return words.targetReached
    case 'sideDone': return fill(words.sideDone, { done: words.sides[cue.done], next: words.sides[cue.next], name: exerciseName })
    case 'count': return String(cue.n)
    case 'go': return words.go
    case 'complete': return words.complete
  }
}

/** What the voice says at the finish (FinishLines on Android). */
export function finishLine(words: CueWords, completed: number, target: number, lastOfDay: boolean) {
  const line = completed >= target ? words.finishTarget : fill(words.finishShort, { done: completed, target })
  return lastOfDay ? `${line} ${words.dayDone}` : line
}

/** The parts of the browser's voices this uses, so a test can stand in for them. */
export interface CueVoice { lang: string; name: string; default?: boolean; localService?: boolean }
export interface CueUtterance { text: string; lang: string; voice: CueVoice | null; onend: (() => void) | null; onerror: (() => void) | null }
export interface Speaker {
  speak(utterance: CueUtterance): void
  cancel(): void
  getVoices(): readonly CueVoice[]
}

const tag = (lang: string) => lang.replace('_', '-').toLowerCase()

/**
 * The voice to use: the app's language when the browser can speak it, else English, as on Android (CueVoice). `text`
 * is the language of the phrases. Null when the browser has no voice for either, and the cues are shown as text.
 */
export function chooseVoice(appLanguage: string, voices: readonly CueVoice[]): { voice: CueVoice; text: 'en' | 'fil' } | null {
  const pick = (match: (lang: string) => boolean) => {
    const found = voices.filter((voice) => match(tag(voice.lang)))
    // A voice on the device speaks at once and offline; a network voice is the fallback.
    return found.find((voice) => voice.localService) ?? found[0] ?? null
  }
  if (appLanguage === 'fil') {
    const filipino = pick((lang) => lang === 'fil-ph' || lang === 'tl-ph' || lang === 'fil' || lang === 'tl')
    if (filipino) return { voice: filipino, text: 'fil' }
  }
  const english = pick((lang) => lang === 'en-us') ?? pick((lang) => lang.startsWith('en'))
  return english ? { voice: english, text: 'en' } : null
}

/**
 * Speaks the cues with the browser's voice (RepCuePlayer on Android). A repetition result cuts off whatever is still being
 * said, so quick repetitions never pile up; a set announcement waits its turn so it never cuts off the last result. Nothing
 * is said until the patient has pressed something, as browsers require. With no voice for the language, each call returns
 * its line so the page can show it instead.
 */
export class CuePlayer {
  private choice: ReturnType<typeof chooseVoice> = null
  private script: RepCueScript | null = null
  private unlocked = false

  constructor(
    private readonly speaker: Speaker | null,
    private readonly make: (text: string) => CueUtterance,
    private readonly appLanguage: string,
    private readonly wordsIn: (language: 'en' | 'fil') => CueWords,
    private readonly random: () => number = Math.random,
  ) { this.refresh() }

  /** Picks the voice again; browsers load their voices after the page. */
  refresh() {
    this.choice = this.speaker ? chooseVoice(this.appLanguage, this.speaker.getVoices()) : null
    this.script = new RepCueScript(this.words, this.random)
  }

  /** True when the browser can say the cues. */
  get speaks() { return this.choice !== null }
  /** The phrases in the language being spoken, or the app's language when shown as text. */
  get words() { return this.wordsIn(this.choice?.text ?? (this.appLanguage === 'fil' ? 'fil' : 'en')) }

  /** Called from a press, so later speech is allowed. */
  unlock() { this.unlocked = true }

  private say(text: string, interrupt: boolean, done?: () => void) {
    if (!this.speaker || !this.choice || !this.unlocked) { done?.(); return }
    if (interrupt) this.speaker.cancel()
    const utterance = this.make(text)
    utterance.lang = this.choice.voice.lang
    utterance.voice = this.choice.voice
    if (done) {
      let called = false
      const once = () => { if (!called) { called = true; done() } }
      utterance.onend = once
      utterance.onerror = once
    }
    this.speaker.speak(utterance)
  }

  /** Says one repetition's result over anything still playing. Returns the words. */
  play(outcome: RepOutcome) {
    const line = this.script!.lineFor(outcome)
    this.say(line, true)
    return line
  }

  /** Says a set announcement after whatever is playing. `finished` runs once it has been said, or straight away without a voice. */
  announce(cue: SetCue, exerciseName: string, finished?: () => void) {
    const line = setCueLine(this.words, cue, exerciseName)
    this.say(line, false, finished)
    return line
  }

  /** Says the finish line over anything still playing. */
  finish(completed: number, target: number, lastOfDay: boolean) {
    const line = finishLine(this.words, completed, target, lastOfDay)
    this.say(line, true)
    return line
  }

  /** Stops anything being said, as the page closes. The player can still speak again if it is shown again. */
  stop() { this.speaker?.cancel() }
}

/** The patient's two sound choices, kept in this browser like Android keeps them on the phone. Both start on. */
export const SOUND_KEYS = { voice: 'motivance.session.voice', finish: 'motivance.session.finishSound' } as const
export function readSound(key: string, store: Pick<Storage, 'getItem'> | null = safeStorage()) {
  try { return store?.getItem(key) !== 'off' } catch { return true }
}
export function writeSound(key: string, on: boolean, store: Pick<Storage, 'setItem'> | null = safeStorage()) {
  try { store?.setItem(key, on ? 'on' : 'off') } catch { /* A private window may refuse; the choice then lasts for this page only. */ }
}
function safeStorage() {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

