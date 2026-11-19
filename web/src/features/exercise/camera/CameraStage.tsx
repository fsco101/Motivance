import { useCallback, useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { romDegrees, repetitionGuide, type AssessmentSnapshot, type ExerciseRules, type RepStep } from '../assessment'
import type { TrackedFrame } from '../pose'
import { drawStage, durationParts, focusVisible, showBody } from './stage'

const degrees = (value: number | null) => (value !== null && Number.isFinite(value) ? `${value.toFixed(1)}°` : '—')

export function useDuration() {
  const { t } = useTranslation()
  return (ms: number) => { const d = durationParts(ms); return d.one ? t('calc.oneSecond') : t('calc.seconds', { seconds: d.seconds }) }
}

/**
 * The canvas the picture and skeleton are drawn on. It follows its box and the screen's pixel ratio, and the frame is
 * drawn as soon as it is tracked, never from stale React state.
 */
export function useStageCanvas(rules: ExerciseRules, mirrored: boolean) {
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const size = useRef({ width: 0, height: 0 })
  const font = useRef('system-ui, sans-serif')
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    font.current = getComputedStyle(element).fontFamily || font.current
    const resize = () => {
      const box = element.getBoundingClientRect()
      const ratio = window.devicePixelRatio || 1
      size.current = { width: box.width, height: box.height }
      element.width = Math.max(1, Math.round(box.width * ratio))
      element.height = Math.max(1, Math.round(box.height * ratio))
      element.getContext('2d')?.setTransform(ratio, 0, 0, ratio, 0, 0)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const draw = useCallback((frame: TrackedFrame | null, snapshot: AssessmentSnapshot) => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx || size.current.width === 0) return
    drawStage(ctx, {
      frame: frame && { image: frame.image as unknown as CanvasImageSource, width: frame.width, height: frame.height, people: frame.people },
      rules, snapshot, mirrored, width: size.current.width, height: size.current.height, font: font.current,
    })
  }, [rules, mirrored])
  return { canvas, draw }
}

interface StageProps {
  rules: ExerciseRules
  snapshot: AssessmentSnapshot
  hasFrame: boolean
  canvas: RefObject<HTMLCanvasElement | null>
  video: RefObject<HTMLVideoElement | null>
  /** Points of the newest frame, to say when the focus part is out of view. */
  points: TrackedFrame['people'][number] | null
  /** Shown under the header, so it stays in view while the patient watches themselves. */
  coach?: ReactNode
  /** Measuring stopped because the tab was hidden. */
  paused?: boolean
  children?: ReactNode
}

/** The dark camera panel from Android (SkeletonPreview.kt): header, picture with skeleton, quality chip and live readings. */
export function CameraStage({ rules, snapshot, hasFrame, canvas, video, points, coach, paused, children }: StageProps) {
  const { t } = useTranslation()
  const ready = snapshot.quality === 'READY'
  const caution = snapshot.quality === 'TRUNK_LEAN'
  const side = t(rules.side === 'LEFT' ? 'camera.left' : 'camera.right')
  const focus = t('camera.focus', { side, joint: t(`joints.${rules.focusJoint}`) })
  const measured = t(`joints.${rules.measuredJoint}`)
  const liveAngle = ready && hasFrame ? snapshot.angleDegrees : null
  const body = showBody(snapshot.quality, hasFrame)
  return (
    <section className="overflow-hidden rounded-[24px] border border-night-line bg-night text-paper">
      <div className="flex flex-col gap-1.5 p-4">
        <p className="flex items-center gap-2 text-sm font-medium text-night-ink">
          <span aria-hidden className={`size-2 rounded-full ${hasFrame ? 'animate-pulse bg-sprout-bright motion-reduce:animate-none' : 'bg-night-ink'}`} />
          {t(hasFrame ? 'camera.live' : 'camera.waiting')}
        </p>
        <h2 className="text-lg font-semibold text-paper">{focus}</h2>
        {rules.focusJoint !== rules.measuredJoint && <p className="text-sm text-night-ink">{t('camera.focusMeasurement', { joint: measured })}</p>}
        {body && points && !focusVisible(points, rules) && <p className="text-sm text-night-caution">{t('camera.focusNotVisible')}</p>}
        {coach}
      </div>
      <div className="relative mx-auto aspect-[4/5] max-h-[440px] w-full">
        <video ref={video} muted playsInline aria-hidden className="pointer-events-none absolute size-px opacity-0" />
        <canvas ref={canvas} role="img" aria-label={t('camera.description', { focus })} className="absolute inset-0 size-full" />
        {(!hasFrame || paused) && (
          <div className="absolute inset-0 grid place-items-center bg-night/80 p-8 text-center text-night-ink">
            <p className="max-w-[32ch]">{t(paused ? 'camera.paused' : 'camera.position')}</p>
          </div>
        )}
        <p aria-live="polite" className={`absolute bottom-3 left-1/2 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold ${caution ? 'bg-[#4a3410e6] text-night-caution' : ready ? 'bg-[#103c2ae6] text-paper' : 'bg-[#132f38e6] text-paper'}`}>
          <span aria-hidden className={`size-2 shrink-0 rounded-full ${caution ? 'bg-night-caution' : ready ? 'bg-sprout-bright' : 'bg-night-ink'}`} />
          {t(`quality.${snapshot.quality}`)}
        </p>
      </div>
      <div className="flex flex-col gap-3 p-4">
        <div className="grid grid-cols-2 gap-3">
          <MetricTile label={t('camera.angle', { joint: measured })} value={degrees(liveAngle)} />
          <MetricTile label={t('camera.reps')} value={`${snapshot.completed} / ${rules.targetRepetitions}`} accent={snapshot.completed > 0} live />
        </div>
        {children}
      </div>
    </section>
  )
}

