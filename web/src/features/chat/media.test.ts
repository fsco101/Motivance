import { describe, expect, it } from 'vitest'
import { fitWithin, MediaError, videoPlan } from './media'

describe('sizes for upload, matching Android', () => {
  it('fits a photo inside 1600 px on its long side, keeping its shape, and never enlarges', () => {
    expect(fitWithin(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 })
    expect(fitWithin(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 })
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 })
  })

  it('makes video 480p on its short side within 854 on its long side, in even sizes', () => {
    expect(videoPlan(1920, 1080, 12)).toMatchObject({ width: 852, height: 480, seconds: 12, trimmed: false })
    expect(videoPlan(1080, 1920, 12)).toMatchObject({ width: 480, height: 852 })
    expect(videoPlan(640, 480, 5)).toMatchObject({ width: 640, height: 480 })
    expect(videoPlan(1001, 563, 5)).toMatchObject({ width: 852, height: 478 })
  })

  it('keeps the first 30 seconds of a longer clip', () => {
    expect(videoPlan(1280, 720, 95)).toMatchObject({ seconds: 30, trimmed: true })
    expect(videoPlan(1280, 720, 30.1)).toMatchObject({ seconds: 30, trimmed: false })
  })

  it('refuses a clip with no size or length', () => {
    expect(() => videoPlan(0, 720, 5)).toThrow(MediaError)
    expect(() => videoPlan(1280, 720, Number.NaN)).toThrow(MediaError)
  })
})
