import { describe, expect, it } from 'vitest'
import { cropSquare, initialCrop, MAX_ZOOM, panCrop, zoomCrop } from './photo'

describe('the photo crop', () => {
  it('starts with the centre of a wide image', () => expect(cropSquare(1000, 600, initialCrop(1000, 600))).toEqual({ x: 200, y: 0, side: 600 }))
  it('starts with the centre of a tall image', () => expect(cropSquare(600, 1000, initialCrop(600, 1000))).toEqual({ x: 0, y: 200, side: 600 }))
  it('leaves a square image whole', () => expect(cropSquare(512, 512, initialCrop(512, 512))).toEqual({ x: 0, y: 0, side: 512 }))

  it('zooms in around the same centre', () => {
    const crop = zoomCrop(1000, 600, initialCrop(1000, 600), 2)
    expect(cropSquare(1000, 600, crop)).toEqual({ x: 350, y: 150, side: 300 })
  })

  it('never zooms out past the picture or in past the limit', () => {
    expect(zoomCrop(1000, 600, initialCrop(1000, 600), 0.2).zoom).toBe(1)
    expect(zoomCrop(1000, 600, initialCrop(1000, 600), 40).zoom).toBe(MAX_ZOOM)
  })

  it('moves the picture with the finger, scaled from the screen to the picture', () => {
    // A 300 px viewport shows 600 picture pixels, so dragging 50 px right shows 100 picture pixels further left.
    const crop = panCrop(1000, 600, initialCrop(1000, 600), 50, 0, 300)
    expect(cropSquare(1000, 600, crop)).toEqual({ x: 100, y: 0, side: 600 })
  })

  it('stops at the edges of the picture', () => {
    const crop = panCrop(1000, 600, initialCrop(1000, 600), 5000, 5000, 300)
    expect(cropSquare(1000, 600, crop)).toEqual({ x: 0, y: 0, side: 600 })
    expect(crop.cx).toBe(300)
  })

  it('pulls a zoomed-out crop back inside after the picture was moved to an edge', () => {
    const zoomed = panCrop(1000, 600, zoomCrop(1000, 600, initialCrop(1000, 600), 3), -5000, -5000, 300)
    expect(cropSquare(1000, 600, zoomed)).toEqual({ x: 800, y: 400, side: 200 })
    expect(cropSquare(1000, 600, zoomCrop(1000, 600, zoomed, 1))).toEqual({ x: 400, y: 0, side: 600 })
  })

  it('treats a stored crop outside the picture as its nearest edge', () => {
    expect(cropSquare(1000, 600, { zoom: 1, cx: -40, cy: 9999 })).toEqual({ x: 0, y: 0, side: 600 })
  })
})
