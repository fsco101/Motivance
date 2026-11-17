import { MAX_PHOTO_BYTES, PhotoFailure } from '@/data/profile'

/**
 * Edge length of the stored square photo, as on Android. It covers the largest avatar the apps draw on a dense screen,
 * and keeps a photo to a few tens of kilobytes.
 */
export const PHOTO_EDGE = 384
/** How far in the person can zoom: at most a quarter of the picture's shorter side. */
export const MAX_ZOOM = 4
/** The size a photo aims for. Quality is lowered until it fits, and the server refuses anything over MAX_PHOTO_BYTES. */
export const PHOTO_TARGET_BYTES = 60_000
/** Pictures are held at no more than this on their long side while the person crops, to keep memory low. */
const WORKING_EDGE = 2048

/** Which square of the picture is kept: how far in, and where its centre is, in the picture's own pixels. */
export type Crop = { zoom: number; cx: number; cy: number }

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

/** The whole of the shorter side, centred. */
export const initialCrop = (width: number, height: number): Crop => ({ zoom: 1, cx: width / 2, cy: height / 2 })

/** The kept square, always inside the picture. The same rules as cropSquare in Android's ProfilePhoto.kt. */
export function cropSquare(width: number, height: number, crop: Crop) {
  const side = Math.min(width, height) / clamp(crop.zoom, 1, MAX_ZOOM)
  const cx = clamp(crop.cx, side / 2, width - side / 2)
  const cy = clamp(crop.cy, side / 2, height - side / 2)
  return { x: cx - side / 2, y: cy - side / 2, side }
}

/** Keeps a crop's centre where its square stays inside the picture. */
const settle = (width: number, height: number, zoom: number, cx: number, cy: number): Crop => {
  const z = clamp(zoom, 1, MAX_ZOOM)
  const { x, y, side } = cropSquare(width, height, { zoom: z, cx, cy })
  return { zoom: z, cx: x + side / 2, cy: y + side / 2 }
}

/** Dragging the picture by (dx, dy) on a viewport `viewport` pixels wide moves it under the frame, like a finger would. */
export function panCrop(width: number, height: number, crop: Crop, dx: number, dy: number, viewport: number): Crop {
  const { side } = cropSquare(width, height, crop)
  const scale = side / Math.max(1, viewport)
  return settle(width, height, crop.zoom, crop.cx - dx * scale, crop.cy - dy * scale)
}

/** Zooming keeps the same centre, moved only as far as needed to stay inside the picture. */
export const zoomCrop = (width: number, height: number, crop: Crop, zoom: number): Crop => settle(width, height, zoom, crop.cx, crop.cy)

/** Opens a picked file upright, at no more than WORKING_EDGE on its long side. */
export async function openPhoto(file: Blob): Promise<ImageBitmap> {
  const image = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => { throw new PhotoFailure('unreadable') })
  const long = Math.max(image.width, image.height)
  if (!image.width || !image.height) { image.close(); throw new PhotoFailure('unreadable') }
  if (long <= WORKING_EDGE) return image
  const scale = WORKING_EDGE / long
  const smaller = await createImageBitmap(image, { resizeWidth: Math.round(image.width * scale), resizeHeight: Math.round(image.height * scale), resizeQuality: 'high' })
    .catch(() => null)
  if (!smaller) return image
  // The smaller copy is independent of the original, which can go.
  image.close()
  return smaller
}

const encoded = (canvas: HTMLCanvasElement, type: string, quality: number) => new Promise<Blob | null>((done) => canvas.toBlob(done, type, quality))

/**
 * Draws the kept square at PHOTO_EDGE and encodes it as small as it will go: WebP, or JPEG where the browser cannot write
 * WebP, lowering quality until it fits PHOTO_TARGET_BYTES. Drawing to a canvas also drops the original metadata, such as
 * GPS location, before the photo leaves the browser.
 */
export async function renderPhoto(image: CanvasImageSource & { width: number; height: number }, crop: Crop): Promise<Blob> {
  const { x, y, side } = cropSquare(image.width, image.height, crop)
  // A large square is halved first, so the final step does not skip pixels and look grainy.
  let source: CanvasImageSource = image
  let from = { x, y, side }
  if (side > PHOTO_EDGE * 2) {
    const step = document.createElement('canvas')
    step.width = step.height = PHOTO_EDGE * 2
    const context = step.getContext('2d')
    if (!context) throw new PhotoFailure('unreadable')
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, x, y, side, side, 0, 0, step.width, step.height)
    source = step
    from = { x: 0, y: 0, side: step.width }
  }
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = PHOTO_EDGE
  const context = canvas.getContext('2d')
  if (!context) throw new PhotoFailure('unreadable')
  // Neither format below keeps transparency well here, so a transparent PNG gets a white background instead of black.
  context.fillStyle = '#fff'
  context.fillRect(0, 0, PHOTO_EDGE, PHOTO_EDGE)
  context.imageSmoothingQuality = 'high'
  context.drawImage(source, from.x, from.y, from.side, from.side, 0, 0, PHOTO_EDGE, PHOTO_EDGE)
  let smallest: Blob | null = null
  for (const type of ['image/webp', 'image/jpeg']) {
    for (const quality of [0.8, 0.68, 0.55]) {
      const blob = await encoded(canvas, type, quality)
      // A browser that cannot write a type quietly writes PNG instead; that is never sent.
      if (!blob || blob.type !== type) break
      if (blob.size <= PHOTO_TARGET_BYTES) return blob
      if (!smallest || blob.size < smallest.size) smallest = blob
    }
  }
  if (smallest && smallest.size <= MAX_PHOTO_BYTES) return smallest
  throw new PhotoFailure('unreadable')
}
