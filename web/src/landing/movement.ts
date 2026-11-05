/** The sample prescription in the landing demo. It is an illustration, not patient data. */
export const DEMO = { low: 20, high: 120, repetitions: 10 } as const

export type RepPhase = 'seeking' | 'rest' | 'moving' | 'target'
export type RepState = { phase: RepPhase; count: number }

export const START: RepState = { phase: 'seeking', count: 0 }

/** The same rule the app measures with, simplified: reach the target, then return to the start for it to count. */
export function nextRep(state: RepState, angle: number): RepState {
  switch (state.phase) {
    case 'seeking':
      return angle <= DEMO.low ? { ...state, phase: 'rest' } : state
    case 'rest':
      return angle > DEMO.low + 5 ? { ...state, phase: 'moving' } : state
    case 'moving':
      if (angle >= DEMO.high) return { ...state, phase: 'target' }
      return angle <= DEMO.low ? { ...state, phase: 'rest' } : state
    case 'target':
      return angle <= DEMO.low ? { phase: 'rest', count: state.count >= DEMO.repetitions ? 1 : state.count + 1 } : state
  }
}

/** The forearm's direction from the elbow, as a joint angle: 0 hangs straight down, and it grows as the arm bends. */
export function bendAt(dx: number, dy: number) {
  const degrees = (Math.atan2(dx, dy) * 180) / Math.PI
  return Math.min(150, Math.max(0, degrees < -90 ? 150 : degrees))
}
