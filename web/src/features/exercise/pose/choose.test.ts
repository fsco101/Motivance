import { describe, expect, it, vi } from 'vitest'
import { chooseHost, type LandmarkerHost } from './choose'

function host(delegate: 'GPU' | 'CPU' | Error): LandmarkerHost & { closed: boolean } {
  const h = {
    closed: false,
    thread: 'worker' as const,
    delegate: 'CPU' as 'GPU' | 'CPU',
    init: vi.fn(async () => { if (delegate instanceof Error) throw delegate; h.delegate = delegate; return delegate }),
    detect: vi.fn(),
    close: vi.fn(() => { h.closed = true }),
  }
  return h
}

describe('chooseHost', () => {
  it('uses the worker when it gets the graphics chip', async () => {
    const worker = host('GPU'), main = host('GPU')
    expect(await chooseHost(() => worker, () => main)).toBe(worker)
    expect(main.init).not.toHaveBeenCalled()
  })

  it('moves to the page thread when only it can use the graphics chip', async () => {
    const worker = host('CPU'), main = host('GPU')
    expect(await chooseHost(() => worker, () => main)).toBe(main)
    expect(worker.closed).toBe(true)
  })

  it('stays on the worker CPU when the page thread cannot use the graphics chip either', async () => {
    const worker = host('CPU'), main = host('CPU')
    expect(await chooseHost(() => worker, () => main)).toBe(worker)
    expect(main.closed).toBe(true)
  })

  it('uses the page thread when the worker cannot start at all', async () => {
    const worker = host(new Error('no module workers')), main = host('CPU')
    expect(await chooseHost(() => worker, () => main)).toBe(main)
    expect(worker.closed).toBe(true)
  })

  it('fails when neither can start', async () => {
    await expect(chooseHost(() => host(new Error('a')), () => host(new Error('b')))).rejects.toThrow('b')
  })
})
