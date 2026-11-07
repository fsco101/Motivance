import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import bookingEn from './booking.en.json'
import bookingFil from './booking.fil.json'
import en from './en.json'
import fil from './fil.json'
import landingEn from './landing.en.json'
import landingFil from './landing.fil.json'

type Tree = { [key: string]: string | Tree }

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((all, [key, value]) => (
    typeof value === 'string' ? { ...all, [prefix + key]: value } : { ...all, ...flatten(value, `${prefix}${key}.`) }
  ), {})
}
const placeholders = (text: string) => [...text.matchAll(/{{\s*(\w+)\s*}}/g)].map((match) => match[1]).sort()

describe('English and Filipino', () => {
  const english = { ...flatten(en), ...flatten(bookingEn), ...flatten(landingEn) }
  const filipino = { ...flatten(fil), ...flatten(bookingFil), ...flatten(landingFil) }

  it('have the same keys', () => {
    expect(Object.keys(filipino).sort()).toEqual(Object.keys(english).sort())
  })

  it('keep booking text apart, so loading it can never replace other text', () => {
    expect(Object.keys(bookingEn).filter((section) => section in en)).toEqual([])
  })

  it('keep the public pages\' text apart for the same reason', () => {
    expect(Object.keys(landingEn).filter((section) => section in en || section in bookingEn)).toEqual([])
  })

  it('use the same placeholders', () => {
    for (const [key, value] of Object.entries(english)) expect([key, placeholders(filipino[key] ?? '')]).toEqual([key, placeholders(value)])
  })

  it('contain every key the code asks for', () => {
    const files = readdirSync('src', { recursive: true, encoding: 'utf8' }).filter((file) => /\.tsx?$/.test(file) && !file.includes('.test.'))
    const asked = files.flatMap((file) => [...readFileSync(join('src', file), 'utf8').matchAll(/\bt\('([a-zA-Z]+(?:\.[a-zA-Z]+)+)'/g)].map((match) => match[1]!))
    const known = (key: string) => key in english || `${key}_one` in english
    expect([...new Set(asked)].filter((key) => !known(key))).toEqual([])
  })

  it('leave nothing blank', () => {
    expect(Object.entries({ ...english, ...filipino }).filter(([, value]) => !value.trim())).toEqual([])
  })
})
