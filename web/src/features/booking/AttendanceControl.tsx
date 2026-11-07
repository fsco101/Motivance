import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import type { Attendance } from '@/data/booking'

const CHOICES: readonly Attendance[] = ['attended', 'no_show']

/** Both marks side by side, so correcting one is the same single action as making it. */
export function AttendanceControl({ value, label, disabled = false, onMark }: { value: Attendance | null; label: string; disabled?: boolean; onMark: (value: Attendance) => void }) {
  const { t } = useTranslation()
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {CHOICES.map((choice) => (
        <Button key={choice} size="sm" variant={value === choice ? 'primary' : 'secondary'} aria-pressed={value === choice} disabled={disabled} onClick={() => onMark(choice)}>{t(`booking.attendance.${choice}`)}</Button>
      ))}
    </div>
  )
}
