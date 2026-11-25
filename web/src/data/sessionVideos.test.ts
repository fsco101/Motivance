import { describe, expect, it } from 'vitest'
import { canAskToRecord } from './sessionVideos'

/** The same cases as Android's AskToRecordTest (#175). */
describe('Ask to record', () => {
  it('is offered to a patient who agreed to messages and never shared a video', () => {
    expect(canAskToRecord({ open: true, consented: true }, false)).toBe(true)
  })
  it('is not offered without the messages agreement, or without a conversation', () => {
    expect(canAskToRecord({ open: true, consented: false }, false)).toBe(false)
    expect(canAskToRecord({ open: false, consented: true }, false)).toBe(false)
    expect(canAskToRecord(undefined, false)).toBe(false)
  })
  it('is not offered once a video was shared, or while that is unknown', () => {
    expect(canAskToRecord({ open: true, consented: true }, true)).toBe(false)
    expect(canAskToRecord({ open: true, consented: true }, undefined)).toBe(false)
  })
})
