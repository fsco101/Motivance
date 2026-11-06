import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react'
import { useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@/components/Button'
import { shiftMonth } from '@/data/booking'
import { cn } from '@/lib/cn'
import { useCenterFormat } from './format'

export type CalendarDay = {
  /** A date that can be chosen. Others stay readable, and can still be focused, so their reason can be heard. */
  enabled: boolean
  /** A small mark under the number, such as sessions on that day. */
  marked?: boolean
  /** Spoken with the date, because colour alone cannot carry it. */
  note?: string
}

type Props = {
  month: string
  onMonth: (month: string) => void
  canGoBack: boolean
  canGoForward: boolean
  selected: string | null
  today: string
  onSelect: (date: string) => void
  day: (date: string) => CalendarDay
  label: string
}

const pad = (value: number) => String(value).padStart(2, '0')

/** The dates of a month in Monday-first weeks, with null for the blanks around it. */
export function monthGrid(month: string) {
  const [year = 0, number = 1] = month.split('-').map(Number)
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate()
  const lead = (new Date(Date.UTC(year, number - 1, 1)).getUTCDay() + 6) % 7
  const cells = [...Array<null>(lead).fill(null), ...Array.from({ length: count }, (_, index) => `${month}-${pad(index + 1)}`)]
  while (cells.length % 7) cells.push(null)
  return Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7))
}

/** A grid, as the ARIA pattern for date pickers: one tab stop, and the arrow keys move between days. */
export function MonthCalendar({ month, onMonth, canGoBack, canGoForward, selected, today, onSelect, day, label }: Props) {
  const { t } = useTranslation()
  const format = useCenterFormat()
  const grid = useRef<HTMLTableElement>(null)
  const dates = monthGrid(month).flat().filter((date): date is string => date !== null)
  const [cursor, setCursor] = useState<string | null>(null)
  const active = cursor && dates.includes(cursor) ? cursor : selected && dates.includes(selected) ? selected : dates.includes(today) ? today : dates[0]!

  const move = (event: KeyboardEvent, date: string) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key]
    const target = event.key === 'Home' ? dates[0] : event.key === 'End' ? dates.at(-1) : step ? dates[dates.indexOf(date) + step] : undefined
    if (!step && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    if (!target) return
    setCursor(target)
    grid.current?.querySelector<HTMLButtonElement>(`[data-date="${target}"]`)?.focus()
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <IconButton label={t('booking.previousMonth')} disabled={!canGoBack} onClick={() => onMonth(shiftMonth(month, -1))}><CaretLeftIcon aria-hidden /></IconButton>
        <h3 aria-live="polite" className="font-sans text-base font-bold">{format.month(month)}</h3>
        <IconButton label={t('booking.nextMonth')} disabled={!canGoForward} onClick={() => onMonth(shiftMonth(month, 1))}><CaretRightIcon aria-hidden /></IconButton>
      </div>
      <table ref={grid} role="grid" aria-label={label} className="w-full table-fixed border-collapse text-center">
        <thead>
          <tr>{format.weekdays.map((name) => <th key={name} scope="col" className="pb-1 text-xs font-semibold text-slate">{name}</th>)}</tr>
        </thead>
        <tbody>
          {monthGrid(month).map((week, index) => (
            <tr key={index}>
              {week.map((date, column) => {
                if (!date) return <td key={column} role="gridcell" aria-hidden />
                const info = day(date)
                const chosen = date === selected
                return (
                  <td key={date} role="gridcell" aria-selected={chosen} className="p-0.5">
                    <button type="button" data-date={date} tabIndex={date === active ? 0 : -1} aria-disabled={!info.enabled}
                      aria-label={[format.calendarDay(date), info.note].filter(Boolean).join(', ')}
                      onClick={() => { setCursor(date); if (info.enabled) onSelect(date) }} onKeyDown={(event) => move(event, date)}
                      className={cn('relative mx-auto grid aspect-square w-full max-w-11 place-items-center rounded-control text-sm transition-colors transition-quick',
                        chosen ? 'bg-lagoon font-bold text-paper' : info.enabled ? 'bg-tide font-semibold text-ink hover:bg-sprout-bright' : 'text-slate',
                        !chosen && date === today && 'ring-1 ring-inset ring-lagoon')}>
                      {Number(date.slice(-2))}
                      {info.marked && <span aria-hidden className={cn('absolute bottom-1 size-1 rounded-full', chosen ? 'bg-paper' : 'bg-lagoon')} />}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
