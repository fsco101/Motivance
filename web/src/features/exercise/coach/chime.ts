/**
 * The finish tune (FinishChime on Android, #130): a short rising arpeggio, C5 E5 G5 then a held C6, made from sine waves.
 * The samples are the phone's, so both apps play the same sound. Each note starts and ends at silence, so nothing clicks.
 */
export const CHIME = {
  sampleRate: 44_100,
  /** Frequency in hertz and length in milliseconds. */
  notes: [[523.25, 110], [659.25, 110], [783.99, 110], [1046.5, 340]] as const,
  loudness: 0.32,
}

export function chimeSamples(sampleRate: number = CHIME.sampleRate) {
  const total = CHIME.notes.reduce((sum, [, ms]) => sum + Math.floor((sampleRate * ms) / 1000), 0)
  const out = new Float32Array(total)
  let at = 0
  for (const [frequency, ms] of CHIME.notes) {
    const count = Math.floor((sampleRate * ms) / 1000)
    for (let i = 0; i < count; i += 1) {
      const t = i / sampleRate
      // A quick rise, then a bell-like fall that reaches silence at the end of the note.
      const attack = Math.min(1, i / (sampleRate * 0.008))
      const decay = Math.exp((-4 * i) / count) * (1 - i / count)
      const wave = Math.sin(2 * Math.PI * frequency * t) + 0.3 * Math.sin(4 * Math.PI * frequency * t)
      out[at++] = (wave / 1.3) * attack * decay * CHIME.loudness
    }
  }
  return out
}

type AudioContextClass = typeof AudioContext

/**
 * Plays the tune with the Web Audio API. The audio context is made on the patient's first press, because browsers only
 * allow sound after one; until then `play` does nothing.
 */
export class ChimePlayer {
  private context: AudioContext | null = null
  private buffer: AudioBuffer | null = null

  constructor(private readonly Context: AudioContextClass | null = typeof window === 'undefined' ? null : window.AudioContext ?? null) {}

  /** Call from a press. */
  unlock() {
    if (!this.Context) return
    try {
      this.context ??= new this.Context()
      if (this.context.state === 'suspended') void this.context.resume()
    } catch { this.context = null }
  }

  play() {
    const context = this.context
    if (!context) return
    try {
      if (!this.buffer) {
        const samples = chimeSamples(context.sampleRate)
        this.buffer = context.createBuffer(1, samples.length, context.sampleRate)
        this.buffer.copyToChannel(samples, 0)
      }
      const source = context.createBufferSource()
      source.buffer = this.buffer
      source.connect(context.destination)
      source.start()
    } catch { /* No sound is better than a broken finish. */ }
  }

  /** Closes the audio. The next press opens it again, so a page shown again still plays. */
  release() {
    void this.context?.close().catch(() => undefined)
    this.context = null
    this.buffer = null
  }
}
