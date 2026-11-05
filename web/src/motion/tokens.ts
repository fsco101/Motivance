import type { Transition } from 'motion/react'

/**
 * The one place that sets timing. The character is a goniometer needle: it travels quickly, passes its mark slightly,
 * and settles. Screens never set their own durations.
 */
export const duration = { quick: 0.14, standard: 0.22, slow: 0.34, sweep: 0.9 } as const

export const ease = {
  out: [0.22, 1, 0.36, 1],
  inOut: [0.65, 0, 0.35, 1],
} as const

export const spring = {
  /** Readings: dials, rail marker. Visible overshoot, then settles. */
  needle: { type: 'spring', stiffness: 170, damping: 15, mass: 1 },
  /** Things under the pointer: quick, no wobble. */
  press: { type: 'spring', stiffness: 520, damping: 34 },
  /** Elements changing size or place. */
  layout: { type: 'spring', stiffness: 340, damping: 36 },
} as const satisfies Record<string, Transition>

/** Share the same timing with CSS transitions, so the two can never drift apart. */
export function applyMotionTokens(root: HTMLElement = document.documentElement) {
  root.style.setProperty('--motion-quick', `${duration.quick}s`)
  root.style.setProperty('--motion-standard', `${duration.standard}s`)
  root.style.setProperty('--motion-ease-out', `cubic-bezier(${ease.out.join(',')})`)
}
