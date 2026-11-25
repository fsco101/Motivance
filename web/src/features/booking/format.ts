import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { CENTER_ZONE, isRejectionCode, type BookingStatus } from '@/data/booking'

export const statusTone: Record<BookingStatus, 'positive' | 'neutral' | 'caution' | 'danger' | 'primary'> = {
  pending: 'caution', confirmed: 'positive', rescheduled: 'primary', rejected: 'danger', cancelled: 'neutral',
}

/**
 * The server writes a code for reasons of its own and for a Scheduler's common reasons (#172), and a person's own words otherwise,
 * which are shown as they are. A patient reads a sentence; a Scheduler reads the short name of the choice they made.
 */
export function useReasonText(reader: 'patient' | 'scheduler' = 'patient') {
  const { t } = useTranslation()
  return (reason: string) => {
    if (reason === 'therapist_unavailable') return t(reader === 'patient' ? 'booking.reasonTherapist' : 'scheduler.reasonTherapist')
    if (reason === 'request_expired') return t(reader === 'patient' ? 'booking.reasonExpired' : 'scheduler.reasonExpired')
    if (isRejectionCode(reason)) return t(reader === 'patient' ? `booking.rejectReason.${reason}` : `scheduler.rejectChoice.${reason}`)
    return reason
  }
}

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
