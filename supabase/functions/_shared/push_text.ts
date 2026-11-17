/**
 * Push words for the notifications that are not about one session: exercise plans, finished sessions, the daily practice reminder,
 * inactivity and care-team changes. These never send email, so they have no email sentence to share. Booking kinds keep using the
 * email's words. Plain functions with no Deno in them, so the web tests can run them directly.
 */
import type { Language } from './email.ts'

export type CareFacts = {
  therapist_name?: string | null; patient_name?: string | null; completed?: number | null; target?: number | null; days?: number | null; sender_name?: string | null; conversation_id?: string | null
  /** A missed exercise day (#128): the calendar day, and how many of the exercises due were done. */
  day?: string | null; due?: number | null; done?: number | null
}
type Line = { title: string; body: string }

/** The same sentences the apps show in the bell, so a push and its bell row say the same thing. */
const LINES: Record<Language, Record<string, Line>> = {
  en: {
    plan_updated: { title: 'Your exercise plan has changed', body: '{therapist} updated your exercise plan.' },
    session_finished: { title: 'Session finished: {patient}', body: '{patient} finished a session: {completed} of {target} repetitions.' },
    practice_reminder: { title: 'Time for your exercises', body: 'You have exercises left to do today. Your plan is ready when you are.' },
    patient_inactive: { title: 'No exercise for {days} days: {patient}', body: '{patient} has not exercised for {days} days.' },
    exercise_missed: { title: 'Missed exercises: {patient}', body: '{patient} missed exercises on {day}. Done: {done} of {due}.' },
    care_linked: { title: 'You have a therapist', body: '{therapist} is now your therapist.' },
    care_unlinked: { title: 'Your therapist link has ended', body: '{therapist} is no longer linked to your account.' },
    patient_linked: { title: 'New patient: {patient}', body: '{patient} is now linked to you.' },
    patient_unlinked: { title: 'Patient link ended: {patient}', body: '{patient} is no longer linked to you.' },
    // Never the message itself: only that there is one, and from whom.
    chat_message: { title: 'New message from {sender}', body: 'Open Motivance to read it.' },
  },
  fil: {
    plan_updated: { title: 'Nagbago ang iyong plano ng ehersisyo', body: 'Binago ni {therapist} ang iyong plano ng ehersisyo.' },
    session_finished: { title: 'Tapos ang session: {patient}', body: 'Natapos ni {patient} ang isang session: {completed} sa {target} na pag-ulit.' },
    practice_reminder: { title: 'Oras na para mag-ehersisyo', body: 'May natitira ka pang ehersisyo ngayong araw. Handa na ang iyong plano.' },
    patient_inactive: { title: '{days} araw nang walang ehersisyo: {patient}', body: '{days} araw nang hindi nag-eehersisyo si {patient}.' },
    exercise_missed: { title: 'May hindi nagawang ehersisyo: {patient}', body: 'May hindi nagawang ehersisyo si {patient} noong {day}. Nagawa: {done} sa {due}.' },
    care_linked: { title: 'May therapist ka na', body: 'Si {therapist} na ang iyong therapist.' },
    care_unlinked: { title: 'Natapos ang link sa iyong therapist', body: 'Hindi na naka-link si {therapist} sa iyong account.' },
    patient_linked: { title: 'Bagong pasyente: {patient}', body: 'Naka-link na sa iyo si {patient}.' },
    patient_unlinked: { title: 'Natapos ang link: {patient}', body: 'Hindi na naka-link sa iyo si {patient}.' },
    chat_message: { title: 'Bagong mensahe mula kay {sender}', body: 'Buksan ang Motivance para basahin ito.' },
  },
}

export const CARE_KINDS: ReadonlySet<string> = new Set(Object.keys(LINES.en))

/** A calendar day as the apps write it, "Tue, Nov 17". It has no time, so it is read in UTC and never shifts a day. */
const calendarDay = (day: string, language: Language) =>
  new Intl.DateTimeFormat(language === 'fil' ? 'fil-PH' : 'en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`))

/** A title is one line on a lock screen, so a name must not be able to start another. */
const oneLine = (value: string) => value.replace(/[\r\n]+/g, ' ').trim()

/** Null for a kind that is not one of these, so the caller falls back to the booking words. */
export function careText(kind: string, language: Language, data: CareFacts): { title: string; body: string } | null {
  const line = (LINES[language] ?? LINES.en)[kind]
  if (!line) return null
  const values: Record<string, string> = {
    therapist: data.therapist_name ?? '', patient: data.patient_name ?? '',
    completed: String(data.completed ?? 0), target: String(data.target ?? 0), days: String(data.days ?? 0), sender: data.sender_name ?? '',
    day: data.day ? calendarDay(data.day, language) : '', due: String(data.due ?? 0), done: String(data.done ?? 0),
  }
  const fill = (template: string) => template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '')
  return { title: oneLine(fill(line.title)), body: fill(line.body) }
}
