import { CheckCircleIcon, PauseIcon, PlayIcon, ArrowsClockwiseIcon } from '@phosphor-icons/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { useSignedIn } from '@/auth/AuthProvider'
import { Button, ButtonLink } from '@/components/Button'
import { Notice, PageHeader, Panel, StatusPill } from '@/components/Display'
import { supabase } from '@/data/client'
import { loadExerciseDay } from '@/data/exerciseSchedule'
import { grantConsent, loadSessionRules, saveSession, type SessionExercise } from '@/data/session'
import { clock } from '@/data/therapist'
import { SkeletonLines } from '@/features/shared'
import '@/locales/exercise'
import { romDegrees, type AssessmentSnapshot, type ExerciseRules } from './assessment'
import { Calculations, CameraStage, MetricTile, useDuration, useStageCanvas } from './camera/CameraStage'
import { useCamera } from './camera/useCamera'
import { usePreparedTracking, useTracking } from './camera/useTracking'
import { Checklist, Privacy, UsePhoneInstead } from './CameraCheckPage'
import { FinishCelebration, RepCoach, SoundSwitches, useCoach } from './coach/Coach'
import { GuideStage } from './guide/ExerciseGuide'
import { guideMotionFor } from './guide/rig'
import { cameraSupport } from './pose/support'
import { SessionController, type SessionState, type SideResult } from './session/controller'
import { sideRemainingMs } from './session/sideSet'

const degrees = (value: number | null) => (value !== null && Number.isFinite(value) ? `${value.toFixed(1)}°` : '—')

/** An exercise session on the web, at /patient/exercises/:versionId/session (Android's camera session for an assignment). */
export function ExerciseSessionPage({ base }: { base: string }) {
  const { t, i18n } = useTranslation()
  const { userId } = useSignedIn()
  const { versionId = '' } = useParams()
  const support = useMemo(() => cameraSupport(), [])
  const exercise = useQuery({ queryKey: ['patient', 'session', userId, versionId, i18n.language], queryFn: () => loadSessionRules(supabase(), userId, versionId, i18n.language), staleTime: Infinity })
  const [step, setStep] = useState<'setup' | 'live'>('setup')
  usePreparedTracking()
  const back = <ButtonLink to={`${base}/exercises`} variant="secondary">{t('session.back')}</ButtonLink>
  if (!support.ok) return <><PageHeader title={t('session.title')} /><UsePhoneInstead message={t('camera.trackingFailed')} /></>
  if (exercise.isPending) return <><PageHeader title={t('session.title')} /><Panel><SkeletonLines /></Panel></>
  if (exercise.isError) return <><PageHeader title={t('session.title')} /><Notice onRetry={() => void exercise.refetch()}>{t('session.loadFailed')}</Notice></>
  if (!exercise.data) return <><PageHeader title={t('session.title')} /><Panel><p className="mb-4 max-w-[60ch]">{t('session.notFound')}</p>{back}</Panel></>
  const { rules, name } = exercise.data
  return (
    <>
      <PageHeader title={name} description={t('session.title')} />
      {step === 'setup' ? <Setup exercise={exercise.data} onOpen={() => setStep('live')} /> : <LiveSession rules={rules} name={name} owner={userId} base={base} />}
      {step === 'setup' && <div className="mt-4">{back}</div>}
    </>
  )
}

function Setup({ exercise, onOpen }: { exercise: SessionExercise; onOpen: () => void }) {
  const { t } = useTranslation()
  const { rules } = exercise
  return (
    <div className="grid max-w-[640px] gap-4">
      <Panel title={t(`joints.${rules.measuredJoint}`)} description={rules.bilateral ? t('session.perSide') : t(rules.side === 'LEFT' ? 'camera.left' : 'camera.right')}>
        {/* The model person moves through the range this patient was prescribed. */}
        <GuideStage motion={guideMotionFor(rules)} name={exercise.name} className="mb-4 h-64" />
        <div className="flex flex-wrap gap-2">
          <StatusPill tone="positive">{t('session.targets', { low: Math.trunc(rules.lowDegrees), high: Math.trunc(rules.highDegrees), reps: rules.targetRepetitions })}</StatusPill>
          {rules.sideSeconds !== null && <StatusPill tone="positive">{t('session.timePerSide', { time: clock(rules.sideSeconds) })}</StatusPill>}
        </div>
        {exercise.instructions && <p className="mt-4 max-w-[62ch] whitespace-pre-line">{exercise.instructions}</p>}
      </Panel>
      <Checklist />
      <div><Button size="lg" onClick={onOpen}>{t('session.open')}</Button></div>
      <Privacy text={t('session.privacy')} />
    </div>
  )
}

