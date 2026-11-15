import { ShareNetworkIcon } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { Notice, Panel } from '@/components/Display'
import { ACTIVITY_DAYS, type ActivitySummary } from '@/data/history'
import { useFormat } from '@/features/shared'
import { cn } from '@/lib/cn'

/** A therapist is told once a patient has gone this long without finishing a session. */
const QUIET_DAYS = 7

function Stat({ value, label, detail }: { value: string | number; label: string; detail?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-slate">{label}</dt>
      <dd>
        <span className="numeric block text-3xl font-bold leading-tight">{value}</span>
        {detail && <span className="block text-sm text-slate">{detail}</span>}
      </dd>
    </div>
  )
}

const HEIGHTS = ['h-1.5 bg-line-strong', 'h-5 bg-lagoon', 'h-8 bg-lagoon', 'h-11 bg-lagoon']

/**
 * One bar a day, oldest first, in four weeks of seven. Height carries the count, so it reads without colour, and the
 * sentence beside it says the same thing for anyone who cannot see the bars.
 */
function DayStrip({ summary }: { summary: ActivitySummary }) {
  const { t } = useTranslation()
  const format = useFormat()
  const weeks = [0, 1, 2, 3].map((week) => summary.days.slice(week * 7, week * 7 + 7))
  return (
    <figure className="min-w-0">
      <div role="img" aria-label={t('progress.activity.stripLabel', { active: summary.activeDays, days: ACTIVITY_DAYS })} className="flex h-11 items-end gap-2.5">
        {weeks.map((week, index) => (
          <div key={index} className="grid flex-1 grid-cols-7 items-end gap-1">
            {week.map((day) => (
              <span key={day.date} title={t('progress.activity.dayTitle', { date: format.short(`${day.date}T00:00:00`), count: day.sessions })}
                className={cn('rounded-sm', HEIGHTS[Math.min(day.sessions, HEIGHTS.length - 1)])} />
            ))}
          </div>
        ))}
      </div>
      <figcaption className="mt-1.5 flex justify-between text-xs text-slate">
        <span>{format.short(`${summary.days[0]!.date}T00:00:00`)}</span>
        <span>{t('progress.activity.today')}</span>
      </figcaption>
    </figure>
  )
}

/**
 * How regularly someone has exercised lately. A patient reads it as encouragement, so it leads with their streak.
 * A therapist reads it to decide who needs a call, so it leads with how long ago the last session was.
 */
export function ActivityPanel({ summary, self, sample, stacked, onShare }: { summary: ActivitySummary; self?: boolean; sample?: boolean; stacked?: boolean; onShare?: () => void }) {
  const { t } = useTranslation()
  const format = useFormat()
  const difference = summary.week - summary.previousWeek
  const compared = difference === 0 ? t('progress.activity.weekSame') : t(difference > 0 ? 'progress.activity.weekMore' : 'progress.activity.weekFewer', { count: Math.abs(difference) })
  const since = summary.daysSinceLast
  const last = since === null ? t('progress.activity.none') : since === 0 ? t('progress.activity.today') : since === 1 ? t('progress.activity.yesterday') : t('progress.activity.daysAgo', { count: since })
  const quiet = !self && (since === null || since >= QUIET_DAYS)
  return (
    <Panel title={t(self ? 'progress.activity.titleSelf' : 'progress.activity.title')} description={t(sample ? 'progress.activity.sample' : 'progress.activity.description')}
      action={onShare && <Button size="sm" variant="secondary" leading={<ShareNetworkIcon aria-hidden />} onClick={onShare}>{t('chat.cards.share')}</Button>}>
      <div className={cn('grid items-end gap-x-10 gap-y-5', !stacked && 'desk:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]')}>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 tablet:grid-cols-3">
          <Stat value={summary.week} label={t('progress.activity.week')} detail={compared} />
          <Stat value={summary.activeDays} label={t('progress.activity.activeDays')} detail={t('progress.activity.activeDaysDetail', { days: ACTIVITY_DAYS })} />
          {self
            ? <Stat value={summary.streak} label={t('progress.activity.streak')} detail={summary.lastAt ? t('progress.activity.lastOn', { when: last }) : t('progress.activity.streakStart')} />
            : <Stat value={last} label={t('progress.activity.last')} detail={summary.lastAt ? format.dateTime(summary.lastAt) : undefined} />}
        </dl>
        <DayStrip summary={summary} />
      </div>
      {quiet && <Notice tone="caution" className="mt-4">{since === null ? t('progress.activity.quietNone') : t('progress.activity.quiet', { count: since })}</Notice>}
    </Panel>
  )
}
