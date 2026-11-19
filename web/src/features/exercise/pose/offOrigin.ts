/**
 * MediaPipe's web runtime posts usage statistics (task type and timings) to a Google address every minute. The camera
 * privacy text promises that nothing from the exercise leaves the device, so tracking runs where every request that
 * is not to this app's own address is refused. Returns the refused addresses, for diagnostics and tests.
 */
export function guardFetch(
  scope: { fetch: typeof fetch; location: { origin: string } },
  allowed: (target: URL) => boolean = (target) => target.origin === scope.location.origin,
): () => string[] {
  const inner = scope.fetch.bind(scope)
  const refused: string[] = []
  scope.fetch = (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const target = new URL(raw, scope.location.origin)
    if (!allowed(target)) {
      refused.push(target.href)
      return Promise.reject(new TypeError(`Request to ${target.origin} blocked: tracking stays on this device`))
    }
    return inner(input, init)
  }
  return () => [...refused]
}

/** MediaPipe's statistics address. The page thread also talks to Supabase, so there only this address is refused. */
export const MEDIAPIPE_STATISTICS_HOST = 'odml.pa.googleapis.com'
export const notStatistics = (target: URL) => target.hostname !== MEDIAPIPE_STATISTICS_HOST