export function MetricTile({ label, value, accent, live }: { label: string; value: string; accent?: boolean; live?: boolean }) {
  return (
    <div className="rounded-2xl bg-night-panel p-3.5">
      <p className="text-sm font-medium text-night-ink">{label}</p>
      <p aria-live={live ? 'polite' : undefined} className={`text-[1.75rem] leading-tight font-semibold tabular-nums ${accent ? 'text-sprout-bright' : 'text-paper'}`}>{value}</p>
    </div>
  )
}

/** The live calculation behind the count: gauge, rule steps, session range and legends (CalculationContent on Android). */
export function Calculations({ rules, snapshot, hasFrame }: { rules: ExerciseRules; snapshot: AssessmentSnapshot; hasFrame: boolean }) {
  const { t } = useTranslation()
  const duration = useDuration()
  const angle = snapshot.quality === 'READY' && hasFrame ? snapshot.angleDegrees : null
  const guide = repetitionGuide(rules, hasFrame ? snapshot : { ...snapshot, angleDegrees: null })
  const joint = t(`joints.${rules.measuredJoint}`)
  return (
    <>
      <AngleGauge rules={rules} snapshot={snapshot} angle={angle} step={guide.step} progress={guide.targetProgress} joint={joint} />
      <RepetitionSteps rules={rules} step={guide.step} hold={guide.holdProgress} />
      <div className="grid grid-cols-2 gap-3">
        <MetricTile label={t('calc.sessionRom')} value={degrees(romDegrees(snapshot))} />
        <MetricTile label={t('calc.notCounted')} value={String(snapshot.incomplete)} />
      </div>
      <p className="text-sm text-paper">{t('calc.rule', { joint, low: Math.trunc(rules.lowDegrees), high: Math.trunc(rules.highDegrees), hold: duration(rules.peakHoldMs), shortest: duration(rules.minimumCycleMs), longest: duration(rules.maximumCycleMs) })}</p>
      <p className={`text-xs font-medium ${rules.demo ? 'text-night-caution' : 'text-sprout-bright'}`}>{rules.demo ? t('calc.sourceDemo') : t('calc.sourcePrescribed', { version: rules.version })}</p>
      <p className="text-xs text-night-ink">{t('camera.legend')}</p>
      <p className="text-xs text-night-ink">{t('calc.legend')}</p>
    </>
  )
}

