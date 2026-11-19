import { describe, expect, it } from 'vitest'
import { createRules, landmark, type TrackingQuality } from '../assessment'
import { cameraErrorKind, durationParts, focusVisible, mirrorFor, showBody, visibleLandmark } from './stage'

describe('visibleLandmark', () => {
  const rules = createRules()
  it('needs a finite point inside the frame at the rules confidence, as Android draws it', () => {
    expect(visibleLandmark(landmark(0.5, 0.5, 0.7), rules)).toBe(true)
    expect(visibleLandmark(landmark(0.5, 0.5, 0.69), rules)).toBe(false)
    expect(visibleLandmark(landmark(1.01, 0.5, 1), rules)).toBe(false)
    expect(visibleLandmark(landmark(Number.NaN, 0.5, 1), rules)).toBe(false)
    expect(visibleLandmark(undefined, rules)).toBe(false)
  })
  it('checks the focus joint on the rules side', () => {
    const points = Array.from({ length: 33 }, () => landmark(0.5, 0.5, 0))
    points[13] = landmark(0.5, 0.5, 1)
    expect(focusVisible(points, rules)).toBe(true)
    expect(focusVisible(points, createRules({ side: 'RIGHT' }))).toBe(false)
  })
})

describe('showBody', () => {
  it('hides the skeleton without a picture, with nobody or several people, and while paused', () => {
    const hidden: TrackingQuality[] = ['NO_PERSON', 'MULTIPLE_PEOPLE', 'PAUSED']
    for (const quality of hidden) expect(showBody(quality, true)).toBe(false)
    expect(showBody('READY', false)).toBe(false)
    expect(showBody('LOW_CONFIDENCE', true)).toBe(true)
  })
})

describe('durationParts', () => {
  it('reads milliseconds as Android does: one second, or a plain number of seconds', () => {
    expect(durationParts(1000)).toEqual({ one: true, seconds: '1' })
    expect(durationParts(600)).toEqual({ one: false, seconds: '0.6' })
    expect(durationParts(30_000)).toEqual({ one: false, seconds: '30' })
    expect(durationParts(1500)).toEqual({ one: false, seconds: '1.5' })
  })
})

describe('cameraErrorKind', () => {
  const named = (name: string) => Object.assign(new Error(name), { name })
  it('tells a blocked camera from a missing, busy or unusable one', () => {
    expect(cameraErrorKind(named('NotAllowedError'))).toBe('blocked')
    expect(cameraErrorKind(named('SecurityError'))).toBe('blocked')
    expect(cameraErrorKind(named('NotFoundError'))).toBe('noCamera')
    expect(cameraErrorKind(named('OverconstrainedError'))).toBe('unavailable')
    expect(cameraErrorKind(named('NotReadableError'))).toBe('inUse')
    expect(cameraErrorKind(new Error('other'))).toBe('unavailable')
  })
})

describe('mirrorFor', () => {
  it('mirrors a camera facing the patient, and a webcam that does not say which way it faces', () => {
    expect(mirrorFor({ facingMode: 'user' })).toBe(true)
    expect(mirrorFor({})).toBe(true)
    expect(mirrorFor({ facingMode: 'environment' })).toBe(false)
  })
})
