import en from '@/locales/exercise.en.json'
import fil from '@/locales/exercise.fil.json'
import type { CueWords } from './cues'

type Bundle = typeof en

/**
 * The spoken phrases in one language, taken straight from that language's text. The voice can speak English on a page shown
 * in Filipino when the browser has no Filipino voice, as on Android, so the phrases are not read through the page's language.
 */
export function cueWords(bundle: Bundle): CueWords {
  const { cue } = bundle
  return {
    counted: cue.counted,
    missed: { INCOMPLETE_RANGE: cue.missedRange, TOO_FAST: cue.missedFast, TIMED_OUT: cue.missedSlow },
    targetReached: cue.targetReached, sideDone: cue.sideDone, go: cue.go, complete: cue.complete,
    sides: { LEFT: cue.left, RIGHT: cue.right },
    finishTarget: cue.finishTarget, finishShort: cue.finishShort, dayDone: cue.dayDone,
  }
}

const WORDS = { en: cueWords(en), fil: cueWords(fil) }
export const wordsIn = (language: 'en' | 'fil') => WORDS[language]
