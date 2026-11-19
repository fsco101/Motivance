import { ArrowsClockwiseIcon, CheckCircleIcon, LockSimpleIcon } from '@phosphor-icons/react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppQrCode, appUrl } from '@/components/AppQrCode'
import { Button, ButtonLink } from '@/components/Button'
import { Notice, PageHeader, Panel } from '@/components/Display'
import '@/locales/exercise'
import { createRules } from './assessment'
import { Calculations, CameraStage, useStageCanvas } from './camera/CameraStage'
import { useCamera } from './camera/useCamera'
import { usePreparedTracking, useTracking } from './camera/useTracking'
import { cameraSupport } from './pose/support'

/** A browser that cannot run the camera is sent to the phone app, as before. */
export function UsePhoneInstead({ message }: { message: string }) {
  const { t } = useTranslation()
  const url = appUrl()
  return (
    <Panel>
      <p className="mb-4 max-w-[60ch]">{message}</p>
      {url ? (
        <div className="flex flex-col items-start gap-5 tablet:flex-row tablet:items-center">
          <AppQrCode url={url} label={t('patient.phoneQr')} />
          <div>
            <p className="mb-3 text-slate">{t('patient.phoneScan')}</p>
            <a href={url} target="_blank" rel="noreferrer" className="font-semibold text-lagoon-deep underline underline-offset-4">{t('patient.phoneGetApp')}</a>
          </div>
        </div>
      ) : <p className="text-slate">{t('patient.phoneOpen')}</p>}
    </Panel>
  )
}

function Checklist() {
  const { t } = useTranslation()
  return (
    <Panel title={t('camera.checklist')}>
      <ol className="flex flex-col gap-3">
        {(['stable', 'visible', 'lighting'] as const).map((item, index) => (
          <li key={item} className="flex items-start gap-3.5">
            <span aria-hidden className="grid size-[30px] shrink-0 place-items-center rounded-full bg-tide font-bold text-lagoon-deep">{index + 1}</span>
            <span className="pt-0.5 text-base">{t(`camera.${item}`)}</span>
          </li>
        ))}
      </ol>
    </Panel>
  )
}

/** A device on a stand, a dashed sightline and a standing person: the setup in one glance. */
function SetupFigure() {
  const { t } = useTranslation()
  return (
    <svg viewBox="0 0 320 180" role="img" aria-label={t('camera.setupFigure')} className="h-auto w-full rounded-[24px] bg-night">
      <line x1="14" y1="160" x2="306" y2="160" stroke="var(--color-night-line)" strokeWidth="2" strokeLinecap="round" />
      {[40, 48, 56].map((x) => <line key={x} x1="48" y1="92" x2={x} y2="160" stroke="var(--color-night-ink)" strokeWidth="2.5" strokeLinecap="round" />)}
      <rect x="38" y="52" width="20" height="40" rx="4" fill="var(--color-night-ink)" />
      <circle cx="48" cy="58" r="2.5" fill="var(--color-night)" />
      {[24, 156].map((y) => <line key={y} x1="60" y1="66" x2="196" y2={y} stroke="var(--color-sprout-bright)" strokeOpacity="0.55" strokeWidth="1.5" strokeDasharray="6 6" />)}
      <g stroke="var(--color-figure-shirt)" strokeWidth="9" strokeLinecap="round" fill="none">
        <circle cx="230" cy="36" r="12" fill="var(--color-figure-skin)" stroke="none" />
        <line x1="230" y1="52" x2="230" y2="104" />
        <line x1="230" y1="60" x2="208" y2="92" stroke="var(--color-figure-skin)" strokeWidth="7" />
        <line x1="230" y1="60" x2="252" y2="92" stroke="var(--color-figure-skin)" strokeWidth="7" />
        <line x1="230" y1="104" x2="218" y2="156" stroke="var(--color-figure-shorts)" strokeWidth="8" />
        <line x1="230" y1="104" x2="242" y2="156" stroke="var(--color-figure-shorts)" strokeWidth="8" />
      </g>
    </svg>
  )
}

function Privacy() {
  const { t } = useTranslation()
  return <p className="flex items-start gap-2.5 text-sm text-slate"><LockSimpleIcon aria-hidden className="mt-0.5 shrink-0" />{t('camera.privacy')}</p>
}

