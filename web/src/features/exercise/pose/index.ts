/**
 * Pose tracking in the browser with MediaPipe's web package. Detection runs in a worker where the graphics chip is
 * available there, keeps only the newest frame, and never reaches an address other than this app's. Load this module
 * with a dynamic import: MediaPipe stays out of the page's first download.
 */
export { preparePoseTracking, releasePoseTracking } from './hosts'
export { FrameLoop, type Detection, type FrameSource, type PoseDetector, type TrackedFrame } from './frameLoop'
export { cameraSupport, type CameraSupport, type CameraUnsupported } from './support'
