import { useSyncExternalStore } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'
const query = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null)
const subscribe = (changed: () => void) => {
  const list = query()
  list?.addEventListener('change', changed)
  return () => list?.removeEventListener('change', changed)
}

/**
 * True while the person prefers reduced motion. Unlike motion's useReducedMotion, which reads the setting once, this follows a
 * change made while the page is open, so something already moving stops at once.
 */
export const useStill = () => useSyncExternalStore(subscribe, () => query()?.matches ?? false, () => false)