/** The camera check: preview only, with demo rules, so nothing is measured or saved (Android's SETUP, CAMERA and CHECK_COMPLETE). */
export function CameraCheckPage({ base }: { base: string }) {
  const { t } = useTranslation()
  const [step, setStep] = useState<'setup' | 'live' | 'done'>('setup')
  const support = useMemo(() => cameraSupport(), [])
  usePreparedTracking()
  return (
    <>
      <PageHeader title={t('camera.checkTitle')} description={t('camera.checkSubtitle')} />
      {!support.ok ? <UsePhoneInstead message={t('camera.trackingFailed')} />
        : step === 'setup' ? (
          <div className="grid max-w-[640px] gap-4">
            <SetupFigure />
            <Checklist />
            <div><Button size="lg" onClick={() => setStep('live')}>{t('camera.open')}</Button></div>
            <Privacy />
          </div>
        ) : step === 'live' ? <LiveCheck onFinish={() => setStep('done')} />
          : (
            <div className="grid max-w-[640px] gap-4">
              <Panel>
                <div className="flex flex-col items-center gap-3 py-4 text-center">
                  <CheckCircleIcon aria-hidden weight="fill" className="size-16 text-lagoon" />
                  <h2 className="text-xl font-semibold">{t('camera.complete')}</h2>
                  <p className="text-slate">{t('camera.previewOnly')}</p>
                </div>
              </Panel>
              <div className="flex flex-wrap gap-3">
                <Button onClick={() => setStep('setup')}>{t('camera.again')}</Button>
                <ButtonLink to={`${base}/exercises`} variant="secondary">{t('camera.backToExercises')}</ButtonLink>
              </div>
            </div>
          )}
    </>
  )
}

function LiveCheck({ onFinish }: { onFinish: () => void }) {
  const { t } = useTranslation()
  const camera = useCamera()
  const rules = useMemo(() => createRules(), [])
  const live = camera.state.status === 'live' ? camera.state : null
  const video = useRef<HTMLVideoElement | null>(null)
  const stage = useStageCanvas(rules, live?.mirrored ?? true)
  const tracking = useTracking({ video, stream: live?.stream ?? null, rules, draw: stage.draw })
  const state = camera.state
  return (
    <div className="grid max-w-[640px] gap-4">
      {state.status === 'idle' || state.status === 'starting' ? (
        <Panel>
          <p className="mb-4 max-w-[60ch] text-slate">{t('camera.allowHelp')}</p>
          <Button onClick={() => void camera.start()} busy={state.status === 'starting'}>{t('camera.allow')}</Button>
        </Panel>
      ) : state.status === 'error' ? (
        state.error === 'blocked'
          ? <Notice tone="caution" title={t('camera.blocked')} onRetry={() => void camera.start()}>{t('camera.blockedHelp')}</Notice>
          : <Notice tone="caution" onRetry={() => void camera.start()}>{t(`camera.${state.error}`)}</Notice>
      ) : null}
      {live && tracking.status === 'failed' && <UsePhoneInstead message={t('camera.trackingFailed')} />}
      {live && tracking.status !== 'failed' && (
        <>
          {tracking.status === 'loading' && <Notice tone="info" title={t('camera.loading')}>{t('camera.loadingHelp')}</Notice>}
          {tracking.hiddenPause && <Notice tone="info" title={t('camera.paused')}>{t('camera.hiddenPause')}</Notice>}
          {tracking.slow && <Notice tone="caution">{t('camera.slow')}</Notice>}
          <CameraStage rules={rules} snapshot={tracking.snapshot} hasFrame={tracking.hasFrame} canvas={stage.canvas} video={video} points={tracking.points} paused={tracking.hiddenPause}>
            <Calculations rules={rules} snapshot={tracking.snapshot} hasFrame={tracking.hasFrame} />
          </CameraStage>
          {tracking.diagnostics && tracking.delegate && (
            <p className="text-xs text-slate tabular-nums">{t('camera.diagnostics', { fps: tracking.diagnostics.fps.toFixed(1), p95: tracking.diagnostics.p95LatencyMs, delegate: t(`camera.delegate${tracking.delegate}`) })}</p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => { camera.stop(); onFinish() }}>{t('camera.finish')}</Button>
            {camera.devices.length > 1 && <Button variant="secondary" leading={<ArrowsClockwiseIcon aria-hidden />} onClick={camera.switchCamera}>{t('camera.switch')}</Button>}
          </div>
        </>
      )}
      {!live && state.status !== 'error' && <Privacy />}
    </div>
  )
}
