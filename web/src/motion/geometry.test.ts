import { describe, expect, it } from 'vitest'
import { degreesAt, faceAngle, moveRange, polar, protractorAngle } from './geometry'

describe('protractor geometry', () => {
  it('places joint angles left to right across the top', () => {
    expect(protractorAngle(0)).toBe(180)
    expect(protractorAngle(90)).toBe(270)
    expect(protractorAngle(180)).toBe(360)
    expect(polar(0, 0, 10, protractorAngle(90)).y).toBeCloseTo(-10)
  })

  it('reads a pointer back as a joint angle, and holds the ends below the baseline', () => {
    expect(degreesAt(-10, 0, 0, 0)).toBeCloseTo(0)
    expect(degreesAt(0, -10, 0, 0)).toBeCloseTo(90)
    expect(degreesAt(10, 0, 0, 0)).toBeCloseTo(180)
    expect(degreesAt(-10, 3, 0, 0)).toBe(0)
    expect(degreesAt(10, 3, 0, 0)).toBe(180)
  })

  it('spreads the face across 240 degrees', () => {
    expect(faceAngle(0)).toBe(150)
    expect(faceAngle(180)).toBe(390)
  })
})

describe('range editing, matching the Android editor', () => {
  it('snaps to 5 degrees', () => {
    expect(moveRange(20, 90, 'high', 103)).toEqual({ low: 20, high: 105 })
    expect(moveRange(20, 90, 'low', 32)).toEqual({ low: 30, high: 90 })
  })

  it('keeps the two ends at least 15 degrees apart', () => {
    expect(moveRange(20, 90, 'high', 25)).toEqual({ low: 20, high: 35 })
    expect(moveRange(20, 90, 'low', 88)).toEqual({ low: 75, high: 90 })
  })

  it('stays inside 0 to 180', () => {
    expect(moveRange(20, 90, 'high', 200)).toEqual({ low: 20, high: 180 })
    expect(moveRange(20, 90, 'low', -12)).toEqual({ low: 0, high: 90 })
    expect(moveRange(170, 180, 'high', 90)).toEqual({ low: 170, high: 180 })
  })
})
