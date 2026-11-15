import { ChartLineUpIcon, PersonSimpleTaiChiIcon } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { exerciseOf, progressOf, systemLineOf, type ChatMessage } from '@/data/chat'
import { useFormat } from '@/features/shared'
import { cn } from '@/lib/cn'

/** Where a card opens, for this reader: the same page the card came from, which both people in the conversation can open. */
export type CardLinks = { progress: string; exercises: string }

const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(Math.round(value * 10) / 10)}°`

function Shell({ icon: Icon, title, mine, children, to, open }: { icon: typeof ChartLineUpIcon; title: string; mine: boolean; children: React.ReactNode; to: string; open: string }) {
  return (
    <div className={cn('w-72 max-w-full overflow-clip rounded-card border bg-paper text-ink', mine ? 'border-lagoon-deep' : 'border-line-strong')}>
      <p className="flex items-center gap-2 border-b border-line px-3.5 py-2 text-sm font-semibold"><Icon aria-hidden className="text-lg text-lagoon-deep" />{title}</p>
      <div className="px-3.5 py-2.5">{children}</div>
      <Link to={to} className="block border-t border-line px-3.5 py-2 text-sm font-semibold text-lagoon-deep hover:bg-mist">{open}</Link>
    </div>
  )
}

function Figure({ label, value }: { label: string; value: string | number }) {
  return <div><dt className="text-xs text-slate">{label}</dt><dd className="numeric text-xl font-bold">{value}</dd></div>
}

/** A progress or exercise card, written from its facts in the reader's language. Null for any other message. */
export function MessageCard({ message, mine, links }: { message: ChatMessage; mine: boolean; links: CardLinks }) {
  const { t } = useTranslation()
  const format = useFormat()
  const progress = progressOf(message)
  if (progress) {
    const asOf = t('chat.cards.asOf', { when: format.date(progress.asOf) })
    if (progress.scope === 'activity') {
      return (
        <Shell icon={ChartLineUpIcon} title={t('chat.cards.activityTitle')} mine={mine} to={links.progress} open={t('chat.cards.openProgress')}>
          <dl className="grid grid-cols-3 gap-2">
            <Figure label={t('chat.cards.week')} value={progress.week} />
            <Figure label={t('chat.cards.activeDays')} value={progress.activeDays} />
            <Figure label={t('chat.cards.streak')} value={progress.streak} />
          </dl>
          <p className="mt-1.5 text-xs text-slate">{asOf}</p>
        </Shell>
      )
    }
    return (
      <Shell icon={ChartLineUpIcon} title={t('chat.cards.seriesTitle', { exercise: progress.exercise, side: t(`common.${progress.side}`, progress.side) })} mine={mine} to={links.progress} open={t('chat.cards.openProgress')}>
        <dl className="grid grid-cols-3 gap-2">
          <Figure label={t('progress.latest')} value={`${progress.latest}°`} />
          <Figure label={t('progress.best')} value={`${progress.best}°`} />
          <Figure label={t('chat.cards.change')} value={progress.change === null ? '—' : signed(progress.change)} />
        </dl>
        <p className="mt-1.5 text-xs text-slate">{t('chat.cards.prescribed', { low: progress.low, high: progress.high })} · {asOf}</p>
      </Shell>
    )
  }
  const exercise = exerciseOf(message)
  if (exercise) {
    return (
      <Shell icon={PersonSimpleTaiChiIcon} title={exercise.exercise || t('progress.unknown')} mine={mine} to={links.exercises} open={t('chat.cards.openExercise')}>
        <p className="text-sm">{t('chat.cards.exerciseLine', { side: t(`common.${exercise.side}`, exercise.side), low: exercise.low, high: exercise.high, repetitions: exercise.repetitions })}</p>
        <p className="mt-1 text-xs text-slate">{t('chat.cards.version', { version: exercise.version })}</p>
      </Shell>
    )
  }
  return null
}

/** A quiet line about something that happened, in the reader's language. */
export function SystemLineText({ message }: { message: ChatMessage }) {
  const { t } = useTranslation()
  const line = systemLineOf(message)
  if (line.event === 'practice_reminder') return <>{t('chat.lines.practiceReminder')}</>
  if (line.event === 'session_finished') return <>{t('chat.lines.sessionFinished', { completed: line.completed, target: line.target })}</>
  return <>{message.body || t('chat.unsupported')}</>
}
