import { useCallback, useEffect, useRef, useState } from 'react'
import { cameraErrorKind, mirrorFor, type CameraErrorKind } from './stage'

export type CameraState =
  | { status: 'idle' }
  | { status: 'starting' }
  | { status: 'live'; stream: MediaStream; mirrored: boolean; deviceId: string | null }
  | { status: 'error'; error: CameraErrorKind }

/**
 * The browser camera. 640×480 matches what Android analyses. A blocked camera starts by itself once the patient
 * allows it in the browser's site settings, without reloading the page.
 */
export function useCamera() {
  const [state, setState] = useState<CameraState>({ status: 'idle' })
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const stream = useRef<MediaStream | null>(null)
  const wanted = useRef<string | null>(null)

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
  }, [])

  const start = useCallback(async (deviceId: string | null = wanted.current) => {
    stop()
    wanted.current = deviceId
    setState({ status: 'starting' })
    try {
      const video: MediaTrackConstraints = { width: { ideal: 640 }, height: { ideal: 480 }, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) }
      const next = await navigator.mediaDevices.getUserMedia({ video, audio: false })
      stream.current = next
      const track = next.getVideoTracks()[0]
      const settings = track?.getSettings() ?? {}
      setState({ status: 'live', stream: next, mirrored: mirrorFor(settings), deviceId: settings.deviceId ?? deviceId })
      // Camera names are only listed once the patient has allowed the camera.
      const all = await navigator.mediaDevices.enumerateDevices().catch(() => [])
      setDevices(all.filter((device) => device.kind === 'videoinput'))
    } catch (error) {
      setState({ status: 'error', error: cameraErrorKind(error) })
    }
  }, [stop])

  /** Moves to the next camera, for a phone or a computer with more than one. */
  const switchCamera = useCallback(() => {
    if (state.status !== 'live' || devices.length < 2) return
    const index = devices.findIndex((device) => device.deviceId === state.deviceId)
    void start(devices[(index + 1) % devices.length]!.deviceId)
  }, [devices, start, state])

  const blocked = state.status === 'error' && state.error === 'blocked'
  useEffect(() => {
    if (!blocked || !navigator.permissions?.query) return
    let status: PermissionStatus | null = null
    let cancelled = false
    const onChange = () => { if (status?.state === 'granted') void start() }
    navigator.permissions.query({ name: 'camera' as PermissionName }).then((result) => {
      if (cancelled) return
      status = result
      result.addEventListener('change', onChange)
    }).catch(() => undefined)
    return () => { cancelled = true; status?.removeEventListener('change', onChange) }
  }, [blocked, start])

  useEffect(() => stop, [stop])

  return { state, devices, start, stop, switchCamera }
}
