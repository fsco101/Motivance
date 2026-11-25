/**
 * When to ask a patient to record their sessions (#175), the same rules as Android's RecordPrompts. Recording stays the patient's
 * choice: once they agree, prescribed sessions start recorded; after Not now they are asked again at most twice, after three
 * prescribed sessions without recording and once more 30 days after that, then never. "Don't ask again" stops it sooner.
 */
export type RecordPrompt = {
  /** Agreed to the current recording agreement in this browser. */
  agreed: boolean
  /** Chose "Don't ask again". */
  never: boolean
  /** How many times they chose Not now when asked. */
  declines: number
  /** When they last chose Not now. */
  declinedAt: number | null
  /** Prescribed sessions finished without recording since they last chose Not now. */
  sessionsSince: number
}

export const NO_PROMPT: RecordPrompt = { agreed: false, never: false, declines: 0, declinedAt: null, sessionsSince: 0 }
export const ASK_AGAIN_SESSIONS = 3
export const ASK_AGAIN_DAYS = 30
const DAY = 86_400_000

export function shouldAsk(prompt: RecordPrompt, now: number) {
  if (prompt.agreed || prompt.never) return false
  if (prompt.declines === 0) return true
  if (prompt.declines === 1) return prompt.sessionsSince >= ASK_AGAIN_SESSIONS
  if (prompt.declines === 2) return prompt.declinedAt !== null && now - prompt.declinedAt >= ASK_AGAIN_DAYS * DAY
  return false
}

/** Only a question the app asked counts as one of the times; Not now on the patient's own switch does not. */
export const declined = (prompt: RecordPrompt, now: number): RecordPrompt => ({ ...prompt, declines: prompt.declines + 1, declinedAt: now, sessionsSince: 0 })
export const accepted = (prompt: RecordPrompt): RecordPrompt => ({ ...prompt, agreed: true })
export const neverAsk = (prompt: RecordPrompt): RecordPrompt => ({ ...prompt, never: true })
/** A prescribed session finished without recording. The camera check and demonstrations never count. */
export const unrecorded = (prompt: RecordPrompt): RecordPrompt => (prompt.agreed ? prompt : { ...prompt, sessionsSince: prompt.sessionsSince + 1 })

/** The version of the recording agreement. v2 says recording starts on once agreed (#175), so v1's agreement is asked for again. */
export const CONSENT_VERSION = 'web-2'
const promptKey = (owner: string) => `motivance.video.prompt:${owner}`

export function readPrompt(owner: string, store: Pick<Storage, 'getItem'> | null = storage()): RecordPrompt {
  try {
    const raw = store?.getItem(promptKey(owner))
    if (!raw) return NO_PROMPT
    const parsed = JSON.parse(raw) as Partial<RecordPrompt> & { version?: string }
    return {
      agreed: parsed.agreed === true && parsed.version === CONSENT_VERSION, never: parsed.never === true,
      declines: Number.isInteger(parsed.declines) ? Math.max(0, parsed.declines!) : 0,
      declinedAt: typeof parsed.declinedAt === 'number' ? parsed.declinedAt : null,
      sessionsSince: Number.isInteger(parsed.sessionsSince) ? Math.max(0, parsed.sessionsSince!) : 0,
    }
  } catch { return NO_PROMPT }
}

export function writePrompt(owner: string, prompt: RecordPrompt, store: Pick<Storage, 'setItem'> | null = storage()) {
  try { store?.setItem(promptKey(owner), JSON.stringify({ ...prompt, version: CONSENT_VERSION })) } catch { /* Asked again next time. */ }
}

function storage() {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}