function AngleGauge({ rules, snapshot, angle, step, progress, joint }: { rules: ExerciseRules; snapshot: AssessmentSnapshot; angle: number | null; step: RepStep | null; progress: number | null; joint: string }) {
  const { t } = useTranslation()
  const x = (d: number) => `${(Math.min(Math.max(d, 0), 180) / 180) * 100}%`
  const range = snapshot.minimumDegrees !== null && snapshot.maximumDegrees !== null ? [snapshot.minimumDegrees, snapshot.maximumDegrees] as const : null
  // Progress toward the target only means something while the patient is raising or holding.
  const percent = progress !== null && (step === 'REACH' || step === 'HOLD') ? Math.trunc(progress * 100) : null
  const needle = angle === null ? null : angle >= rules.highDegrees ? 'bg-sprout-bright' : angle <= rules.lowDegrees ? 'bg-night-ink' : 'bg-paper'
  const description = t('calc.gaugeDescription', { joint, current: degrees(angle), low: Math.trunc(rules.lowDegrees), high: Math.trunc(rules.highDegrees), range: range ? `${degrees(range[0])} – ${degrees(range[1])}` : '—' })
  return (
    <div role="img" aria-label={description} className="flex flex-col gap-1.5 rounded-xl bg-night-panel p-3">
      <div className="flex justify-between text-sm font-medium">
        <span className="text-night-ink">{t('calc.gaugeTitle')}</span>
        <span className="font-semibold text-paper">{percent !== null ? t('calc.progress', { percent }) : '—'}</span>
      </div>
      <div aria-hidden className="relative h-7">
        <div className="absolute inset-x-0 top-[30%] h-[40%] rounded-full bg-[#041a1f]" />
        <div className="absolute top-[30%] left-0 h-[40%] rounded-full bg-night-ink/35" style={{ width: x(rules.lowDegrees) }} />
        <div className="absolute top-[30%] right-0 h-[40%] rounded-full bg-sprout-bright/45" style={{ left: x(rules.highDegrees) }} />
        {range && <div className="absolute top-[calc(30%-4px)] h-0.5 rounded-full bg-paper/75" style={{ left: x(range[0]), right: `calc(100% - ${x(range[1])})` }} />}
        {[rules.lowDegrees, rules.highDegrees].map((d) => <div key={d} className="absolute top-[30%] h-[40%] w-[1.5px] bg-paper" style={{ left: x(d) }} />)}
        {angle !== null && <div className={`absolute inset-y-0 w-[3px] -translate-x-1/2 rounded-full ring-2 ring-night ${needle}`} style={{ left: x(angle) }} />}
      </div>
      <div className="flex justify-between text-xs">
        <span className="text-night-ink">{t('calc.startZone', { degrees: Math.trunc(rules.lowDegrees) })}</span>
        <span className="text-right text-sprout-bright">{t('calc.targetZone', { degrees: Math.trunc(rules.highDegrees) })}</span>
      </div>
    </div>
  )
}

/** The engine's four-step rule with the active step highlighted, in two rows so large text stays readable. */
function RepetitionSteps({ rules, step, hold }: { rules: ExerciseRules; step: RepStep | null; hold: number }) {
  const { t } = useTranslation()
  const duration = useDuration()
  const steps: [RepStep, string][] = [
    ['START', `≤ ${Math.trunc(rules.lowDegrees)}°`], ['REACH', `≥ ${Math.trunc(rules.highDegrees)}°`],
    ['HOLD', duration(rules.peakHoldMs)], ['RETURN', `≤ ${Math.trunc(rules.lowDegrees)}°`],
  ]
  const announced = step ? t(`calc.step${step}`) : ''
  return (
    <div className="grid grid-cols-2 gap-2">
      <span className="sr-only" aria-live="polite">{announced}</span>
      {steps.map(([name, condition], index) => {
        const active = step === name
        return (
          <div key={name} className={`rounded-[10px] px-2.5 py-2 ${active ? 'bg-sprout-bright text-night' : 'bg-night-panel'}`}>
            <p className={`text-sm font-semibold ${active ? 'text-night' : 'text-night-ink'}`}>{index + 1}. {t(`calc.step${name}`)}</p>
            <p className={`font-bold ${active ? 'text-night' : 'text-paper'}`}>{condition}</p>
            {name === 'HOLD' && rules.peakHoldMs > 0 && (active || step === 'RETURN') && (
              <div aria-hidden className={`mt-1 h-1 overflow-hidden rounded-full ${active ? 'bg-night/25' : 'bg-night-ink/25'}`}>
                <div className={`h-full ${active ? 'bg-night' : 'bg-sprout-bright'}`} style={{ width: `${hold * 100}%` }} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
