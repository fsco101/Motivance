import { describe, expect, it } from 'vitest'
import en from '@/locales/exercise.en.json'
import fil from '@/locales/exercise.fil.json'
import { chimeSamples, CHIME } from './chime'
import { chooseVoice, CuePlayer, finishLine, readSound, RepCueScript, setCueLine, SOUND_KEYS, writeSound, type CueUtterance, type CueVoice, type Speaker } from './cues'
import { cueWords } from './words'

const ENGLISH = cueWords(en)
const FILIPINO = cueWords(fil)

/** A voice that speaks one phrase at a time and queues the rest, as speechSynthesis does. */
class FakeSpeaker implements Speaker {
  queue: CueUtterance[] = []
  spoken: string[] = []
  /** The most phrases ever waiting or playing at once. */
  most = 0
  constructor(private readonly voices: CueVoice[]) {}
  getVoices() { return this.voices }
  speak(utterance: CueUtterance) { this.queue.push(utterance); this.most = Math.max(this.most, this.queue.length) }
  cancel() { const dropped = this.queue; this.queue = []; dropped.forEach((u) => u.onerror?.()) }
  /** The playing phrase ends. */
  end() { const done = this.queue.shift(); if (done) { this.spoken.push(done.text); done.onend?.() } }
}
const make = (text: string): CueUtterance => ({ text, lang: '', voice: null, onend: null, onerror: null })
const US: CueVoice = { lang: 'en-US', name: 'English', localService: true }
const words = (language: 'en' | 'fil') => (language === 'fil' ? FILIPINO : ENGLISH)

