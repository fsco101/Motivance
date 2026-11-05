import { describe, expect, it } from 'vitest'
import { DEMO, START, bendAt, nextRep } from './movement'

const run = (angles: readonly number[], from = START) => angles.reduce(nextRep, from)

describe('the landing demo counts like the app', () => {
  it('needs the start position first', () => {
    expect(run([90, 130, 90]).count).toBe(0)
  })

  it('counts a repetition that reaches the target and returns', () => {
    expect(run([10, 60, 125, 60, 15]).count).toBe(1)
  })

  it('does not count a movement that stops short', () => {
    expect(run([10, 60, 100, 60, 15]).count).toBe(0)
  })

  it('counts only on the return, not on reaching the target', () => {
    expect(run([10, 60, 125]).count).toBe(0)
  })

  it('starts over after the prescribed repetitions', () => {
    const cycle = [10, 60, 125, 60, 15]
    const done = run(Array.from({ length: DEMO.repetitions }, () => cycle).flat())
    expect(done.count).toBe(DEMO.repetitions)
    expect(run(cycle, done).count).toBe(1)
  })
})

describe('dragging the forearm', () => {
  it('reads straight down as 0 and bends upward', () => {
    expect(bendAt(0, 100)).toBeCloseTo(0)
    expect(bendAt(100, 0)).toBeCloseTo(90)
    expect(bendAt(100, -100)).toBeCloseTo(135)
  })

  it('stays within what an elbow can do', () => {
    expect(bendAt(-100, 100)).toBe(0)
    expect(bendAt(1, -100)).toBe(150)
    expect(bendAt(-1, -100)).toBe(150)
  })
})
