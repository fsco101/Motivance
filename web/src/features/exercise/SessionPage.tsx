import { ArrowsClockwiseIcon, CheckCircleIcon, FlagCheckeredIcon, PauseIcon, PlayIcon } from '@phosphor-icons/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { useSignedIn } from '@/auth/AuthProvider'
import { Button, ButtonLink } from '@/components/Button'
import { ConfirmDialog } from '@/components/Dialog'
import { NarrowPage, Notice, PageHeader, Panel, StatusPill } from '@/components/Display'
import { supabase } from '@/data/client'
import { loadExerciseDay } from '@/data/exerciseSchedule'
import { grantConsent, loadSessionRules, saveSession, type SessionExercise } from '@/data/session'
import { clock } from '@/data/therapist'
import { SkeletonLines } from '@/features/shared'
import { useExerciseMode } from '@/layout/exerciseMode'
import { cn } from '@/lib/cn'
import '@/locales/exercise'
import { romDegrees, type AssessmentSnapshot, type ExerciseRules } from './assessment'
import { Calculations, useStageCanvas } from './camera/CameraStage'
import { useCamera } from './camera/useCamera'
import { usePreparedTracking, useTracking } from './camera/useTracking'
import { Checklist, Privacy, UsePhoneInstead } from './CameraCheckPage'
import { FinishCelebration, RepCoach, useCoach } from './coach/Coach'
import { GuideStage } from './guide/ExerciseGuide'
import { guideMotionFor } from './guide/rig'
import { BigCount, CameraPicture, ExerciseModeFrame, ExitButton, FullscreenButton, HowItCounts, Reading, ToggleChip, useFullscreen, useModeKeys } from './mode/ExerciseMode'
import { cameraSupport } from './pose/support'
import { SessionController, type SessionState, type SideResult } from './session/controller'
import { sideRemainingMs } from './session/sideSet'
import { RecordConsentDialog, SessionVideoPanel, useRecordChoice, useRecordingSupport, useSessionRecording } from './video/SessionVideo'

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
  if (!support.ok) return <NarrowPage><PageHeader title={t('session.title')} /><UsePhoneInstead message={t('camera.trackingFailed')} /></NarrowPage>
  if (exercise.isPending) return <NarrowPage><PageHeader title={t('session.title')} /><Panel><SkeletonLines /></Panel></NarrowPage>
  if (exercise.isError) return <NarrowPage><PageHeader title={t('session.title')} /><Notice onRetry={() => void exercise.refetch()}>{t('session.loadFailed')}</Notice></NarrowPage>
  if (!exercise.data) return <NarrowPage><PageHeader title={t('session.title')} /><Panel><p className="mb-4 max-w-[60ch]">{t('session.notFound')}</p>{back}</Panel></NarrowPage>
  const { rules, name } = exercise.data
  if (step === 'live') return <LiveSession rules={rules} name={name} owner={userId} base={base} />
  return (
    <>
      <PageHeader title={name} description={t('session.title')} />
      <Setup exercise={exercise.data} onOpen={() => setStep('live')} back={back} />
    </>
  )
}

