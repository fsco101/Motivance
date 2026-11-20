import { CheckCircleIcon, InfoIcon, StarIcon } from '@phosphor-icons/react'
import { AnimatePresence, m as motion } from 'motion/react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { useStill } from '@/motion/useStill'
import { repetitionGuide } from '../assessment'
import { useDuration } from '../camera/CameraStage'
import type { SessionController, SessionState } from '../session/controller'
import { ChimePlayer } from './chime'
import { CuePlayer, readSound, SOUND_KEYS, writeSound, type CueUtterance, type Speaker } from './cues'
import { wordsIn } from './words'

/** How long a counted or missed result, or a cue shown as text, stays on screen. */
const RESULT_SHOWN_MS = 2500
/** Before the finish line is said, a moment for the saved session to reach today's list (Android waits as long). */
const FINISH_PAUSE_MS = 600
/** How long the celebration stays after the line, before the results. */
const FINISH_SHOWN_MS = 2900
/** The finish never waits longer than this for a slow save before going on. */
const SAVE_WAIT_MS = 6000

function browserSpeaker(): { speaker: Speaker | null; make: (text: string) => CueUtterance } {
  const synth = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined' ? window.speechSynthesis : null
  return {
    speaker: synth as unknown as Speaker | null,
    make: (text) => new SpeechSynthesisUtterance(text) as unknown as CueUtterance,
  }
}

/**
 * The session's voice and sounds: the patient's two switches, the spoken cues and the finish tune. Results and set cues
 * come from the controller. With the voice off, or no voice in the browser, nothing is waited for between sides.
 */
export function useCoach(controller: SessionController, state: SessionState, exerciseName: string) {
  const { i18n } = useTranslation()
  const language = i18n.language === 'fil' ? 'fil' : 'en'
  const [voice, setVoiceState] = useState(() => readSound(SOUND_KEYS.voice))
  const [finishSound, setFinishState] = useState(() => readSound(SOUND_KEYS.finish))
  const [player] = useState(() => { const { speaker, make } = browserSpeaker(); return new CuePlayer(speaker, make, language, wordsIn) })
  const [chime] = useState(() => new ChimePlayer())
  const [speaks, setSpeaks] = useState(player.speaks)
  const [caption, setCaption] = useState<{ text: string; key: number } | null>(null)
  const settings = useRef({ voice, finishSound, exerciseName })
  useLayoutEffect(() => { settings.current = { voice, finishSound, exerciseName } })

  useEffect(() => {
    // Browsers load their voices after the page, and can add or remove some later.
    const synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null
    const refresh = () => { player.refresh(); setSpeaks(player.speaks) }
    synth?.addEventListener('voiceschanged', refresh)
    return () => { synth?.removeEventListener('voiceschanged', refresh); player.stop(); chime.release() }
  }, [player, chime])

  const show = useCallback((text: string) => { if (!player.speaks) setCaption({ text, key: Date.now() }) }, [player])
  useEffect(() => {
    if (!caption) return
    const id = window.setTimeout(() => setCaption(null), RESULT_SHOWN_MS)
    return () => window.clearTimeout(id)
  }, [caption])

  const sequence = state.result?.sequence
  const seen = useRef(sequence)
  useEffect(() => {
    if (sequence === undefined || sequence === seen.current) return
    seen.current = sequence
    if (settings.current.voice && state.result) show(player.play(state.result.outcome))
  }, [sequence, state.result, player, show])

  useEffect(() => controller.onCue((cue) => {
    const { voice, finishSound, exerciseName } = settings.current
    const announced = cue.type === 'sideDone' ? () => controller.announced() : undefined
    // With the finish sound on, the celebration says the set is over instead.
    if (!voice || (cue.type === 'complete' && finishSound)) { announced?.(); return }
    const line = player.announce(cue, exerciseName, announced)
    if (cue.type !== 'count') show(line)
  }), [controller, player, show])

  /** Call from every press, so sound is allowed once the patient has pressed something. */
  const unlock = useCallback(() => { player.unlock(); chime.unlock() }, [player, chime])
  const setVoice = (on: boolean) => { unlock(); setVoiceState(on); writeSound(SOUND_KEYS.voice, on); if (!on) setCaption(null) }
  const setFinishSound = (on: boolean) => { unlock(); setFinishState(on); writeSound(SOUND_KEYS.finish, on) }
  return { voice, setVoice, finishSound, setFinishSound, speaks, caption: voice ? caption : null, unlock, player, chime }
}
export type Coach = ReturnType<typeof useCoach>

