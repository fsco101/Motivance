import { AnimatePresence, m as motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'
import { useLocation, useOutlet } from 'react-router'
import { duration, ease } from './tokens'

const depthOf = (path: string) => path.split('/').filter(Boolean).length

/** Holds the leaving page steady while it animates out, instead of swapping it for the new route at once. */
function Frozen({ outlet }: { outlet: ReturnType<typeof useOutlet> }) {
  const [held] = useState(outlet)
  return held
}

/**
 * Page changes move by navigation depth, as on Android: going deeper slides in from the end edge, coming back slides
 * from the start edge, and moving between sections only fades.
 */
export function AnimatedOutlet() {
  const location = useLocation()
  const outlet = useOutlet()
  const reduced = useReducedMotion()
  const [direction, setDirection] = useState(0)
  const [seen, setSeen] = useState(location.pathname)
  if (seen !== location.pathname) {
    setSeen(location.pathname)
    setDirection(Math.sign(depthOf(location.pathname) - depthOf(seen)))
  }
  const shift = reduced ? 0 : 24
  return (
    // popLayout keeps both pages present for a moment, which is what lets an avatar travel from a card to its record.
    <AnimatePresence mode="popLayout" initial={false} custom={direction}>
      <motion.div key={location.pathname} custom={direction}
        variants={{
          enter: (d: number) => ({ opacity: 0, x: d * shift }),
          rest: { opacity: 1, x: 0 },
          leave: (d: number) => ({ opacity: 0, x: d * shift * -0.4, transition: { duration: duration.quick, ease: ease.out } }),
        }}
        initial="enter" animate="rest" exit="leave" transition={{ duration: duration.standard, ease: ease.out }}>
        <Frozen outlet={outlet} />
      </motion.div>
    </AnimatePresence>
  )
}
