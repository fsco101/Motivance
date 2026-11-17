import { describe, expect, it } from 'vitest'
import { deliveriesStuck, formatBytes, jobFailing } from './backend'
import type { BackendStatus } from './types'

describe('backend status', () => {
  it('writes sizes in binary units, as Supabase does', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(524_288_000)).toBe('500 MB')
    expect(formatBytes(1_073_741_824)).toBe('1 GB')
    expect(formatBytes(12_582_912)).toBe('12 MB')
    expect(formatBytes(-5)).toBe('0 B')
  })

  it('treats a job as failing when its last run or any run today failed', () => {
    const job = { name: 'x', schedule: '* * * * *', lastStatus: 'succeeded', lastRun: null, failuresDay: 0 }
    expect(jobFailing(job)).toBe(false)
    expect(jobFailing({ ...job, lastStatus: 'failed' })).toBe(true)
    expect(jobFailing({ ...job, failuresDay: 2 })).toBe(true)
    expect(jobFailing({ ...job, lastStatus: null })).toBe(false)
  })

  it('calls the notification queue stuck after a quarter of an hour', () => {
    const now = Date.parse('2026-11-17T06:00:00Z')
    const status = (oldestWaiting: string | null) => ({ deliveries: { waiting: 1, oldestWaiting, failedWeek: 0, sentDay: 0 } }) as BackendStatus
    expect(deliveriesStuck(status(null), now)).toBe(false)
    expect(deliveriesStuck(status('2026-11-17T05:50:00Z'), now)).toBe(false)
    expect(deliveriesStuck(status('2026-11-17T05:40:00Z'), now)).toBe(true)
  })
})
