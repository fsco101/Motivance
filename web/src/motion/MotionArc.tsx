import { m as motion } from 'motion/react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { FACE_START, FACE_SWEEP, arcPath, faceAngle, polar } from './geometry'
import { duration, ease } from './tokens'

type Props = {
  /** 0 to 1 of the face. */
  progress: number
  /** Marks a 0-180 degree joint range on the same face. */
  band?: readonly [number, number]
  size?: number
  stroke?: number
  dark?: boolean
  label?: string
  className?: string
  children?: ReactNode
}

/** The Motivance signature: an open 240-degree goniometer face, ported from Android. */
export function MotionArc({ progress, band, size = 196, stroke = 14, dark, label, className, children }: Props) {
  const c = size / 2
  const r = c - stroke / 2 - 1
  const face = arcPath(c, c, r, FACE_START, FACE_START + FACE_SWEEP)
  const share = Math.min(1, Math.max(0, progress))
  return (
    <div className={cn('relative grid shrink-0 place-items-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
        <path d={face} fill="none" strokeWidth={stroke} strokeLinecap="round" className={dark ? 'stroke-night-line' : 'stroke-tide'} />
        {band && (
          <path d={arcPath(c, c, r, faceAngle(band[0]), faceAngle(band[1]))} fill="none" strokeWidth={stroke} strokeLinecap="butt"
            className={dark ? 'stroke-night-ink' : 'stroke-sprout'} opacity={dark ? 0.4 : 0.28} />
        )}
        {[0, 0.25, 0.5, 0.75, 1].map((step) => {
          const angle = FACE_START + FACE_SWEEP * step
          const inner = polar(c, c, r - stroke * 1.15, angle)
          const outer = polar(c, c, r - stroke * 0.8, angle)
          return <line key={step} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} strokeWidth={2} strokeLinecap="round" className={dark ? 'stroke-night-line' : 'stroke-tide'} />
        })}
        {share > 0 && (
          <motion.path d={face} fill="none" strokeWidth={stroke} strokeLinecap="round" className={dark ? 'stroke-sprout-bright' : 'stroke-lagoon'}
            initial={{ pathLength: 0 }} animate={{ pathLength: share }} transition={{ duration: duration.sweep, ease: ease.inOut }} />
        )}
      </svg>
      {children && <div className="absolute inset-0 grid place-items-center">{children}</div>}
    </div>
  )
}
