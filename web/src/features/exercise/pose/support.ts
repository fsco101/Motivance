/** Why this browser cannot run the camera exercise. Any reason shows the "use another browser or the phone" dialog instead. */
export type CameraUnsupported = 'insecure' | 'no-camera' | 'unsupported'
export type CameraSupport = { ok: true } | { ok: false; reason: CameraUnsupported }

interface Environment {
  isSecureContext?: boolean
  WebAssembly?: unknown
  createImageBitmap?: unknown
  navigator?: { mediaDevices?: { getUserMedia?: unknown } }
  HTMLVideoElement?: { prototype: { requestVideoFrameCallback?: unknown } }
}

/** Camera access needs a secure page; tracking needs WebAssembly, image bitmaps and a callback for each new video frame. */
export function cameraSupport(env: Environment = globalThis as unknown as Environment): CameraSupport {
  if (!env.isSecureContext) return { ok: false, reason: 'insecure' }
  if (typeof env.navigator?.mediaDevices?.getUserMedia !== 'function') return { ok: false, reason: 'no-camera' }
  if (!env.WebAssembly || typeof env.createImageBitmap !== 'function') return { ok: false, reason: 'unsupported' }
  if (typeof env.HTMLVideoElement?.prototype.requestVideoFrameCallback !== 'function') return { ok: false, reason: 'unsupported' }
  return { ok: true }
}
