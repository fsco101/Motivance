import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { CENTER_ZONE } from '@/data/booking'

/** Session times always read in the center's zone, so a patient travelling or a browser set elsewhere still sees the real time. */
export function useCenterFormat(zone = CENTER_ZONE) {
  const { i18n } = useTranslation()
  const locale = i18n.language === 'fil' ? 'fil-PH' : 'en-PH'
  return useMemo(() => {
    const day = new Intl.DateTimeFormat(locale, { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
    const time = new Intl.DateTimeFormat(locale, { timeZone: zone, hour: 'numeric', minute: '2-digit' })
    // A calendar date has no zone of its own, so it is read and written in UTC to stay the same day.
    const calendar = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' })
    const month = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'long', year: 'numeric' })
    const weekday = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short' })
    const range = (start: string, end: string) => `${time.format(new Date(start))} – ${time.format(new Date(end))}`
    return {
      day: (iso: string) => day.format(new Date(iso)),
      time: (iso: string) => time.format(new Date(iso)),
      range,
      when: (start: string, end: string) => `${day.format(new Date(start))}, ${range(start, end)}`,
      calendarDay: (date: string) => calendar.format(new Date(`${date}T00:00:00Z`)),
      month: (value: string) => month.format(new Date(`${value}-01T00:00:00Z`)),
      /** Monday to Sunday: 5 January 2026 was a Monday. */
      weekdays: Array.from({ length: 7 }, (_, index) => weekday.format(new Date(Date.UTC(2026, 0, 5 + index)))),
    }
  }, [locale, zone])
}
