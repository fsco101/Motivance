import { MagnifyingGlassMinusIcon, MagnifyingGlassPlusIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { Dialog } from '@/components/Dialog'
import { PhotoFailure } from '@/data/profile'
import { cropSquare, initialCrop, MAX_ZOOM, openPhoto, panCrop, renderPhoto, zoomCrop, type Crop } from './photo'

/** The preview is drawn at twice its largest displayed size, so it stays sharp on dense screens. */
const PREVIEW = 576

type Props = {
  /** The picked file; the dialog is open while there is one. */
  file: File | null
  onCancel: () => void
  /** Receives the cropped, shrunk photo, ready to upload. */
  onConfirm: (photo: Blob) => void
  onUnreadable: () => void
}

/**
 * Lets the person choose which square of their picture becomes the photo: drag, pinch, scroll or use the slider to zoom, or
 * the arrow and plus/minus keys. The circle shows what avatars will show; the corners outside it are kept too.
 */
export function PhotoCropper({ file, onCancel, onConfirm, onUnreadable }: Props) {
  const { t } = useTranslation()
  const canvas = useRef<HTMLCanvasElement>(null)
  const [image, setImage] = useState<ImageBitmap | null>(null)
  const [crop, setCrop] = useState<Crop>({ zoom: 1, cx: 0, cy: 0 })
  const [busy, setBusy] = useState(false)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ distance: number; zoom: number } | null>(null)

  useEffect(() => {
    if (!file) return
    let live = true
    let opened: ImageBitmap | null = null
    openPhoto(file).then((bitmap) => {
      opened = bitmap
      if (!live) return bitmap.close()
      setImage(bitmap)
      setCrop(initialCrop(bitmap.width, bitmap.height))
    }, () => { if (live) onUnreadable() })
    return () => {
      live = false
      opened?.close()
      setImage(null)
      setBusy(false)
    }
    // onUnreadable is a fresh closure on each render; the file alone decides when to open a picture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  useEffect(() => {
    const context = canvas.current?.getContext('2d')
    if (!context || !image) return
    const { x, y, side } = cropSquare(image.width, image.height, crop)
    context.clearRect(0, 0, PREVIEW, PREVIEW)
    context.fillStyle = '#fff'
    context.fillRect(0, 0, PREVIEW, PREVIEW)
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, x, y, side, side, 0, 0, PREVIEW, PREVIEW)
    // Shade the corners avatars do not show, and outline the circle they do.
    context.beginPath()
    context.rect(0, 0, PREVIEW, PREVIEW)
    context.arc(PREVIEW / 2, PREVIEW / 2, PREVIEW / 2 - 2, 0, Math.PI * 2, true)
    context.fillStyle = 'rgba(15, 23, 42, 0.5)'
    context.fill('evenodd')
    context.beginPath()
    context.arc(PREVIEW / 2, PREVIEW / 2, PREVIEW / 2 - 2, 0, Math.PI * 2)
    context.lineWidth = 3
    context.strokeStyle = 'rgba(255, 255, 255, 0.9)'
    context.stroke()
  }, [image, crop])

  // Wheel zoom needs a listener that may cancel scrolling, which React's onWheel cannot be.
  useEffect(() => {
    const element = canvas.current
    if (!element || !image) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      setCrop((current) => zoomCrop(image.width, image.height, current, current.zoom * Math.exp(-event.deltaY * 0.0015)))
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [image])

  const viewport = () => canvas.current?.getBoundingClientRect().width ?? PREVIEW
  const spread = () => {
    const [a, b] = [...pointers.current.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }

  const down = (event: PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size === 2) pinch.current = { distance: spread(), zoom: crop.zoom }
  }
  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    const last = pointers.current.get(event.pointerId)
    if (!last || !image) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size >= 2 && pinch.current && pinch.current.distance > 0) {
      const zoom = pinch.current.zoom * (spread() / pinch.current.distance)
      setCrop((current) => zoomCrop(image.width, image.height, current, zoom))
    } else if (pointers.current.size === 1) {
      const width = viewport()
      setCrop((current) => panCrop(image.width, image.height, current, event.clientX - last.x, event.clientY - last.y, width))
    }
  }
  const up = (event: PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(event.pointerId)
    if (pointers.current.size < 2) pinch.current = null
  }

  const key = (event: KeyboardEvent<HTMLCanvasElement>) => {
    if (!image) return
    const step = viewport() / 20
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }
    const shift = moves[event.key]
    if (shift) {
      event.preventDefault()
      setCrop((current) => panCrop(image.width, image.height, current, shift[0], shift[1], viewport()))
    } else if (event.key === '+' || event.key === '=' || event.key === '-') {
      event.preventDefault()
      setCrop((current) => zoomCrop(image.width, image.height, current, current.zoom * (event.key === '-' ? 1 / 1.15 : 1.15)))
    }
  }

  const confirm = async () => {
    if (!image) return
    setBusy(true)
    try {
      onConfirm(await renderPhoto(image, crop))
    } catch (failure) {
      if (failure instanceof PhotoFailure) onUnreadable()
      else throw failure
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={file !== null} onOpenChange={(open) => { if (!open) onCancel() }} title={t('profile.cropTitle')} description={t('profile.cropHelp')}>
      <div className="flex flex-col items-center gap-4">
        <canvas ref={canvas} width={PREVIEW} height={PREVIEW} tabIndex={0} role="img" aria-label={t('profile.cropArea')}
          aria-busy={!image} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}
          className="aspect-square w-full max-w-72 cursor-grab touch-none select-none rounded-card bg-tide outline-offset-4 active:cursor-grabbing" />
        <label className="flex w-full max-w-72 items-center gap-3">
          <MagnifyingGlassMinusIcon aria-hidden className="shrink-0 text-slate" />
          <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={crop.zoom} disabled={!image} aria-label={t('profile.cropZoom')}
            onChange={(event) => { if (image) setCrop((current) => zoomCrop(image.width, image.height, current, Number(event.target.value))) }}
            className="min-w-0 flex-1 accent-lagoon" />
          <MagnifyingGlassPlusIcon aria-hidden className="shrink-0 text-slate" />
        </label>
      </div>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" disabled={busy} onClick={onCancel}>{t('common.cancel')}</Button>
        <Button disabled={!image} busy={busy} busyLabel={t('profile.cropPreparing')} onClick={() => void confirm()}>{t('profile.cropUse')}</Button>
      </div>
    </Dialog>
  )
}
