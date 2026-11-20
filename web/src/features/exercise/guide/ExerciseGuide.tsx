import { PauseIcon, PlayIcon } from '@phosphor-icons/react'
import { useAnimationFrame } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStill } from '@/motion/useStill'
import { guideShapes, ON_DARK, ON_LIGHT, type GuideShape } from './draw'
import { motionAngleAt, type GuideMotion } from './rig'

/** One full repetition, slow enough to follow (REPETITION_MS on Android). */
const REPETITION_MS = 4200
/** Where a still guide rests: the target, so the patient sees where to go. */
const STILL_AT = 0.5

function useSize() {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 240, height: 240 })
  useEffect(() => {
    const element = box.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect
      if (width > 0 && height > 0) setSize({ width: Math.round(width), height: Math.round(height) })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return { box, ...size }
}

function Shape({ shape }: { shape: GuideShape }) {
  if (shape.kind === 'ellipse') return <ellipse cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} style={{ fill: shape.fill }} />
  return (
    <path d={shape.d} style={{ fill: shape.fill ?? 'none', stroke: shape.stroke ?? 'none' }} strokeWidth={shape.width}
      strokeDasharray={shape.dash} strokeLinecap={shape.cap} strokeLinejoin="round" />
  )
}

/**
 * The model person demonstrating one exercise on repeat, through its prescribed range (ExerciseGuide on Android). The pause
 * button stops it, because moving content must be possible to stop. When the patient prefers reduced motion it holds the
 * target position and has no button.
 */
export function ExerciseGuide({ motion, name, dark = false, className = '' }: { motion: GuideMotion; name: string; dark?: boolean; className?: string }) {
  const { t } = useTranslation()
  const reduced = useStill()
  const [playing, setPlaying] = useState(true)
  const [time, setTime] = useState(STILL_AT)
  const origin = useRef<number | null>(null)
  const moving = playing && !reduced
  const { box, width, height } = useSize()
  useAnimationFrame((now) => {
    if (!moving) { origin.current = null; return }
    // Resuming carries on from where it was held.
    origin.current ??= now - time * REPETITION_MS
    setTime(((now - origin.current) / REPETITION_MS) % 1)
  })
  const shown = reduced ? STILL_AT : time
  const shapes = useMemo(() => guideShapes(motion, motionAngleAt(motion, shown), dark ? ON_DARK : ON_LIGHT, width, height, true), [motion, shown, dark, width, height])
  const description = t('guide.description', { name, low: Math.trunc(motion.low), high: Math.trunc(motion.high) })
  return (
    <div ref={box} className={`relative ${className}`}>
      <svg role="img" aria-label={description} viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 size-full">
        {shapes.map((shape, index) => <Shape key={index} shape={shape} />)}
      </svg>
      {!reduced && (
        <button type="button" onClick={() => setPlaying((on) => !on)} aria-label={t(playing ? 'guide.pause' : 'guide.play')}
          className={`absolute right-2 bottom-2 grid size-11 place-items-center rounded-full ${dark ? 'bg-night-panel/85 text-paper' : 'bg-paper/85 text-ink'}`}>
          {playing ? <PauseIcon aria-hidden weight="fill" className="size-4" /> : <PlayIcon aria-hidden weight="fill" className="size-4" />}
        </button>
      )}
    </div>
  )
}

/** The guide on its own stage, for a card or a page (GuideStage on Android). */
export function GuideStage({ motion, name, dark = false, className = 'h-56' }: { motion: GuideMotion; name: string; dark?: boolean; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-[16px] ${dark ? 'bg-night-panel' : 'bg-tide'} ${className}`}>
      <ExerciseGuide motion={motion} name={name} dark={dark} className="size-full" />
    </div>
  )
}
