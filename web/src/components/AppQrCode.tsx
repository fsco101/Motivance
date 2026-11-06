import { useEffect, useState } from 'react'
import { Skeleton } from './Display'

/** The Android app's address, if one is configured. The app is not on Google Play yet, so this can be unset. */
export function appUrl() {
  const url = import.meta.env.VITE_ANDROID_APP_URL as string | undefined
  return url?.startsWith('https://') ? url : null
}

type Code = { path: string; size: number }

/** Drawn as one SVG path. The library arrives only with this component, so it stays out of the first download. */
export function AppQrCode({ url, label, size = 148 }: { url: string; label: string; size?: number }) {
  const [code, setCode] = useState<Code | null>(null)
  useEffect(() => {
    let current = true
    void import('qrcode-generator').then(({ default: qrcode }) => {
      const qr = qrcode(0, 'M')
      qr.addData(url)
      qr.make()
      const count = qr.getModuleCount()
      let path = ''
      for (let row = 0; row < count; row += 1) for (let column = 0; column < count; column += 1) if (qr.isDark(row, column)) path += `M${column} ${row}h1v1h-1z`
      if (current) setCode({ path, size: count })
    })
    return () => { current = false }
  }, [url])
  if (!code) return <Skeleton className="shrink-0 rounded-md" />
  // A quiet zone of four modules, which scanners need, on a white ground whatever the page behind it.
  return (
    <svg role="img" aria-label={label} viewBox={`-4 -4 ${code.size + 8} ${code.size + 8}`} width={size} height={size} shapeRendering="crispEdges" className="shrink-0 rounded-md bg-white text-black">
      <path d={code.path} fill="currentColor" />
    </svg>
  )
}
