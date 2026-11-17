import type { BackendStatus } from './types'

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/** A size in binary units, as Supabase's dashboard counts them: 1 KB is 1,024 bytes. */
export function formatBytes(bytes: number, locale = 'en-PH') {
  let value = Math.max(bytes, 0)
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)} ${UNITS[unit]}`
}

/** A job is failing when its last run failed or any run failed in the last day; one that never ran is not yet known. */
export const jobFailing = (job: NonNullable<BackendStatus['jobs']>[number]) => job.lastStatus === 'failed' || job.failuresDay > 0

/** Notifications waiting longer than this mean the sender has stopped, not that it is busy. */
export const STUCK_MINUTES = 15
export const deliveriesStuck = (status: BackendStatus, now = Date.now()) =>
  status.deliveries.oldestWaiting !== null && now - new Date(status.deliveries.oldestWaiting).getTime() > STUCK_MINUTES * 60_000
