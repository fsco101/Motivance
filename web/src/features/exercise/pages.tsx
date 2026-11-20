import { CameraCheckPage } from './CameraCheckPage'
import { ExerciseSessionPage } from './SessionPage'

/** The patient's camera check, at /patient/camera-check. */
export function PatientCameraCheckPage() {
  return <CameraCheckPage base="/patient" />
}

/** A patient's exercise session, at /patient/exercises/:versionId/session. */
export function PatientExerciseSessionPage() {
  return <ExerciseSessionPage base="/patient" />
}
