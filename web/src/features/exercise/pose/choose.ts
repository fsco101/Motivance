import type { PoseDetector } from './frameLoop'

/** Somewhere MediaPipe can run: a Web Worker, or the page's own thread. */
export interface LandmarkerHost extends PoseDetector {
  /** Where detection runs, for diagnostics. */
  readonly thread: 'worker' | 'page'
  /** Loads MediaPipe and the model, trying the graphics chip first, and runs one warm-up frame. */
  init(): Promise<'GPU' | 'CPU'>
  close(): void
}

/**
 * Picks where tracking runs. A worker keeps detection off the page's thread, so it wins when it gets the graphics chip.
 * Some browsers cannot use the graphics chip inside a worker; there the page thread is faster if it can. Otherwise
 * the worker runs on the CPU.
 */
export async function chooseHost(worker: () => LandmarkerHost, main: () => LandmarkerHost): Promise<LandmarkerHost> {
  let first: LandmarkerHost | null = worker()
  try {
    if ((await first.init()) === 'GPU') return first
  } catch {
    first.close()
    first = null
  }
  const second = main()
  try {
    const delegate = await second.init()
    if (delegate === 'GPU' || !first) { first?.close(); return second }
  } catch (error) {
    second.close()
    if (!first) throw error
    return first
  }
  second.close()
  return first
}
