import { m as motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Avatar } from '@/components/Display'
import { cn } from '@/lib/cn'
import { arcPath, polar, protractorAngle } from '@/motion/geometry'
import { duration, ease } from '@/motion/tokens'

export type FanSession = { id: string; patientId: string; patient: string; photo?: string | null; exercise: string; low: number; high: number; reached: readonly [number, number] }

const W = 640
const CX = W / 2
const CY = 332
const OUTER = 300
const STEP = 36
const STROKE = 20

/**
 * The latest sessions on one protractor: each ring is a patient, the pale band is what was prescribed and the bright arc
 * is how far they moved. It shows only measured values, and it is not a score.
 */
export function SessionFan({ sessions, base }: { sessions: readonly FanSession[]; base: string }) {
  const { t } = useTranslation()
  const reduced = useReducedMotion()
  const [activeId, setActiveId] = useState(sessions[0]?.id)
  const active = sessions.find((session) => session.id === activeId) ?? sessions[0]
  if (!active) return null
  return (
    <section aria-label={t('home.latestMovement')} className="on-dark grid gap-6 rounded-stage bg-ink p-6 text-paper tablet:p-8 desk:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="min-w-0">
        <h2 className="text-2xl font-bold">{t('home.latestMovement')}</h2>
        <p className="mb-4 text-night-ink">{t('home.latestMovementDetail')}</p>
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${CY + 14}`} aria-hidden className="w-full overflow-visible">
            {[0, 45, 90, 135, 180].map((degrees) => {
              const a = polar(CX, CY, OUTER + 14, protractorAngle(degrees))
              const b = polar(CX, CY, OUTER + 22, protractorAngle(degrees))
              return <line key={degrees} x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={2} className="stroke-night-line" />
            })}
            {sessions.map((session, index) => {
              const r = OUTER - index * STEP
              const on = session.id === active.id
              return (
                <g key={session.id} opacity={on ? 1 : 0.42} className="transition-opacity transition-quick">
                  <path d={arcPath(CX, CY, r, 180, 360)} fill="none" strokeWidth={STROKE} strokeLinecap="round" className="stroke-night-panel" />
                  <path d={arcPath(CX, CY, r, protractorAngle(session.low), protractorAngle(session.high))} fill="none" strokeWidth={STROKE} className="stroke-night-ink" opacity={0.3} />
                  <motion.path d={arcPath(CX, CY, r, protractorAngle(session.reached[0]), protractorAngle(session.reached[1]))} fill="none" strokeWidth={STROKE * 0.5} strokeLinecap="round" className="stroke-sprout-bright"
                    initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: duration.sweep, ease: ease.out, delay: 0.15 + index * 0.07 }} />
                </g>
              )
            })}
          </svg>
          <div className="absolute inset-x-0 bottom-0 text-center">
            <p className="numeric text-5xl font-bold">{active.reached[1]}°</p>
            <p className="text-sm text-night-ink">{t('home.targetBand', { low: active.low, high: active.high })}</p>
          </div>
        </div>
      </div>
      <ul className="flex flex-col justify-center gap-1">
        {sessions.map((session) => {
          const on = session.id === active.id
          return (
            <li key={session.id}>
              <Link to={`${base}/patients/${session.patientId}`} onPointerEnter={() => setActiveId(session.id)} onFocus={() => setActiveId(session.id)}
                className={cn('flex min-h-14 items-center gap-3 rounded-control px-2.5 transition-colors transition-quick', on ? 'bg-night-panel' : 'hover:bg-night-panel/60')}>
                <Avatar name={session.patient} photo={session.photo} size={36} />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{session.patient}</span>
                  <span className="block truncate text-sm text-night-ink">{session.exercise}</span>
                  <span className="sr-only">{t('patients.dial', { low: session.reached[0], high: session.reached[1], targetLow: session.low, targetHigh: session.high })}</span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
