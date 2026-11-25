import { describe, expect, it } from 'vitest'
import { PrepareError, recordBitrate, recordSize, SESSION_VIDEO, shareRefusalKey, sharePlan, videoFileName } from './plan'

describe('session video rules, as on Android', () => {
  it('records at the camera picture\'s shape, at most 1280 pixels long and even', () => {
    expect(recordSize(640, 480)).toEqual({ width: 640, height: 480 })
    expect(recordSize(1920, 1080)).toEqual({ width: 1280, height: 720 })
    expect(recordSize(1081, 1921)).toEqual({ width: 720, height: 1280 })
    expect(recordSize(641, 481)).toEqual({ width: 640, height: 480 })
  })

  it('records at about three bits a pixel, within 1 to 4 Mbps', () => {
    expect(recordBitrate(320, 240)).toBe(1_000_000)
    expect(recordBitrate(640, 480)).toBe(1_000_000)
    expect(recordBitrate(1280, 720)).toBe(2_764_800)
    expect(recordBitrate(3840, 2160)).toBe(4_000_000)
  })

  it('shares 480p and the first five minutes, which the server accepts', () => {
    expect(sharePlan(640, 480, 90_000)).toEqual({ width: 640, height: 480, durationMs: 90_000, trimmed: false })
    expect(sharePlan(1280, 720, 900_000)).toEqual({ width: 852, height: 480, durationMs: 300_000, trimmed: true })
    expect(sharePlan(720, 1280, 300_200)).toMatchObject({ width: 480, height: 852, durationMs: 300_000, trimmed: false })
    // The server's own limits: the short side at most 480, the long side at most 854, at most 300.5 seconds.
    for (const [w, h] of [[1920, 1080], [1080, 1920], [4000, 3000], [500, 500]] as const) {
      const plan = sharePlan(w, h, 3_600_000)
      expect(Math.min(plan.width, plan.height)).toBeLessThanOrEqual(480)
      expect(Math.max(plan.width, plan.height)).toBeLessThanOrEqual(854)
      expect(plan.durationMs).toBeLessThanOrEqual(300_500)
    }
    expect(() => sharePlan(0, 480, 1)).toThrow('video_invalid')
    // About 500 kbps for five minutes fits well inside 20 MB.
    expect((SESSION_VIDEO.bits / 8) * (SESSION_VIDEO.ms / 1000)).toBeLessThan(SESSION_VIDEO.bytes)
  })

  it('names a download the way the phone names its gallery copy', () => {
    expect(videoFileName(new Date(2026, 10, 20, 9, 5, 7).getTime())).toBe('Motivance-session-20261120-090507.mp4')
  })

  it('says each refusal the server names in the patient\'s words', () => {
    expect(shareRefusalKey(new Error('video_session_missing'))).toBe('recording.errorUploading')
    expect(shareRefusalKey({ message: 'video_unavailable' })).toBe('recording.errorNoTherapist')
    expect(shareRefusalKey(new Error('video_already_shared'))).toBe('recording.errorAlready')
    expect(shareRefusalKey(new Error('video_too_large'))).toBe('recording.errorTooLarge')
    expect(shareRefusalKey(new Error('video_rate_limited'))).toBe('recording.errorRate')
    expect(shareRefusalKey(new PrepareError('no decoder'))).toBe('recording.errorPrepare')
    expect(shareRefusalKey(new TypeError('Failed to fetch'))).toBe('recording.errorFailed')
  })
})