/**
 * The step the engine is waiting for and the last result, in plain words beside the camera image (RepCoach on Android).
 * Everything comes from the shared repetition guide and the engine's results, so it only describes what the counter does.
 */
export function RepCoach({ state, paused, caption }: { state: SessionState; paused: boolean; caption: { text: string; key: number } | null }) {
  const { t } = useTranslation()
  const duration = useDuration()
  const { rules, snapshot: s } = state
  const guide = repetitionGuide(rules, s)
  // A result already there when the coach appears is not shown again.
  const announced = useRef(state.result?.sequence ?? 0)
  const [showing, setShowing] = useState<SessionState['result']>(null)
  const latest = state.result
  useEffect(() => {
    if (!latest || latest.sequence === announced.current) return
    announced.current = latest.sequence
    setShowing(latest)
  }, [latest])
  useEffect(() => {
    if (!showing) return
    const id = window.setTimeout(() => setShowing(null), RESULT_SHOWN_MS)
    return () => window.clearTimeout(id)
  }, [showing])
  const started = state.sessionId !== null
  const step = s.running && !paused && s.quality === 'READY' ? guide.step : null
  const prompt = paused || (!s.running && started) ? t('coach.paused')
    : !s.running ? t('coach.notRecording')
      : step === null ? t('coach.tracking')
        : step === 'START' ? t('coach.start', { degrees: Math.trunc(rules.lowDegrees) })
          : step === 'REACH' ? t('coach.reach', { degrees: Math.trunc(rules.highDegrees) })
            : step === 'HOLD' ? t('coach.hold', { time: duration(rules.peakHoldMs) })
              : t('coach.return', { degrees: Math.trunc(rules.lowDegrees) })
  const stepNumber = step === null ? null : ['START', 'REACH', 'HOLD', 'RETURN'].indexOf(step) + 1
  return (
    <div className="mt-2 flex flex-col gap-1.5 rounded-[16px] bg-night-panel p-3.5">
      <AnimatePresence initial={false}>
        {showing && (
          <motion.div key={showing.sequence} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <ResultLine outcome={showing.outcome} target={rules.targetRepetitions} />
          </motion.div>
        )}
      </AnimatePresence>
      {stepNumber !== null && <p className="text-sm font-medium text-night-ink">{t('coach.step', { n: stepNumber })}</p>}
      <p aria-live="polite" className="text-xl font-semibold text-paper">{prompt}</p>
      {step === 'HOLD' && rules.peakHoldMs > 0 && (
        <div role="progressbar" aria-label={t('coach.holdProgress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(guide.holdProgress * 100)}
          className="h-1.5 w-full overflow-hidden rounded-full bg-night-ink/25">
          <div className="h-full rounded-full bg-sprout-bright" style={{ width: `${guide.holdProgress * 100}%` }} />
        </div>
      )}
      {caption && <p key={caption.key} aria-live="polite" className="text-base font-medium text-sprout-bright">{caption.text}</p>}
    </div>
  )
}

function ResultLine({ outcome, target }: { outcome: NonNullable<SessionState['result']>['outcome']; target: number }) {
  const { t } = useTranslation()
  const counted = outcome.type === 'counted'
  const words = outcome.type === 'counted' ? t('coach.counted', { count: outcome.count, target })
    : t(outcome.reason === 'TOO_FAST' ? 'coach.missedFast' : outcome.reason === 'TIMED_OUT' ? 'coach.missedSlow' : 'coach.missedRange')
  return (
    <p role="status" className={`flex items-center gap-2 text-lg font-bold ${counted ? 'text-sprout-bright' : 'text-night-caution'}`}>
      {counted ? <CheckCircleIcon aria-hidden weight="fill" className="size-6 shrink-0" /> : <InfoIcon aria-hidden weight="fill" className="size-6 shrink-0" />}
      {words}
    </p>
  )
}

/** A labelled switch, as on Android: words read better at a distance than a speaker icon. */
export function SoundSwitch({ on, onLabel, offLabel, help, onChange }: { on: boolean; onLabel: string; offLabel: string; help: string; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
      className="flex min-h-[52px] w-full items-center gap-3 rounded-control px-1 text-left">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-semibold text-paper">{on ? onLabel : offLabel}</span>
        <span className="text-sm text-night-ink">{help}</span>
      </span>
      <span aria-hidden className={`relative h-7 w-12 shrink-0 rounded-full transition-colors motion-reduce:transition-none ${on ? 'bg-sprout-bright' : 'bg-night-line'}`}>
        <span className={`absolute top-1 size-5 rounded-full bg-paper transition-[left] motion-reduce:transition-none ${on ? 'left-6' : 'left-1'}`} />
      </span>
    </button>
  )
}

/** The voice switch and the finish sound's own switch, beside it (RepSoundToggle and FinishSoundToggle on Android). */
export function SoundSwitches({ coach }: { coach: Coach }) {
  const { t } = useTranslation()
  return (
    <section className="flex flex-col gap-1 rounded-[24px] border border-night-line bg-night p-3 text-paper">
      <SoundSwitch on={coach.voice} onLabel={t('coach.voiceOn')} offLabel={t('coach.voiceOff')} help={t('coach.voiceHelp')} onChange={coach.setVoice} />
      {coach.voice && !coach.speaks && <p className="px-1 text-sm text-night-ink">{t('coach.voiceTextOnly')}</p>}
      <SoundSwitch on={coach.finishSound} onLabel={t('coach.finishOn')} offLabel={t('coach.finishOff')} help={t('coach.finishHelp')} onChange={coach.setFinishSound} />
    </section>
  )
}

/**
 * The finish, before the results: what was done, for a few seconds (FinishCelebration on Android). The tune plays at once;
 * the line waits until the sessions are saved, so it can say whether that was the last exercise of the day. Its button
 * goes straight on. Fewer repetitions than the target is still a finish, said kindly.
 */
export function FinishCelebration({ completed, target, romDegrees, saving, allSaved, coach, lastOfDay, onDone }: {
  completed: number; target: number; romDegrees: number | null; saving: boolean; allSaved: boolean; coach: Coach
  lastOfDay: () => Promise<boolean>; onDone: () => void
}) {
  const { t } = useTranslation()
  const reduced = useStill()
  const reached = completed >= target
  const [dayDone, setDayDone] = useState(false)
  const [said, setSaid] = useState(false)
  const [waitedEnough, setWaitedEnough] = useState(false)
  const done = useRef(onDone)
  useLayoutEffect(() => { done.current = onDone })
  const leave = useRef(false)
  const go = useCallback(() => { if (!leave.current) { leave.current = true; done.current() } }, [])
  const sound = useRef(coach.finishSound)

  useEffect(() => {
    if (sound.current) coach.chime.play()
    const id = window.setTimeout(() => setWaitedEnough(true), SAVE_WAIT_MS)
    return () => window.clearTimeout(id)
  }, [coach.chime])
  useEffect(() => {
    if (said || (saving && !waitedEnough)) return
    let cancelled = false
    const id = window.setTimeout(() => {
      const check = allSaved ? lastOfDay().catch(() => false) : Promise.resolve(false)
      void check.then((last) => {
        if (cancelled) return
        setDayDone(last)
        setSaid(true)
        if (sound.current) coach.player.finish(completed, target, last)
      })
    }, FINISH_PAUSE_MS)
    return () => { cancelled = true; window.clearTimeout(id) }
  }, [said, saving, waitedEnough, allSaved, lastOfDay, coach.player, completed, target])
  useEffect(() => {
    if (!said) return
    const id = window.setTimeout(go, FINISH_SHOWN_MS)
    return () => window.clearTimeout(id)
  }, [said, go])

  const Icon = reached ? StarIcon : CheckCircleIcon
  return (
    <section className="flex min-h-[420px] w-full flex-col items-center justify-center gap-3.5 rounded-[24px] bg-night p-6 text-center text-paper">
      <motion.span aria-hidden initial={reduced ? false : { scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: 'spring', bounce: 0.5, duration: 0.8 }}>
        <Icon weight="fill" className="size-28 text-sprout-bright" />
      </motion.span>
      <h2 aria-live="polite" className="text-3xl font-bold">{t(reached ? 'finish.titleTarget' : 'finish.titleShort')}</h2>
      <p className="text-xl">{t('finish.reps', { done: completed, target })}</p>
      {romDegrees !== null && <p className="text-lg text-night-ink">{t('finish.range', { degrees: romDegrees.toFixed(0) })}</p>}
      {dayDone && <p className="text-lg text-sprout-bright">{t('finish.dayDone')}</p>}
      <Button size="lg" variant="bright" className="mt-2" onClick={go}>{t('finish.tap')}</Button>
    </section>
  )
}