describe('spoken cues', () => {
  it('say the same as Android in both languages', () => {
    expect(ENGLISH.counted).toEqual(['Great!', 'Excellent!', 'Nice!', 'Well done!', 'Good job!'])
    expect(FILIPINO.counted).toEqual(['Magaling!', 'Napakahusay!', 'Ayos!', 'Mahusay!', 'Galing mo!'])
    const script = new RepCueScript(ENGLISH)
    expect(script.lineFor({ type: 'missed', reason: 'INCOMPLETE_RANGE' })).toBe('Try again. Reach the target and hold it.')
    expect(script.lineFor({ type: 'missed', reason: 'TOO_FAST' })).toBe('Try again, a little slower.')
    expect(script.lineFor({ type: 'missed', reason: 'TIMED_OUT' })).toBe('Try again from the start.')
    expect(new RepCueScript(FILIPINO).lineFor({ type: 'missed', reason: 'TOO_FAST' })).toBe('Subukan ulit, mas mabagal nang kaunti.')
    expect(setCueLine(ENGLISH, { type: 'sideDone', done: 'LEFT', next: 'RIGHT' }, 'Elbow flexion')).toBe('Left side done. Next: Right side, Elbow flexion.')
    expect(setCueLine(FILIPINO, { type: 'sideDone', done: 'LEFT', next: 'RIGHT' }, 'Elbow flexion')).toBe('Tapos na ang Kaliwang bahagi. Susunod: Kanang bahagi, Elbow flexion.')
    expect(setCueLine(ENGLISH, { type: 'count', n: 3 }, '')).toBe('3')
    expect(setCueLine(ENGLISH, { type: 'go' }, '')).toBe('Start.')
    expect(setCueLine(FILIPINO, { type: 'complete' }, '')).toBe('Tapos na ang ehersisyo.')
    expect(setCueLine(ENGLISH, { type: 'targetReached' }, '')).toBe('Target reached. Keep going until the time is up.')
    expect(finishLine(ENGLISH, 10, 10, false)).toBe('Great work! Exercise finished.')
    expect(finishLine(ENGLISH, 6, 10, true)).toBe('Good effort today: 6 of 10. That was today’s last exercise.')
    expect(finishLine(FILIPINO, 6, 10, false)).toBe('Mahusay na pagsisikap ngayong araw: 6 sa 10.')
  })

  it('never repeat the praise just spoken', () => {
    let roll = 0
    const script = new RepCueScript(ENGLISH, () => [0, 0, 0.99, 0.99, 0.5][roll++ % 5]!)
    const lines = Array.from({ length: 5 }, () => script.lineFor({ type: 'counted', count: 1 }))
    lines.slice(1).forEach((line, i) => expect(line).not.toBe(lines[i]))
  })

  it('choose the app language when the browser can speak it, else English, else text only', () => {
    const tagalog: CueVoice = { lang: 'tl_PH', name: 'Tagalog' }
    expect(chooseVoice('fil', [US, tagalog])).toEqual({ voice: tagalog, text: 'fil' })
    expect(chooseVoice('fil', [US])).toEqual({ voice: US, text: 'en' })
    expect(chooseVoice('en', [{ lang: 'en-GB', name: 'UK' }])?.text).toBe('en')
    expect(chooseVoice('en', [{ lang: 'ja-JP', name: 'Japanese' }])).toBeNull()
  })

  it('never let phrases overlap when repetitions come quickly', () => {
    const speaker = new FakeSpeaker([US])
    const player = new CuePlayer(speaker, make, 'en', words)
    player.unlock()
    for (let i = 0; i < 6; i++) player.play({ type: 'counted', count: i + 1 })
    expect(speaker.most).toBe(1)
    expect(speaker.queue).toHaveLength(1)
    player.play({ type: 'missed', reason: 'TOO_FAST' })
    speaker.end()
    expect(speaker.spoken).toEqual(['Try again, a little slower.'])
  })

  it('let a set announcement wait for the last result, and say when it has been said', () => {
    const speaker = new FakeSpeaker([US])
    const player = new CuePlayer(speaker, make, 'en', words)
    player.unlock()
    let announced = 0
    player.play({ type: 'counted', count: 3 })
    player.announce({ type: 'sideDone', done: 'LEFT', next: 'RIGHT' }, 'Elbow flexion', () => announced++)
    expect(speaker.queue).toHaveLength(2)
    speaker.end()
    expect(announced).toBe(0)
    speaker.end()
    expect(announced).toBe(1)
    // A cut-off announcement counts as said, so the countdown never waits for it.
    player.announce({ type: 'sideDone', done: 'LEFT', next: 'RIGHT' }, 'Elbow flexion', () => announced++)
    player.play({ type: 'counted', count: 1 })
    expect(announced).toBe(2)
  })

  it('stay silent until the patient presses something, and without a voice hand back the words to show', () => {
    const speaker = new FakeSpeaker([US])
    const player = new CuePlayer(speaker, make, 'en', words)
    player.play({ type: 'counted', count: 1 })
    expect(speaker.queue).toHaveLength(0)
    const silent = new CuePlayer(new FakeSpeaker([]), make, 'fil', words)
    silent.unlock()
    expect(silent.speaks).toBe(false)
    let announced = false
    expect(silent.announce({ type: 'go' }, '', () => { announced = true })).toBe('Simulan.')
    expect(announced).toBe(true)
  })

  it('remember voice off and sound off', () => {
    const store = new Map<string, string>()
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } }
    expect(readSound(SOUND_KEYS.voice, storage)).toBe(true)
    writeSound(SOUND_KEYS.voice, false, storage)
    writeSound(SOUND_KEYS.finish, false, storage)
    expect(readSound(SOUND_KEYS.voice, storage)).toBe(false)
    expect(readSound(SOUND_KEYS.finish, storage)).toBe(false)
    writeSound(SOUND_KEYS.finish, true, storage)
    expect(readSound(SOUND_KEYS.finish, storage)).toBe(true)
    const broken = { getItem: () => { throw new Error('blocked') } }
    expect(readSound(SOUND_KEYS.voice, broken)).toBe(true)
  })
})

describe('the finish tune', () => {
  it('plays Android\'s four notes, starting and ending at silence', () => {
    const samples = chimeSamples()
    expect(samples.length).toBe(CHIME.notes.reduce((sum, [, ms]) => sum + Math.floor((CHIME.sampleRate * ms) / 1000), 0))
    expect(samples[0]).toBe(0)
    expect(Math.abs(samples[samples.length - 1]!)).toBeLessThan(1e-3)
    expect(Math.max(...samples.map(Math.abs))).toBeLessThanOrEqual(CHIME.loudness)
  })
})
