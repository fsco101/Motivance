import { describe, expect, it } from 'vitest'
import { accepted, ASK_AGAIN_DAYS, declined, neverAsk, NO_PROMPT, readPrompt, shouldAsk, unrecorded, writePrompt, type RecordPrompt } from './prompt'

const DAY = 86_400_000
const now = Date.UTC(2026, 10, 25)
const after = (prompt: RecordPrompt, sessions: number) => Array.from({ length: sessions }).reduce<RecordPrompt>((p) => unrecorded(p), prompt)

/** The same cases as Android's RecordPromptTest (#175). */
describe('asking to record', () => {
  it('asks a patient who was never asked', () => {
    expect(shouldAsk(NO_PROMPT, now)).toBe(true)
  })
  it('after Not now, asks again only after three prescribed sessions without recording', () => {
    const once = declined(NO_PROMPT, now)
    expect(shouldAsk(once, now)).toBe(false)
    expect(shouldAsk(after(once, 2), now)).toBe(false)
    expect(shouldAsk(after(once, 3), now)).toBe(true)
  })
  it('after a second Not now, asks once more 30 days later', () => {
    const twice = declined(after(declined(NO_PROMPT, now), 3), now)
    expect(shouldAsk(after(twice, 10), now + 29 * DAY)).toBe(false)
    expect(shouldAsk(twice, now + ASK_AGAIN_DAYS * DAY)).toBe(true)
  })
  it('never asks a third time', () => {
    const thrice = declined(declined(after(declined(NO_PROMPT, now), 3), now), now + 30 * DAY)
    expect(shouldAsk(after(thrice, 50), now + 400 * DAY)).toBe(false)
  })
  it('stops at once on Don’t ask again, and once agreed', () => {
    expect(shouldAsk(neverAsk(NO_PROMPT), now)).toBe(false)
    expect(shouldAsk(after(neverAsk(declined(NO_PROMPT, now)), 5), now)).toBe(false)
    expect(shouldAsk(accepted(NO_PROMPT), now)).toBe(false)
    expect(unrecorded(accepted(NO_PROMPT)).sessionsSince).toBe(0)
  })
  it('keeps the answer for each account, and asks again for the old agreement', () => {
    const items = new Map<string, string>()
    const store = { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value) } }
    writePrompt('ana', accepted(NO_PROMPT), store)
    expect(readPrompt('ana', store).agreed).toBe(true)
    expect(readPrompt('ben', store)).toEqual(NO_PROMPT)
    items.set('motivance.video.prompt:old', JSON.stringify({ ...accepted(NO_PROMPT), version: 'web-1' }))
    expect(readPrompt('old', store).agreed).toBe(false)
    items.set('motivance.video.prompt:bad', '{not json')
    expect(readPrompt('bad', store)).toEqual(NO_PROMPT)
  })
})
