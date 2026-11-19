import { useEffect, useRef, useState, type RefObject } from 'react'
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
  rules: ExerciseRules
  /** Draws each accepted frame straight away, before its picture is freed. */
  draw: (frame: TrackedFrame, snapshot: AssessmentSnapshot) => void
}

/**
 * Feeds each tracked camera frame to the shared measurement engine. The page reads the engine through `engine` to
 * start or pause measuring. While the tab is hidden measuring pauses, standing in for Android's heat pause.
 */
export function useTracking({ video, stream, rules, draw }: Options) {
  const [status, setStatus] = useState<TrackingStatus>('loading')
  const [snapshot, setSnapshot] = useState<AssessmentSnapshot>(() => new MovementAssessment(rules).snapshot)
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot | null>(null)
  const [delegate, setDelegate] = useState<'GPU' | 'CPU' | null>(null)
  const [hiddenPause, setHiddenPause] = useState(false)
  const [frameSeen, setFrameSeen] = useState<MediaStream | null>(null)
  const [points, setPoints] = useState<Landmark[] | null>(null)
  const engine = useRef<MovementAssessment | null>(null)
  const latest = useRef({ draw, rules })
  useEffect(() => { latest.current = { draw, rules } }, [draw, rules])

  useEffect(() => {
    const next = new MovementAssessment(rules)
    engine.current = next
  }, [rules])

  useEffect(() => {
    const element = video.current
    if (!stream || !element) return
    return startTracking(element, stream, {
      ready: (used) => { setDelegate(used); setStatus('ready') },
      failed: () => setStatus('failed'),
      frame: (frame) => {
        const current = engine.current ??= new MovementAssessment(latest.current.rules)
        const next = current.process(frame.people, frame.width, frame.height, frame.timestampMs)
        latest.current.draw(frame, next)
        frame.image.close()
        setHiddenPause(false)
        setSnapshot(next)
        setDiagnostics(frame.diagnostics)
        setFrameSeen(stream)
        setPoints(frame.people.length === 1 ? frame.people[0]! : null)
      },
      pause: () => {
        setHiddenPause(true)
        if (engine.current) setSnapshot(engine.current.pause(performance.now()))
      },
    })
  }, [stream, video])

  return {
    status, snapshot, diagnostics, delegate, hiddenPause, points, engine,
    /** A frame from the current camera has been drawn. Switching camera starts over. */
    hasFrame: stream !== null && frameSeen === stream,
    slow: diagnostics ? slowCamera(diagnostics) : false,
  }
}
