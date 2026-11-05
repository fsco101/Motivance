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
    <section aria-label={t('home.latestMovement')} className="on-dark grid items-center gap-6 rounded-card bg-ink p-5 text-paper desk:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] desk:gap-10">
      <div className="min-w-0">
        <h2 className="text-base font-bold">{t('home.latestMovement')}</h2>
        <p className="mb-3 text-sm text-night-ink">{t('home.latestMovementDetail')}</p>
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
            <p className="numeric text-stat font-bold">{active.reached[1]}°</p>
            <p className="text-xs text-night-ink">{t('home.targetBand', { low: active.low, high: active.high })}</p>
          </div>
        </div>
      </div>
      <ul className="grid content-center gap-1 tablet:grid-cols-2">
        {sessions.map((session) => {
          const on = session.id === active.id
          return (
            <li key={session.id}>
              <Link to={`${base}/patients/${session.patientId}`} onPointerEnter={() => setActiveId(session.id)} onFocus={() => setActiveId(session.id)}
                className={cn('flex min-h-14 items-center gap-3 rounded-control px-2.5 text-sm transition-colors transition-quick', on ? 'bg-night-panel' : 'hover:bg-night-panel/60')}>
                <Avatar name={session.patient} photo={session.photo} size={32} />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{session.patient}</span>
                  <span className="block truncate text-night-ink">{session.exercise}</span>
                  <span className="block truncate text-xs text-night-ink">{t('patients.reached', { low: session.reached[0], high: session.reached[1] })}</span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
