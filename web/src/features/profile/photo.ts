import { MAX_PHOTO_BYTES, PhotoFailure } from '@/data/profile'

/** Edge length of the uploaded square photo, as on Android. Cloudinary derives display sizes from it. */
export const PHOTO_EDGE = 512

/** The centred square of an image. */
export function squareCrop(width: number, height: number) {
  const side = Math.min(width, height)
  return { x: (width - side) / 2, y: (height - side) / 2, side }
}

/**
 * Turns a picked image into an upright, centre-cropped square JPEG. Drawing it to a canvas also drops the original metadata,
 * such as GPS location, before the photo leaves the browser.
 */
export async function preparePhoto(file: Blob): Promise<Blob> {
  const image = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => { throw new PhotoFailure('unreadable') })
  const canvas = document.createElement('canvas')
  canvas.width = PHOTO_EDGE
  canvas.height = PHOTO_EDGE
  const context = canvas.getContext('2d')
  if (!context) throw new PhotoFailure('unreadable')
  const { x, y, side } = squareCrop(image.width, image.height)
  // JPEG has no transparency, so a transparent PNG gets a white background instead of black.
  context.fillStyle = '#fff'
  context.fillRect(0, 0, PHOTO_EDGE, PHOTO_EDGE)
  context.drawImage(image, x, y, side, side, 0, 0, PHOTO_EDGE, PHOTO_EDGE)
  image.close()
  const jpeg = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', 0.85))
  if (!jpeg || jpeg.size > MAX_PHOTO_BYTES) throw new PhotoFailure('unreadable')
  return jpeg
}
