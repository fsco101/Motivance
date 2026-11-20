import { ArrowsInIcon, ArrowsOutIcon, InfoIcon, XIcon } from '@phosphor-icons/react'
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog } from '@/components/Dialog'
import { cn } from '@/lib/cn'
import type { AssessmentSnapshot, ExerciseRules } from '../assessment'
import { focusVisible, showBody } from '../camera/stage'
import type { TrackedFrame } from '../pose'

/**
 * Exercise mode (#149). On a laptop the patient stands two or three metres back so the camera sees their whole body, so while
 * the camera is live the exercise takes the whole window: a large picture beside a readout sized for across the room, and one
 * bar of controls that never scrolls away. The workspace frame steps aside (useExerciseMode). On a phone the parts stack.
 */
export function ExerciseModeFrame({ title, status, top, picture, panel, bar }: {
  title: string; status?: ReactNode; top?: ReactNode; picture: ReactNode; panel: ReactNode; bar: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-dvh flex-col bg-night text-paper desk:h-dvh desk:min-h-0">
      <header className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-night-line px-4 py-2 desk:px-6">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h1 className="truncate font-display text-xl font-bold">{title}</h1>
          {status}
        </div>
        <div className="flex shrink-0 items-center gap-2">{top}</div>
      </header>
      <div className="grid min-h-0 flex-1 gap-4 p-4 desk:grid-cols-[minmax(0,1fr)_minmax(22rem,30rem)] desk:px-6">
        <div className="relative aspect-[4/3] max-h-[62dvh] w-full desk:aspect-auto desk:max-h-none desk:min-h-0">{picture}</div>
        {/* It can scroll on a short screen, so it can take focus and be scrolled from the keyboard. */}
        <aside aria-label={t('mode.panel')} tabIndex={0} className="flex min-h-0 flex-col gap-3 rounded-[24px] outline-none focus-visible:ring-2 focus-visible:ring-sprout-bright desk:overflow-y-auto">{panel}</aside>
      </div>
      {/* Pinned on a wide screen, where nothing may scroll; on a phone it follows the readings, so it never covers them. */}
      <footer className="shrink-0 border-t border-night-line bg-night px-4 py-3 desk:sticky desk:bottom-0 desk:px-6">
        <div className="flex flex-wrap items-center gap-3">{bar}</div>
      </footer>
    </div>
  )
}

/** The camera picture with the skeleton drawn on it, its quality line, and a cover while there is nothing to show. */
export function CameraPicture({ rules, snapshot, hasFrame, canvas, video, points, paused, cover }: {
  rules: ExerciseRules; snapshot: AssessmentSnapshot; hasFrame: boolean; canvas: RefObject<HTMLCanvasElement | null>
  video: RefObject<HTMLVideoElement | null>; points: TrackedFrame['people'][number] | null; paused?: boolean; cover?: ReactNode
}) {
  const { t } = useTranslation()
  const ready = snapshot.quality === 'READY'
  const caution = snapshot.quality === 'TRUNK_LEAN'
  const side = t(rules.side === 'LEFT' ? 'camera.left' : 'camera.right')
  const focus = t('camera.focus', { side, joint: t(`joints.${rules.focusJoint}`) })
  const body = showBody(snapshot.quality, hasFrame)
  return (
    <div className="absolute inset-0 overflow-hidden rounded-[24px] border border-night-line bg-[#041a1f]">
      <video ref={video} muted playsInline aria-hidden className="pointer-events-none absolute size-px opacity-0" />
      <canvas ref={canvas} role="img" aria-label={t('camera.description', { focus })} className="absolute inset-0 size-full" />
      {(cover || !hasFrame || paused) && (
        <div className="absolute inset-0 grid place-items-center bg-night/85 p-6 text-center text-night-ink">
          {cover ?? <p className="max-w-[32ch] text-lg">{t(paused ? 'camera.paused' : 'camera.position')}</p>}
        </div>
      )}
      <div className="absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2">
        <p className="rounded-full bg-night/80 px-3 py-1.5 text-sm font-semibold">{focus}</p>
        {body && points && !focusVisible(points, rules) && <p className="rounded-full bg-[#4a3410e6] px-3 py-1.5 text-sm font-semibold text-night-caution">{t('camera.focusNotVisible')}</p>}
      </div>
      <p aria-live="polite" className={cn('absolute bottom-3 left-1/2 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2 text-base font-semibold',
        caution ? 'bg-[#4a3410e6] text-night-caution' : ready ? 'bg-[#103c2ae6] text-paper' : 'bg-[#132f38e6] text-paper')}>
        <span aria-hidden className={cn('size-2.5 shrink-0 rounded-full', caution ? 'bg-night-caution' : ready ? 'bg-sprout-bright' : 'bg-night-ink')} />
        {t(`quality.${snapshot.quality}`)}
      </p>
    </div>
  )
}

