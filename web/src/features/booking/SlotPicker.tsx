import { useTranslation } from 'react-i18next'
import { Notice, Skeleton } from '@/components/Display'
import type { Availability, AvailabilityDay, Slot } from '@/data/booking'
import { Loadable, type Load } from '@/features/shared'
import { cn } from '@/lib/cn'
import { useCenterFormat } from './format'
import { MonthCalendar, type CalendarDay } from './MonthCalendar'

function SlotButton({ slot, chosen, onChoose }: { slot: Slot; chosen: boolean; onChoose: () => void }) {
  const { t } = useTranslation()
  const format = useCenterFormat()
  const full = slot.remaining === 0
  const note = slot.mine ? t('booking.mine') : full ? t('booking.full') : t('booking.placesLeft', { count: slot.remaining })
  return (
    <button type="button" aria-pressed={chosen} disabled={full || slot.mine} onClick={onChoose}
      className={cn('flex min-h-12 items-center justify-between gap-3 rounded-control border px-3 py-2 text-left text-sm transition-colors transition-quick',
        chosen ? 'border-lagoon bg-lagoon text-paper' : full || slot.mine ? 'border-line bg-mist text-slate' : 'border-line-strong bg-paper hover:border-lagoon hover:bg-mist')}>
      <span className="font-semibold">{format.range(slot.startsAt, slot.endsAt)}</span>
      <span className={cn('text-right text-xs', chosen ? 'text-paper' : 'text-slate')}>{note}</span>
    </button>
  )
}

function DaySlots({ day, chosen, onChoose }: { day: AvailabilityDay | undefined; chosen: Slot | null; onChoose: (slot: Slot) => void }) {
  const { t } = useTranslation()
  if (!day) return <p className="text-sm text-slate">{t('booking.noDate')}</p>
  if (day.status !== 'open') return <Notice tone="info">{day.status === 'holiday' ? t('booking.day.holiday', { name: day.holiday }) : t(`booking.day.${day.status}`)}</Notice>
  return <div className="grid gap-2">{day.slots.map((slot) => <SlotButton key={slot.startsAt} slot={slot} chosen={chosen?.startsAt === slot.startsAt} onChoose={() => onChoose(slot)} />)}</div>
}

type Props = {
  load: Load<Availability>; month: string; onMonth: (month: string) => void; canGoBack: boolean; canGoForward: boolean; today: string
  date: string | null; onDate: (date: string) => void; chosen: Slot | null; onChoose: (slot: Slot) => void
}

/** Choose a date, then one specific time. Shared by booking, rescheduling and the Scheduler's dialogs. */
export function SlotPicker({ load, month, onMonth, canGoBack, canGoForward, today, date, onDate, chosen, onChoose }: Props) {
  const { t } = useTranslation()
  const format = useCenterFormat()
  const days = load.status === 'ready' ? load.data.days : []
  const describe = (value: string): CalendarDay => {
    const day = days.find((item) => item.date === value)
    if (day?.status === 'open') {
      const free = day.slots.some((slot) => slot.remaining > 0 && !slot.mine)
      return { enabled: true, marked: free, note: free ? t('booking.dayOpen') : t('booking.dayFull') }
    }
    return { enabled: false, note: day ? (day.status === 'holiday' ? day.holiday ?? undefined : t(`booking.dayNote.${day.status}`)) : undefined }
  }
  const picked = days.find((item) => item.date === date)
  return (
    <div className="grid items-start gap-6 desk:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section aria-label={t('booking.chooseDate')}>
        <MonthCalendar month={month} onMonth={onMonth} canGoBack={canGoBack} canGoForward={canGoForward} selected={date} today={today} onSelect={onDate} day={describe} label={t('booking.chooseDate')} />
      </section>
      <section aria-label={t('booking.chooseTime')}>
        <h3 className="mb-3 font-sans text-base font-bold">{date ? format.calendarDay(date) : t('booking.chooseTime')}</h3>
        <Loadable load={load} skeleton={<div className="grid gap-2">{[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-12 rounded-control" />)}</div>}>
          {() => <DaySlots day={picked} chosen={chosen} onChoose={onChoose} />}
        </Loadable>
      </section>
    </div>
  )
}
