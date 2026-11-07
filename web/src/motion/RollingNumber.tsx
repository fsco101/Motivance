import { m as motion, useReducedMotion, useSpring, useTransform } from 'motion/react'
import { useEffect } from 'react'

const stiff = { stiffness: 90, damping: 20, mass: 1 }

/** A number that rolls to its new value. Readers get the final value at once; only the visible digits move. */
export function RollingNumber({ value, className }: { value: number; className?: string }) {
  const reduced = useReducedMotion()
  const current = useSpring(0, stiff)
  const text = useTransform(current, (latest) => Math.round(latest).toLocaleString())
  useEffect(() => {
    if (!reduced) current.set(value)
  }, [value, reduced, current])
  // Written directly: a spring told to jump does not reach the text it drives, so the digits would stay at zero.
  if (reduced) return <span className={className}>{value.toLocaleString()}</span>
  return (
    <span className={className}>
      <span className="sr-only">{value.toLocaleString()}</span>
      <motion.span aria-hidden>{text}</motion.span>
    </span>
  )
}
