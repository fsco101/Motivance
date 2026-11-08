import { describe, expect, it } from 'vitest'
import { readTiming, secondsText, validDraft, validRange, validRepetitions } from './therapist'

// Issue #97: therapists type seconds; the server still stores whole milliseconds.
const timing = { minimum: '0.6', maximum: '30', hold: '0.1', lean: '20' }

describe('prescription limits match publish_prescription', () => {
  it('needs a range inside 0 to 180, with high more than 10 above low', () => {
    expect(validRange(0, 180)).toBe(true)
    expect(validRange(20, 31)).toBe(true)
    expect(validRange(20, 30)).toBe(false)
    expect(validRange(-1, 90)).toBe(false)
    expect(validRange(20, 181)).toBe(false)
  })

  it('needs 1 to 1000 whole repetitions', () => {
    expect([1, 1000].every(validRepetitions)).toBe(true)
    expect([0, 1001, 2.5].some(validRepetitions)).toBe(false)
  })

  it('reads seconds and keeps the stored milliseconds', () => {
    expect(readTiming(timing)).toEqual({ minimumCycleMs: 600, maximumCycleMs: 30000, peakHoldMs: 100, maxTrunkLean: 20 })
    expect(readTiming({ ...timing, minimum: '0,6', hold: '1.25' })).toEqual({ minimumCycleMs: 600, maximumCycleMs: 30000, peakHoldMs: 1250, maxTrunkLean: 20 })
  })

  it('accepts timing at every limit', () => {
    expect(readTiming({ minimum: '0.1', maximum: '300', hold: '5', lean: '90' })).toEqual({ minimumCycleMs: 100, maximumCycleMs: 300000, peakHoldMs: 5000, maxTrunkLean: 90 })
    expect(readTiming({ minimum: '30', maximum: '30.001', hold: '0', lean: '0' })).toEqual({ minimumCycleMs: 30000, maximumCycleMs: 30001, peakHoldMs: 0, maxTrunkLean: 0 })
  })

  it.each([[600, '0.6'], [1000, '1'], [1250, '1.25'], [30000, '30'], [100, '0.1'], [0, '0']])('shows %i ms as %s seconds', (ms, text) => {
    expect(secondsText(ms)).toBe(text)
  })

  it.each([
    ['minimum below 0.1 s', { minimum: '0.099' }], ['minimum above 30 s', { minimum: '30.001', maximum: '40' }], ['maximum not above minimum', { maximum: '0.6' }],
    ['maximum above 300 s', { maximum: '300.001' }], ['hold above 5 s', { hold: '5.001' }], ['negative hold', { hold: '-1' }], ['lean above 90', { lean: '90.5' }], ['negative lean', { lean: '-1' }],
    ['milliseconds typed as seconds', { minimum: '600', maximum: '30000' }], ['an exponent', { hold: '1e-1' }],
  ])('refuses %s', (_, change) => {
    expect(readTiming({ ...timing, ...change })).toBeNull()
  })

  it('refuses part of a millisecond, which the server cannot store', () => {
    expect(readTiming({ ...timing, minimum: '0.6005' })).toBeNull()
    expect(readTiming({ ...timing, hold: '0.0001' })).toBeNull()
  })

  it('allows part of a degree of lean, as Android does', () => {
    expect(readTiming({ ...timing, lean: '12.5' })?.maxTrunkLean).toBe(12.5)
  })

  it.each(['minimum', 'maximum', 'hold', 'lean'])('treats a blank %s as a mistake, never as zero', (field) => {
    expect(readTiming({ ...timing, [field]: '' })).toBeNull()
    expect(readTiming({ ...timing, [field]: '   ' })).toBeNull()
  })
})

describe('custom exercise limits match Android', () => {
  const draft = { name: 'Knee bend', joint: 'KNEE' as const, english: 'Bend slowly.', filipino: '' }

  it('needs a name and instructions, and leaves Filipino optional', () => {
    expect(validDraft(draft)).toBe(true)
    expect(validDraft({ ...draft, name: '   ' })).toBe(false)
    expect(validDraft({ ...draft, english: '' })).toBe(false)
  })

  it('stops at 120 and 4000 characters', () => {
    expect(validDraft({ ...draft, name: 'n'.repeat(120), english: 'e'.repeat(4000), filipino: 'f'.repeat(4000) })).toBe(true)
    expect(validDraft({ ...draft, name: 'n'.repeat(121) })).toBe(false)
    expect(validDraft({ ...draft, english: 'e'.repeat(4001) })).toBe(false)
    expect(validDraft({ ...draft, filipino: 'f'.repeat(4001) })).toBe(false)
  })
})
