import { createContext, useContext, useEffect } from 'react'

/**
 * Exercise mode (#149): while the camera is live, the exercise takes the whole window and the workspace frame steps aside.
 * The frame is hidden rather than removed, so the page underneath keeps its state when the mode starts or ends.
 */
export const ExerciseModeContext = createContext<(active: boolean) => void>(() => undefined)

/** Puts the page in exercise mode while `active`, and back when it leaves. */
export function useExerciseMode(active: boolean) {
  const set = useContext(ExerciseModeContext)
  useEffect(() => {
    set(active)
    return () => set(false)
  }, [active, set])
}
