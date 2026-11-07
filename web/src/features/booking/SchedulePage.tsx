import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/components/Toast'
import { bookingFailureKey, CENTER_ZONE, markAttendance, shiftMonth, todayAt, type Attendance } from '@/data/booking'
import { supabase } from '@/data/client'
import { loadSchedule, openingDate, type ScheduleAudience, type ScheduleSession } from '@/data/schedule'
import { asLoad } from '@/features/shared'
import '@/locales/booking'
import { ScheduleView } from './ScheduleView'

/** How far a schedule can be turned either way. It is a record of confirmed sessions, not a booking limit. */
const MONTHS_EITHER_WAY = 12

/** One page for both audiences: only whose sessions it reads differs. A booking change invalidates ['booking'], so this follows it. */
export function SchedulePage({ audience, actions, recordPath }: { audience: ScheduleAudience; actions?: ReactNode; recordPath?: (patientId: string) => string }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [marking, setMarking] = useState(false)
  const [today] = useState(() => todayAt(CENTER_ZONE))
  const first = today.slice(0, 7)
  const [month, setMonth] = useState(first)
  const [picked, setPicked] = useState<string | null>(null)
  const schedule = useQuery({ queryKey: ['booking', 'schedule', audience, month], queryFn: () => loadSchedule(supabase(), audience, month) })
  const mark = async (session: ScheduleSession, attendance: Attendance) => {
    setMarking(true)
    try {
      await markAttendance(supabase(), session.id, attendance)
      toast.show(t('booking.attendanceSaved'))
    } catch (failure) {
      toast.show(t(bookingFailureKey(failure)), 'error')
    }
    await client.invalidateQueries({ queryKey: ['booking', 'schedule'] })
    setMarking(false)
  }
  return (
    <ScheduleView audience={audience} load={asLoad(schedule)} month={month} onMonth={(next) => { setMonth(next); setPicked(null) }} canGoBack={month > shiftMonth(first, -MONTHS_EITHER_WAY)}
      canGoForward={month < shiftMonth(first, MONTHS_EITHER_WAY)} today={today} date={picked ?? (schedule.data ? openingDate(schedule.data, today) : null)} onDate={setPicked}
      actions={actions} recordPath={recordPath} onMark={audience === 'therapist' ? (session, attendance) => void mark(session, attendance) : undefined} marking={marking} />
  )
}