/** Before the camera: the movement and its targets beside how to set up, laid out for a wide screen. */
function Setup({ exercise, onOpen, back }: { exercise: SessionExercise; onOpen: () => void; back: ReactNode }) {
  const { t } = useTranslation()
  const { rules } = exercise
  return (
    <div className="grid items-start gap-5 desk:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <Panel title={t(`joints.${rules.measuredJoint}`)} description={rules.bilateral ? t('session.perSide') : t(rules.side === 'LEFT' ? 'camera.left' : 'camera.right')}>
        {/* The model person moves through the range this patient was prescribed. */}
        <GuideStage motion={guideMotionFor(rules)} name={exercise.name} className="mb-4 h-72 desk:h-80" />
        <div className="flex flex-wrap gap-2">
          <StatusPill tone="positive">{t('session.targets', { low: Math.trunc(rules.lowDegrees), high: Math.trunc(rules.highDegrees), reps: rules.targetRepetitions })}</StatusPill>
          {rules.sideSeconds !== null && <StatusPill tone="positive">{t('session.timePerSide', { time: clock(rules.sideSeconds) })}</StatusPill>}
        </div>
        {exercise.instructions && <p className="mt-4 max-w-[62ch] whitespace-pre-line">{exercise.instructions}</p>}
      </Panel>
      <div className="grid gap-4">
        <Checklist />
        <div className="flex flex-wrap gap-3"><Button size="lg" onClick={onOpen}>{t('session.open')}</Button>{back}</div>
        <Privacy text={t('session.privacy')} />
      </div>
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
  const navigate = useNavigate()
  const { controller, state } = useController(rules, owner)
  const coach = useCoach(controller, state, name)
  const [celebrated, setCelebrated] = useState(false)
  const checkDay = useMemo(() => lastOfDay(owner), [owner])
  const camera = useCamera()
  const live = camera.state.status === 'live' ? camera.state : null
  const video = useRef<HTMLVideoElement | null>(null)
  const stage = useStageCanvas(state.rules, live?.mirrored ?? true)
  const [consent, setConsent] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const done = state.phase === 'done'
  // Recording is the patient's own choice for each session, off until they turn it on (#114, #139).
  const support = useRecordingSupport()
  const recordChoice = useRecordChoice(owner)
  const stream = live?.stream ?? null
  const cameraSize = useMemo(() => {
    const settings = stream?.getVideoTracks()[0]?.getSettings()
    return settings?.width && settings.height ? { width: settings.width, height: settings.height } : null
  }, [stream])
  const recording = useSessionRecording(state, recordChoice.record, support, cameraSize)
  const tracking = useTracking({
    video, stream: done ? null : stream,
    draw: (frame, snapshot) => {
      stage.draw(frame, snapshot)
      const recorder = recording.recorder.current
      if (!recorder) return
      const angle = snapshot.quality === 'READY' && snapshot.angleDegrees !== null ? `${snapshot.angleDegrees.toFixed(0)}°` : '—'
      recorder.frame((ctx, width, height) => stage.paint(ctx, frame, snapshot, width, height),
        t('recording.caption', { name, angle, done: snapshot.completed, target: state.rules.targetRepetitions }))
    },
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

  const celebrating = done && state.saves.length > 0 && !celebrated
  // The whole window is the exercise until the results, which are read back in the workspace.
  useExerciseMode(!done || celebrating)
  const screen = useFullscreen()
  const s = state.snapshot
  const started = state.sessionId !== null
  const start = () => { coach.unlock(); void controller.start(consent) }
  const space = useCallback(() => {
    const switching = controller.state.switching
    if (switching) { if (switching.stage === 'paused') controller.startNextSide(); else controller.pauseSwitch(); return }
    const now = controller.state
    if (now.snapshot.running) controller.pause()
    else if (now.sessionId !== null) void controller.start(true)
  }, [controller])
  useModeKeys({ onSpace: done ? undefined : space, onFullscreen: done ? undefined : screen.toggle })
  const exit = () => { if (state.sessionId !== null || state.switching) setLeaving(true); else navigate(`${base}/exercises`) }

  if (celebrating) {
    // Both sides of a set count together; a single side is one entry.
    const completed = state.sides.reduce((sum, side) => sum + side.snapshot.completed, 0)
    const target = state.sides.reduce((sum, side) => sum + side.target, 0)
    const ranges = state.sides.map((side) => romDegrees(side.snapshot)).filter((value): value is number => value !== null)
    return (
      <div className="grid min-h-dvh place-items-center bg-night p-4">
        <FinishCelebration completed={completed} target={target} romDegrees={ranges.length > 0 ? Math.max(...ranges) : null} coach={coach}
          saving={state.saves.some((save) => save.status === 'saving')} allSaved={!state.unsaved} lastOfDay={checkDay} onDone={() => setCelebrated(true)} />
      </div>
    )
  }
  if (done) {
    return (
      <>
        <PageHeader title={name} description={t('session.title')} />
        <SessionResult state={state} base={base} onRetry={() => controller.retry()} recording={recording} />
      </>
    )
  }

  const cameraState = camera.state
  const remaining = sideRemainingMs(state.rules, s)
  const status = s.running ? 'session.statusRecording' : started ? 'session.statusPaused' : 'session.statusPreview'
  const liveAngle = s.quality === 'READY' && tracking.hasFrame ? s.angleDegrees : null
  const cover = cameraState.status === 'idle' || cameraState.status === 'starting' ? (
    <div className="flex max-w-md flex-col items-center gap-4">
      <p className="text-lg text-paper">{t('camera.allowHelp')}</p>
      <Button size="lg" variant="bright" onClick={() => { coach.unlock(); void camera.start() }} busy={cameraState.status === 'starting'}>{t('camera.allow')}</Button>
    </div>
  ) : cameraState.status === 'error' ? (
    <div className="max-w-md text-left">
      {cameraState.error === 'blocked'
        ? <Notice tone="caution" title={t('camera.blocked')} onRetry={() => void camera.start()}>{t('camera.blockedHelp')}</Notice>
        : <Notice tone="caution" onRetry={() => void camera.start()}>{t(`camera.${cameraState.error}`)}</Notice>}
    </div>
  ) : live && tracking.status === 'failed' ? <div className="max-w-lg text-left text-ink"><UsePhoneInstead message={t('camera.trackingFailed')} /></div>
    : live && tracking.status === 'loading' ? (
      <div className="flex max-w-md flex-col gap-2"><p className="text-lg font-semibold text-paper">{t('camera.loading')}</p><p>{t('camera.loadingHelp')}</p></div>
    ) : undefined

  const panel = (
    <>
      {tracking.hiddenPause && <Notice tone="info" title={t('camera.paused')}>{t('camera.hiddenPause')}</Notice>}
      {tracking.slow && <Notice tone="caution">{t('camera.slow')}</Notice>}
      {state.startRefused && !s.running && <p role="alert" className="rounded-2xl bg-[#4a1f1a] px-4 py-3 font-semibold text-[#ffb4a8]">{t('session.startRefused')}</p>}
      {state.consentFailed && <p role="alert" className="rounded-2xl bg-[#4a1f1a] px-4 py-3 font-semibold text-[#ffb4a8]">{t('session.consentFailed')}</p>}
      {state.switching
        ? <SideSwitchCard state={state} onPause={() => { coach.unlock(); controller.pauseSwitch() }} onStart={() => { coach.unlock(); controller.startNextSide() }} />
        : (
          <>
            <BigCount done={s.completed} target={state.rules.targetRepetitions} label={t('camera.reps')} />
            <RepCoach state={state} paused={tracking.hiddenPause} caption={coach.caption} large />
          </>
        )}
      <div className="grid grid-cols-2 gap-3">
        <Reading label={t('camera.angle', { joint: t(`joints.${state.rules.measuredJoint}`) })} value={degrees(liveAngle)} />
        {remaining !== null && <Reading label={t('camera.timeLeft')} value={clock(Math.ceil(remaining / 1000))} />}
      </div>
      {/* A reminder of the movement before starting. Once running, the patient follows their own measured movement instead. */}
      {!s.running && !state.switching && <GuideStage motion={guideMotionFor(state.rules)} name={name} dark className="h-48 shrink-0" />}
      {!s.running && !state.switching && <p className="text-sm text-night-ink">{t(started ? 'session.resumeHelp' : 'session.startHelp')}</p>}
      {coach.voice && !coach.speaks && <p className="text-sm text-night-ink">{t('coach.voiceTextOnly')}</p>}
      {recordChoice.record && support === null && <p className="text-sm text-night-ink">{t('recording.unsupported')}</p>}
      {tracking.diagnostics && tracking.delegate && (
        <p className="mt-auto text-xs text-night-ink tabular-nums">{t('camera.diagnostics', { fps: tracking.diagnostics.fps.toFixed(1), p95: tracking.diagnostics.p95LatencyMs, delegate: t(`camera.delegate${tracking.delegate}`) })}</p>
      )}
    </>
  )

  const bar = (
    <>
      {!started && !state.switching && (
        <label className="flex max-w-[44ch] items-start gap-2.5 text-sm">
          <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-sprout-bright" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
          <span>{t('session.consent')}</span>
        </label>
      )}
      {!state.switching && (s.running
        ? <Button size="lg" variant="bright" leading={<PauseIcon aria-hidden />} onClick={() => controller.pause()} aria-keyshortcuts="Space">{t('session.pause')}</Button>
        : <Button size="lg" variant="bright" leading={<PlayIcon aria-hidden />} onClick={start} busy={state.starting} disabled={!consent && !started} aria-keyshortcuts={started ? 'Space' : undefined}>{t(started ? 'session.resume' : 'session.start')}</Button>)}
      {(started || state.switching) && <Button size="lg" variant="secondary" leading={<FlagCheckeredIcon aria-hidden />} onClick={() => { coach.unlock(); controller.finish() }}>{t('session.finish')}</Button>}
      <div className="flex flex-wrap items-center gap-2 desk:ml-auto">
        {!started && !state.switching && state.sides.length === 0 && support && (
          <ToggleChip on={recordChoice.record} label={t('recording.record')} onChange={(on) => { coach.unlock(); recordChoice.change(on) }} />
        )}
        <ToggleChip on={coach.voice} label={t(coach.voice ? 'coach.voiceOn' : 'coach.voiceOff')} onChange={coach.setVoice} />
        <ToggleChip on={coach.finishSound} label={t(coach.finishSound ? 'coach.finishOn' : 'coach.finishOff')} onChange={coach.setFinishSound} />
        <HowItCounts><Calculations rules={state.rules} snapshot={s} hasFrame={tracking.hasFrame} /></HowItCounts>
        {camera.devices.length > 1 && <button type="button" onClick={camera.switchCamera} className="flex min-h-11 items-center gap-2 rounded-control px-3 text-sm font-semibold text-night-ink hover:bg-night-panel hover:text-paper"><ArrowsClockwiseIcon aria-hidden className="text-lg" />{t('camera.switch')}</button>}
      </div>
      <p className="hidden w-full text-xs text-night-ink desk:block">{t(screen.available ? 'mode.keys' : 'mode.keysNoFullscreen')}</p>
    </>
  )

  return (
    <>
      <ExerciseModeFrame
        title={name}
        status={(
          <>
            <p aria-live="polite" className="flex items-center gap-2 text-sm font-semibold">
              <span aria-hidden className={cn('size-2.5 rounded-full', s.running ? 'animate-pulse bg-[#ff6b5e] motion-reduce:animate-none' : 'bg-night-ink')} />
              {t(status)}
            </p>
            {recording.live && <StatusPill tone="danger">{t('recording.live')}</StatusPill>}
          </>
        )}
        top={<><FullscreenButton screen={screen} /><ExitButton onExit={exit} /></>}
        picture={<CameraPicture rules={state.rules} snapshot={s} hasFrame={tracking.hasFrame} canvas={stage.canvas} video={video} points={tracking.points} paused={tracking.hiddenPause} cover={cover} />}
        panel={panel}
        bar={bar}
      />
      <RecordConsentDialog open={recordChoice.asking} onDecline={recordChoice.decline} onAccept={recordChoice.accept} />
      <ConfirmDialog open={leaving} onOpenChange={setLeaving} title={t('mode.leaveTitle')} message={t('mode.leaveDetail')} confirmLabel={t('mode.leave')} cancelLabel={t('mode.stay')} destructive
        onConfirm={() => navigate(`${base}/exercises`)} />
    </>
  )
}

/** Between two sides: what comes next, the countdown, and one way to hold it (SideSwitchCard on Android). */
function SideSwitchCard({ state, onPause, onStart }: { state: SessionState; onPause: () => void; onStart: () => void }) {
  const { t } = useTranslation()
  const switching = state.switching!
  const side = t(switching.next === 'RIGHT' ? 'camera.right' : 'camera.left')
  return (
    <section className="flex flex-col items-center gap-3 rounded-[24px] bg-night-panel p-5 text-center text-paper">
      <h2 aria-live="polite" className="font-display text-[clamp(1.75rem,3vw,2.5rem)] font-bold">{t('session.nextSide', { side })}</h2>
      {(switching.stage === 'announcing' || switching.stage === 'counting') && (
        <>
          <p aria-hidden className="font-display text-[clamp(5rem,10vw,9rem)] leading-none font-bold text-sprout-bright tabular-nums">{switching.secondsLeft}</p>
          <p aria-live="polite" className="text-lg text-night-ink">{t('session.startingIn', { seconds: switching.secondsLeft })}</p>
          <Button variant="secondary" className="w-full" size="lg" onClick={onPause} aria-keyshortcuts="Space">{t('session.switchPause')}</Button>
        </>
      )}
      {switching.stage === 'paused' && <Button className="w-full" size="lg" variant="bright" leading={<PlayIcon aria-hidden />} onClick={onStart} aria-keyshortcuts="Space">{t('session.switchStart')}</Button>}
      {switching.stage === 'waiting' && <p aria-live="polite" className="text-lg text-night-ink">{t('session.getInView', { side })}</p>}
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

/** Closing screen: the count against the target, range, misses and time, whether it reached the server, and any video beside it. */
function SessionResult({ state, base, onRetry, recording }: { state: SessionState; base: string; onRetry: () => void; recording: ReturnType<typeof useSessionRecording> }) {
  const { t } = useTranslation()
  const last: AssessmentSnapshot = state.sides[state.sides.length - 1]?.snapshot ?? state.snapshot
  const target = state.sides[state.sides.length - 1]?.target ?? state.rules.targetRepetitions
  const saving = state.saves.some((save) => save.status === 'saving')
  const failed = state.saves.some((save) => save.status === 'failed')
  const video = recording.finishing || recording.failed || recording.video
  return (
    <div className={cn('grid items-start gap-5', video && 'desk:grid-cols-2')}>
      <div className="grid gap-4">
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
      {video && (
        <div className="grid gap-4">
          {recording.finishing && <Notice tone="info">{t('recording.finishing')}</Notice>}
          {recording.failed && !recording.video && <Notice tone="caution">{t('recording.failed')}</Notice>}
          {recording.video && <SessionVideoPanel video={recording.video} saved={state.saves.length > 0 && !state.unsaved} />}
        </div>
      )}
    </div>
  )
}
