import { describe, expect, it } from 'vitest'
import { squareCrop } from './photo'

describe('the photo crop', () => {
  it('takes the centre of a wide image', () => expect(squareCrop(1000, 600)).toEqual({ x: 200, y: 0, side: 600 }))
  it('takes the centre of a tall image', () => expect(squareCrop(600, 1000)).toEqual({ x: 0, y: 200, side: 600 }))
  it('leaves a square image alone', () => expect(squareCrop(512, 512)).toEqual({ x: 0, y: 0, side: 512 }))
})
