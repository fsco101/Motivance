import { describe, expect, it } from 'vitest'
import { readTiming, validDraft, validRange, validRepetitions } from './therapist'

const timing = { minimum: '600', maximum: '30000', hold: '100', lean: '20' }

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

  it('accepts timing at every limit', () => {
    expect(readTiming({ minimum: '100', maximum: '300000', hold: '5000', lean: '90' })).toEqual({ minimumCycleMs: 100, maximumCycleMs: 300000, peakHoldMs: 5000, maxTrunkLean: 90 })
    expect(readTiming({ minimum: '30000', maximum: '30001', hold: '0', lean: '0' })).toEqual({ minimumCycleMs: 30000, maximumCycleMs: 30001, peakHoldMs: 0, maxTrunkLean: 0 })
  })

  it.each([
    ['minimum below 100', { minimum: '99' }], ['minimum above 30000', { minimum: '30001', maximum: '40000' }], ['maximum not above minimum', { maximum: '600' }],
    ['maximum above 300000', { maximum: '300001' }], ['hold above 5000', { hold: '5001' }], ['lean above 90', { lean: '90.5' }], ['negative lean', { lean: '-1' }],
  ])('refuses %s', (_, change) => {
    expect(readTiming({ ...timing, ...change })).toBeNull()
  })

  it('refuses part of a millisecond, which the server cannot store', () => {
    expect(readTiming({ ...timing, minimum: '600.5' })).toBeNull()
    expect(readTiming({ ...timing, hold: '1.5' })).toBeNull()
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
