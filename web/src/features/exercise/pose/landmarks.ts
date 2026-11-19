import { landmark, type Landmark } from '../assessment'

/** The fields of a MediaPipe NormalizedLandmark this app reads. */
export interface PoseLandmark { x: number; y: number; z?: number; visibility?: number; presence?: number }

/**
 * MediaPipe people to engine landmarks. Like Android (CameraPrototype.kt), a landmark's confidence is the lower of its
 * visibility and presence, and a missing value counts as zero. Every person is kept so the engine can refuse two.
 */
export const toPeople = (people: readonly (readonly PoseLandmark[])[]): Landmark[][] =>
  people.map((body) => body.map((p) => landmark(p.x, p.y, Math.min(p.visibility ?? 0, p.presence ?? 0))))