function useController(rules: ExerciseRules, owner: string) {
  const [controller] = useState(() => new SessionController(rules, {
    ownerId: owner,
    grantConsent: () => grantConsent(supabase()),
    save: (payload) => saveSession(supabase(), payload),
    now: () => performance.now(),
    wall: () => Date.now(),
    uuid: () => crypto.randomUUID(),
    later: (run, ms) => { const id = window.setTimeout(run, ms); return () => window.clearTimeout(id) },
  }))
  const state = useSyncExternalStore(controller.subscribe, controller.getState)
  return { controller, state }
}

function LiveSession({ rules, name, owner, base }: { rules: ExerciseRules; name: string; owner: string; base: string }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const { controller, state } = useController(rules, owner)
  const coach = useCoach(controller, state, name)
  const [celebrated, setCelebrated] = useState(false)
  const checkDay = useMemo(() => lastOfDay(owner), [owner])
  const camera = useCamera()
  const live = camera.state.status === 'live' ? camera.state : null
  const video = useRef<HTMLVideoElement | null>(null)
  const stage = useStageCanvas(state.rules, live?.mirrored ?? true)
  const [consent, setConsent] = useState(false)
  const done = state.phase === 'done'
  const tracking = useTracking({
    video, stream: done ? null : live?.stream ?? null, draw: stage.draw,
    process: (frame) => controller.frame(frame.people, frame.width, frame.height, frame.timestampMs),
    onHidden: () => controller.interrupt(),
  })

  // Leaving with a side measuring or not yet saved would lose it, so the browser asks first.
  const atRisk = state.unsaved || (state.sessionId !== null && !done)
  useEffect(() => {
    if (!atRisk) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [atRisk])

  const { stop } = camera
  useEffect(() => { if (done) stop() }, [done, stop])
  const savedAll = done && state.saves.length > 0 && !state.unsaved
  useEffect(() => {
    if (!savedAll) return
    // A finished exercise leaves today's list straight away, and shows in history and progress.
    void client.invalidateQueries({ queryKey: ['patient'] })
  }, [savedAll, client])

  if (done && state.saves.length > 0 && !celebrated) {
    // Both sides of a set count together; a single side is one entry.
    const completed = state.sides.reduce((sum, side) => sum + side.snapshot.completed, 0)
    const target = state.sides.reduce((sum, side) => sum + side.target, 0)
    const ranges = state.sides.map((side) => romDegrees(side.snapshot)).filter((value): value is number => value !== null)
    return (
      <FinishCelebration completed={completed} target={target} romDegrees={ranges.length > 0 ? Math.max(...ranges) : null} coach={coach}
        saving={state.saves.some((save) => save.status === 'saving')} allSaved={!state.unsaved} lastOfDay={checkDay} onDone={() => setCelebrated(true)} />
    )
  }
  if (done) return <SessionResult state={state} base={base} onRetry={() => controller.retry()} />
  const cameraState = camera.state
  const remaining = sideRemainingMs(state.rules, state.snapshot)
  return (
    <div className="grid max-w-[640px] gap-4">
      {cameraState.status === 'idle' || cameraState.status === 'starting' ? (
        <Panel>
          <p className="mb-4 max-w-[60ch] text-slate">{t('camera.allowHelp')}</p>
          <Button onClick={() => { coach.unlock(); void camera.start() }} busy={cameraState.status === 'starting'}>{t('camera.allow')}</Button>
        </Panel>
      ) : cameraState.status === 'error' ? (
        cameraState.error === 'blocked'
          ? <Notice tone="caution" title={t('camera.blocked')} onRetry={() => void camera.start()}>{t('camera.blockedHelp')}</Notice>
          : <Notice tone="caution" onRetry={() => void camera.start()}>{t(`camera.${cameraState.error}`)}</Notice>
      ) : null}
      {live && tracking.status === 'failed' && <UsePhoneInstead message={t('camera.trackingFailed')} />}
      {live && tracking.status !== 'failed' && (
        <>
          {tracking.status === 'loading' && <Notice tone="info" title={t('camera.loading')}>{t('camera.loadingHelp')}</Notice>}
          {tracking.hiddenPause && <Notice tone="info" title={t('camera.paused')}>{t('camera.hiddenPause')}</Notice>}
          {tracking.slow && <Notice tone="caution">{t('camera.slow')}</Notice>}
          <CameraStage rules={state.rules} snapshot={state.snapshot} hasFrame={tracking.hasFrame} canvas={stage.canvas} video={video} points={tracking.points} paused={tracking.hiddenPause}
            coach={<RepCoach state={state} paused={tracking.hiddenPause} caption={coach.caption} />}
            tiles={remaining !== null ? <MetricTile label={t('camera.timeLeft')} value={clock(Math.ceil(remaining / 1000))} /> : undefined} />
          {/* A reminder of the movement before starting. Once running, the patient follows their own measured movement instead. */}
          {!state.snapshot.running && <GuideStage motion={guideMotionFor(state.rules)} name={name} dark className="h-56" />}
          {state.switching ? <SideSwitchCard state={state} onPause={() => { coach.unlock(); controller.pauseSwitch() }} onStart={() => { coach.unlock(); controller.startNextSide() }} />
            : <MeasurementControls state={state} consent={consent} onConsent={setConsent} onStart={() => { coach.unlock(); void controller.start(consent) }} onPause={() => controller.pause()} onFinish={() => { coach.unlock(); controller.finish() }} />}
          <SoundSwitches coach={coach} />
          <section className="flex flex-col gap-3 rounded-[24px] border border-night-line bg-night p-4 text-paper">
            <h2 className="text-lg font-semibold">{t('calc.title')}</h2>
            <Calculations rules={state.rules} snapshot={state.snapshot} hasFrame={tracking.hasFrame} />
          </section>
          {tracking.diagnostics && tracking.delegate && (
            <p className="text-xs text-slate tabular-nums">{t('camera.diagnostics', { fps: tracking.diagnostics.fps.toFixed(1), p95: tracking.diagnostics.p95LatencyMs, delegate: t(`camera.delegate${tracking.delegate}`) })}</p>
          )}
          {camera.devices.length > 1 && <div><Button variant="secondary" leading={<ArrowsClockwiseIcon aria-hidden />} onClick={camera.switchCamera}>{t('camera.switch')}</Button></div>}
        </>
      )}
    </div>
  )
}

/** Android's MeasurementControls: what is happening, what to do next, consent, and Start, Pause and Finish. */
function MeasurementControls({ state, consent, onConsent, onStart, onPause, onFinish }: { state: SessionState; consent: boolean; onConsent: (value: boolean) => void; onStart: () => void; onPause: () => void; onFinish: () => void }) {
  const { t } = useTranslation()
  const duration = useDuration()
  const { snapshot: s, rules } = state
  const started = state.sessionId !== null
  const status = s.running ? 'session.statusRecording' : started ? 'session.statusPaused' : 'session.statusPreview'
  const guidance = !s.running ? t(started ? 'session.resumeHelp' : 'session.startHelp')
    : s.quality !== 'READY' ? t('session.trackingWait')
      : s.phase === 'SEEKING_START' || s.phase === 'AT_TARGET' ? t('session.returnTo', { degrees: Math.trunc(rules.lowDegrees) })
        : rules.peakHoldMs > 0 ? t('session.reach', { degrees: Math.trunc(rules.highDegrees), hold: duration(rules.peakHoldMs) })
          : t('session.reachNoHold', { degrees: Math.trunc(rules.highDegrees) })
  return (
    <Panel>
      <div className="flex flex-col gap-3">
        <p aria-live="polite" className="flex items-center gap-2.5 text-lg font-semibold">
          <span aria-hidden className={`size-2.5 rounded-full ${s.running ? 'animate-pulse bg-[#ff6b5e] motion-reduce:animate-none' : 'bg-line-strong'}`} />
          {t(status)}
        </p>
        <p className="text-base">{guidance}</p>
        {state.startRefused && !s.running && <p role="alert" className="text-alarm">{t('session.startRefused')}</p>}
        {state.consentFailed && <p role="alert" className="text-alarm">{t('session.consentFailed')}</p>}
        {!started && (
          <label className="flex items-start gap-3 rounded-control border border-line p-3">
            <input type="checkbox" className="mt-1 size-5 shrink-0 accent-lagoon" checked={consent} onChange={(event) => onConsent(event.target.checked)} />
            <span>{t('session.consent')}</span>
          </label>
        )}
        <div className="flex flex-wrap gap-3">
          {s.running
            ? <Button size="lg" variant="secondary" leading={<PauseIcon aria-hidden />} onClick={onPause}>{t('session.pause')}</Button>
            : <Button size="lg" leading={<PlayIcon aria-hidden />} onClick={onStart} busy={state.starting} disabled={!consent && !started}>{t(started ? 'session.resume' : 'session.start')}</Button>}
          {started && <Button size="lg" variant="secondary" onClick={onFinish}>{t('session.finish')}</Button>}
        </div>
      </div>
    </Panel>
  )
}

/** Between two sides: what comes next, the countdown, and one way to hold it (SideSwitchCard on Android). */
function SideSwitchCard({ state, onPause, onStart }: { state: SessionState; onPause: () => void; onStart: () => void }) {
  const { t } = useTranslation()
  const switching = state.switching!
  const side = t(switching.next === 'RIGHT' ? 'camera.right' : 'camera.left')
  return (
    <section className="flex flex-col items-center gap-3 rounded-[24px] bg-night-panel p-4 text-center text-paper">
      <h2 aria-live="polite" className="text-xl font-semibold">{t('session.nextSide', { side })}</h2>
      {(switching.stage === 'announcing' || switching.stage === 'counting') && (
        <>
          <p aria-hidden className="text-6xl font-semibold text-sprout-bright tabular-nums">{switching.secondsLeft}</p>
          <p aria-live="polite" className="text-night-ink">{t('session.startingIn', { seconds: switching.secondsLeft })}</p>
          <Button variant="secondary" className="w-full" size="lg" onClick={onPause}>{t('session.switchPause')}</Button>
        </>
      )}
      {switching.stage === 'paused' && <Button className="w-full" size="lg" leading={<PlayIcon aria-hidden />} onClick={onStart}>{t('session.switchStart')}</Button>}
      {switching.stage === 'waiting' && <p aria-live="polite" className="text-night-ink">{t('session.getInView', { side })}</p>}
      {state.saves.some((save) => save.status === 'failed') && <p className="text-night-caution">{t('session.failed')}</p>}
    </section>
  )
}

/** Whether the exercise just finished was the last one due today, read once the session is saved (lastOfDay on Android). */
const lastOfDay = (owner: string) => async () => {
  const day = await loadExerciseDay(supabase(), owner)
  const due = day.exercises.filter((exercise) => exercise.due)
  return due.length > 0 && due.every((exercise) => exercise.done)
}

function sideLine(t: (key: string, values?: Record<string, unknown>) => string, side: SideResult) {
  const range = romDegrees(side.snapshot)
  return t('session.sideResult', {
    side: t(side.side === 'LEFT' ? 'camera.left' : 'camera.right'), done: side.snapshot.completed, target: side.target,
    range: degrees(range), time: t('session.seconds', { count: Math.round(side.snapshot.durationMs / 1000) }),
  })
}

/** Closing screen: the count against the target, range, misses and time, and whether it reached the server. */
function SessionResult({ state, base, onRetry }: { state: SessionState; base: string; onRetry: () => void }) {
  const { t } = useTranslation()
  const last: AssessmentSnapshot = state.sides[state.sides.length - 1]?.snapshot ?? state.snapshot
  const target = state.sides[state.sides.length - 1]?.target ?? state.rules.targetRepetitions
  const saving = state.saves.some((save) => save.status === 'saving')
  const failed = state.saves.some((save) => save.status === 'failed')
  return (
    <div className="grid max-w-[640px] gap-4">
      <Panel>
        <div className="flex flex-col items-center gap-2 py-2 text-center">
          <CheckCircleIcon aria-hidden weight="fill" className="size-14 text-lagoon" />
          <h2 className="text-xl font-semibold">{t('session.finished')}</h2>
          {state.saves.length > 0 && <p className="text-5xl font-semibold tabular-nums">{last.completed}</p>}
          {state.saves.length > 0 && <p className="text-slate">{t('session.repsOfTarget', { target })}</p>}
        </div>
        {state.sides.length > 1 && <ul className="mt-3 flex flex-col gap-1">{state.sides.map((side) => <li key={side.side}>{sideLine(t, side)}</li>)}</ul>}
        {state.saves.length > 0 && (
          <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
            <div><dt className="text-sm text-slate">{t('calc.sessionRom')}</dt><dd className="text-lg font-semibold">{degrees(romDegrees(last))}</dd></div>
            <div><dt className="text-sm text-slate">{t('calc.notCounted')}</dt><dd className="text-lg font-semibold">{last.incomplete}</dd></div>
            <div><dt className="text-sm text-slate">{t('session.activeTime')}</dt><dd className="text-lg font-semibold">{t('session.seconds', { count: Math.round(last.durationMs / 1000) })}</dd></div>
          </dl>
        )}
      </Panel>
      {state.saves.length === 0 ? <Notice tone="info">{t('session.nothingMeasured')}</Notice>
        : saving ? <Notice tone="info">{t('session.saving')}</Notice>
          : failed ? <Notice tone="error" onRetry={onRetry}>{t('session.failed')}</Notice>
            : <Notice tone="info">{t('session.saved')}</Notice>}
      <div><ButtonLink to={`${base}/exercises`} variant="secondary">{t('session.back')}</ButtonLink></div>
    </div>
  )
}
