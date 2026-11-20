import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { CameraDiagnostics, MovementAssessment, slowCamera, type AssessmentSnapshot, type DiagnosticsSnapshot, type ExerciseRules, type Landmark } from '../assessment'
import type { TrackedFrame } from '../pose'

/** Loads MediaPipe only when a camera page asks for it, so it never weighs on the rest of the app. */
const loadPose = () => import('../pose')

/** Starts loading body tracking in the background, for example when the patient opens the camera check. */
export function usePreparedTracking() {
  useEffect(() => { void loadPose().then((pose) => pose.preparePoseTracking()).catch(() => undefined) }, [])
}

export type TrackingStatus = 'loading' | 'ready' | 'failed'

interface Handlers {
  ready: (delegate: 'GPU' | 'CPU') => void
  failed: () => void
  frame: (frame: TrackedFrame) => void
  pause: () => void
}

/** Plays the camera in the hidden video element and runs tracking on it. Returns a function that stops both. */
function startTracking(element: HTMLVideoElement, stream: MediaStream, on: Handlers): () => void {
  let loop: { stop(): void } | null = null
  let cancelled = false
  element.srcObject = stream
  void element.play().catch(() => undefined)
  loadPose().then(async (pose) => {
    const host = await pose.preparePoseTracking()
    if (cancelled) return
    on.ready(host.delegate)
    const running = new pose.FrameLoop({ video: element, detector: host, diagnostics: new CameraDiagnostics(), onFrame: on.frame, onPause: on.pause })
    loop = running
    running.start()
  }).catch(() => { if (!cancelled) on.failed() })
  return () => { cancelled = true; loop?.stop(); element.srcObject = null }
}

interface Options {
  video: RefObject<HTMLVideoElement | null>
  stream: MediaStream | null
  /** Measures one frame and returns the engine's snapshot for drawing. */
  process: (frame: TrackedFrame) => AssessmentSnapshot
  /** Called once when measuring must stop because the tab is hidden. */
  onHidden: () => void
  /** Draws each accepted frame straight away, before its picture is freed. */
  draw: (frame: TrackedFrame, snapshot: AssessmentSnapshot) => void
}

/**
 * Runs body tracking on the camera and hands each frame to `process`, which owns the measurement engine. While the
 * tab is hidden it calls `onHidden`, standing in for Android's heat pause.
 */
export function useTracking({ video, stream, process, onHidden, draw }: Options) {
  const [status, setStatus] = useState<TrackingStatus>('loading')
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot | null>(null)
  const [delegate, setDelegate] = useState<'GPU' | 'CPU' | null>(null)
  const [hiddenPause, setHiddenPause] = useState(false)
  const [frameSeen, setFrameSeen] = useState<MediaStream | null>(null)
  const [points, setPoints] = useState<Landmark[] | null>(null)
  const latest = useRef({ draw, process, onHidden })
  useEffect(() => { latest.current = { draw, process, onHidden } }, [draw, process, onHidden])

  useEffect(() => {
    const element = video.current
    if (!stream || !element) return
    return startTracking(element, stream, {
      ready: (used) => { setDelegate(used); setStatus('ready') },
      failed: () => setStatus('failed'),
      frame: (frame) => {
        const snapshot = latest.current.process(frame)
        latest.current.draw(frame, snapshot)
        frame.image.close()
        setHiddenPause(false)
        setDiagnostics(frame.diagnostics)
        setFrameSeen(stream)
        setPoints(frame.people.length === 1 ? frame.people[0]! : null)
      },
      pause: () => { setHiddenPause(true); latest.current.onHidden() },
    })
  }, [stream, video])

  return {
    status, diagnostics, delegate, hiddenPause, points,
    /** A frame from the current camera has been drawn. Switching camera starts over. */
    hasFrame: stream !== null && frameSeen === stream,
    slow: diagnostics ? slowCamera(diagnostics) : false,
  }
}

/** A preview engine for the camera check: measures, never starts, and keeps its snapshot as React state. */
export function usePreviewEngine(rules: ExerciseRules) {
  const engine = useRef<MovementAssessment | null>(null)
  const [snapshot, setSnapshot] = useState<AssessmentSnapshot>(() => new MovementAssessment(rules).snapshot)
  const process = useCallback((frame: TrackedFrame) => {
    const current = (engine.current ??= new MovementAssessment(rules))
    const next = current.process(frame.people, frame.width, frame.height, frame.timestampMs)
    setSnapshot(next)
    return next
  }, [rules])
  const onHidden = useCallback(() => { if (engine.current) setSnapshot(engine.current.pause(Math.round(performance.now()))) }, [])
  return { snapshot, process, onHidden }
}
