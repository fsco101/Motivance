import { describe, expect, it } from 'vitest'
import { photoAddress } from './photos'

const PATH = '00000000-0000-0000-0000-000000000000/0123456789abcdef0123456789abcdef.webp'

describe('profile photo addresses', () => {
  it('joins a stored path to the backend', () => {
    expect(photoAddress(PATH, 'https://example.supabase.co/')).toBe(`https://example.supabase.co/storage/v1/object/public/avatars/${PATH}`)
  })
  it('accepts JPEG photos too', () => expect(photoAddress(PATH.replace('.webp', '.jpg'), 'http://127.0.0.1:54321')).toContain('.jpg'))
  it('never follows anything else', () => {
    for (const value of [null, '', 'https://res.cloudinary.com/x/image/upload/v1/a', `../${PATH}`, `${PATH}?x=1`, PATH.replace('.webp', '.png')]) {
      expect(photoAddress(value, 'http://127.0.0.1:54321')).toBeNull()
    }
  })
  it('needs a backend', () => expect(photoAddress(PATH, '')).toBeNull())
})