/** The repetition count, sized to read from across the room. */
export function BigCount({ done, target, label }: { done: number; target: number; label: string }) {
  return (
    <div className="rounded-[24px] bg-night-panel px-5 py-4">
      <p className="text-base font-semibold text-night-ink">{label}</p>
      <p aria-live="polite" className="font-display text-[clamp(4.5rem,9vw,9rem)] leading-none font-bold tabular-nums">
        <span className={done > 0 ? 'text-sprout-bright' : undefined}>{done}</span>
        <span className="text-night-ink"> / {target}</span>
      </p>
    </div>
  )
}

/** A reading beside the count: the angle, or the time left on a side. */
export function Reading({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-night-panel px-4 py-3">
      <p className="text-sm font-medium text-night-ink">{label}</p>
      <p className="font-display text-3xl font-semibold tabular-nums">{value}</p>
    </div>
  )
}

/** An on or off choice in the bar, small enough to sit with the controls. */
export function ToggleChip({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)}
      className={cn('flex min-h-11 items-center gap-2 rounded-full border px-3.5 text-sm font-semibold transition-colors transition-quick disabled:opacity-50',
        on ? 'border-sprout-bright bg-sprout-bright/15 text-paper' : 'border-night-line text-night-ink hover:text-paper')}>
      <span aria-hidden className={cn('relative h-5 w-8 rounded-full transition-colors motion-reduce:transition-none', on ? 'bg-sprout-bright' : 'bg-night-line')}>
        <span className={cn('absolute top-0.5 size-4 rounded-full bg-paper transition-[left] motion-reduce:transition-none', on ? 'left-3.5' : 'left-0.5')} />
      </span>
      {label}
    </button>
  )
}

const subscribeFullscreen = (changed: () => void) => { document.addEventListener('fullscreenchange', changed); return () => document.removeEventListener('fullscreenchange', changed) }
const canFullscreen = () => typeof document !== 'undefined' && Boolean(document.fullscreenEnabled)

/** Full screen and back. Hidden in a browser that cannot do it, such as Safari on an iPhone. */
export function useFullscreen() {
  const on = useSyncExternalStore(subscribeFullscreen, () => document.fullscreenElement !== null, () => false)
  const toggle = useCallback(() => {
    if (!canFullscreen()) return
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    else void document.documentElement.requestFullscreen().catch(() => undefined)
  }, [])
  // Leaving exercise mode leaves full screen too.
  useEffect(() => () => { if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined) }, [])
  return { on, toggle, available: canFullscreen() }
}

export function FullscreenButton({ screen }: { screen: ReturnType<typeof useFullscreen> }) {
  const { t } = useTranslation()
  if (!screen.available) return null
  return (
    <button type="button" onClick={screen.toggle} aria-keyshortcuts="F" aria-pressed={screen.on}
      className="flex min-h-11 items-center gap-2 rounded-control px-3 text-sm font-semibold text-night-ink transition-colors hover:bg-night-panel hover:text-paper">
      {screen.on ? <ArrowsInIcon aria-hidden className="text-lg" /> : <ArrowsOutIcon aria-hidden className="text-lg" />}
      {t(screen.on ? 'mode.exitFullscreen' : 'mode.fullscreen')}
      <kbd aria-hidden className="rounded border border-night-line px-1.5 text-xs">F</kbd>
    </button>
  )
}

export function ExitButton({ onExit, label }: { onExit: () => void; label?: string }) {
  const { t } = useTranslation()
  return (
    <button type="button" onClick={onExit}
      className="flex min-h-11 items-center gap-2 rounded-control border border-night-line px-3 text-sm font-semibold transition-colors hover:bg-night-panel">
      <XIcon aria-hidden className="text-lg" />{label ?? t('mode.exit')}
    </button>
  )
}

/**
 * Keys for someone who walks up to the laptop: Space pauses or resumes, F toggles full screen. A key pressed in a field or on
 * a button does what that control does instead.
 */
export function useModeKeys({ onSpace, onFullscreen }: { onSpace?: () => void; onFullscreen?: () => void }) {
  useEffect(() => {
    const press = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, button, a, [role="switch"], [role="dialog"], [role="alertdialog"], [contenteditable="true"]')) return
      if (event.key === ' ' && onSpace) { event.preventDefault(); onSpace() }
      else if ((event.key === 'f' || event.key === 'F') && onFullscreen) { event.preventDefault(); onFullscreen() }
    }
    window.addEventListener('keydown', press)
    return () => window.removeEventListener('keydown', press)
  }, [onSpace, onFullscreen])
}

/** "How repetitions are counted": the full calculation, opened on demand so it never pushes the controls away. */
export function HowItCounts({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="flex min-h-11 items-center gap-2 rounded-control px-3 text-sm font-semibold text-night-ink transition-colors hover:bg-night-panel hover:text-paper">
        <InfoIcon aria-hidden className="text-lg" />{t('calc.title')}
      </button>
      <Dialog open={open} onOpenChange={setOpen} title={t('calc.title')} wide>
        <div className="flex flex-col gap-3 rounded-[20px] bg-night p-4 text-paper">{children}</div>
      </Dialog>
    </>
  )
}
