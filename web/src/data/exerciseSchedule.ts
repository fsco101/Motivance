import type { SupabaseClient } from '@supabase/supabase-js'
import { addDays } from './booking'
import type { Database } from './database.types'
import { prescriptionArguments, type PrescriptionRequest } from './therapist'
import { must } from './workspace'

type Db = SupabaseClient<Database>

/** ISO weekdays: 1 is Monday and 7 is Sunday, as the server stores them. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7
export const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7]
/** A schedule is at most this many days long, first and last included. */
export const MAX_SCHEDULE_DAYS = 366

/** A therapist's calendar for some of a patient's exercises. Dates are calendar days at the center, "YYYY-MM-DD". */
export type ExerciseSchedule = {
  id: string; patientId: string; therapistId: string; therapistName: string
  startsOn: string; endsOn: string; restWeekdays: Weekday[]; restDates: string[]
  exerciseDays: number; restDays: number; exerciseCount: number
}

export type ScheduleState = 'upcoming' | 'exercise' | 'rest' | 'ended'
/** A schedule as it stands on one day. */
export type ScheduleOnDay = ExerciseSchedule & { state: ScheduleState; daysLeft: number; nextDay: string | null }
/** One active exercise on one day. An exercise without a schedule is due every day. */
export type DayExercise = { assignmentId: string; scheduleId: string | null; therapistId: string; due: boolean; done: boolean }
export type ExerciseDay = { day: string; exercises: DayExercise[]; schedules: ScheduleOnDay[] }

type RawSchedule = {
  id: string; patient_id: string; therapist_id: string; therapist_name: string | null; starts_on: string; ends_on: string
  rest_weekdays: number[]; rest_dates: string[]; exercise_days: number; rest_days: number; exercise_count: number
}
type RawDay = {
  day: string
  exercises: Array<{ assignment_id: string; schedule_id: string | null; therapist_id: string; due: boolean; done: boolean }>
  schedules: Array<RawSchedule & { state: ScheduleState; days_left: number; next_day: string | null }>
}

export const decodeSchedule = (raw: RawSchedule): ExerciseSchedule => ({
  id: raw.id, patientId: raw.patient_id, therapistId: raw.therapist_id, therapistName: raw.therapist_name ?? '',
  startsOn: raw.starts_on, endsOn: raw.ends_on, restWeekdays: raw.rest_weekdays.filter((day): day is Weekday => day >= 1 && day <= 7), restDates: [...raw.rest_dates],
  exerciseDays: raw.exercise_days, restDays: raw.rest_days, exerciseCount: raw.exercise_count,
})

export const decodeExerciseDay = (raw: RawDay): ExerciseDay => ({
  day: raw.day,
  exercises: raw.exercises.map((item) => ({ assignmentId: item.assignment_id, scheduleId: item.schedule_id, therapistId: item.therapist_id, due: item.due, done: item.done })),
  schedules: raw.schedules.map((item) => ({ ...decodeSchedule(item), state: item.state, daysLeft: item.days_left, nextDay: item.next_day })),
})

/** The weekday of a calendar date, independent of the reader's time zone. */
export const weekdayOf = (date: string): Weekday => (((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1) as Weekday

/** Mirrors the server's schedule_has_day. */
export const isExerciseDay = (schedule: Pick<ExerciseSchedule, 'startsOn' | 'endsOn' | 'restWeekdays' | 'restDates'>, date: string) =>
  date >= schedule.startsOn && date <= schedule.endsOn && !schedule.restWeekdays.includes(weekdayOf(date)) && !schedule.restDates.includes(date)

/** Days in a range, first and last included. Zero when the end is before the start. */
export const daysBetween = (startsOn: string, endsOn: string) => Math.round((Date.parse(`${endsOn}T00:00:00Z`) - Date.parse(`${startsOn}T00:00:00Z`)) / 86_400_000) + 1

/** Exercise and rest days in a draft, for the summary before saving. Rest dates outside the range are not counted. */
export function countDays(draft: Pick<ExerciseSchedule, 'startsOn' | 'endsOn' | 'restWeekdays' | 'restDates'>) {
  const total = Math.max(0, daysBetween(draft.startsOn, draft.endsOn))
  let exercise = 0
  for (let index = 0; index < Math.min(total, MAX_SCHEDULE_DAYS); index += 1) if (isExerciseDay(draft, addDays(draft.startsOn, index))) exercise += 1
  return { total, exercise, rest: total - exercise }
}

export type ScheduleDraft = { id: string; patientId: string; startsOn: string; endsOn: string; restWeekdays: Weekday[]; restDates: string[] }
export type DraftProblem = 'dates' | 'tooLong' | 'pastStart' | 'pastEnd' | 'allRest' | 'noDay'

/**
 * What the server would refuse, so the form can say so before saving. `existing` is the saved schedule when editing: once it has
 * started, its start date is fixed and the rule about starting today or later no longer applies.
 */
export function draftProblem(draft: ScheduleDraft, today: string, existing?: Pick<ExerciseSchedule, 'startsOn'>): DraftProblem | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(draft.endsOn) || draft.endsOn < draft.startsOn) return 'dates'
  if (daysBetween(draft.startsOn, draft.endsOn) > MAX_SCHEDULE_DAYS) return 'tooLong'
  const started = existing !== undefined && existing.startsOn <= today
  if (!started && draft.startsOn < today) return 'pastStart'
  if (draft.endsOn < today) return 'pastEnd'
  if (draft.restWeekdays.length >= 7) return 'allRest'
  const from = draft.startsOn > today ? draft.startsOn : today
  return countDays({ ...draft, startsOn: from }).exercise === 0 ? 'noDay' : null
}

export async function saveSchedule(db: Db, draft: ScheduleDraft) {
  return decodeSchedule(must(await db.rpc('save_exercise_schedule', {
    p_id: draft.id, p_patient: draft.patientId, p_starts_on: draft.startsOn, p_ends_on: draft.endsOn,
    p_rest_weekdays: [...draft.restWeekdays].sort(), p_rest_dates: [...new Set(draft.restDates)].sort(),
  })) as unknown as RawSchedule)
}

export async function endSchedule(db: Db, scheduleId: string) {
  return decodeSchedule(must(await db.rpc('end_exercise_schedule', { p_schedule: scheduleId })) as unknown as RawSchedule)
}

/** Takes one exercise off the plan. Its sessions stay in history. */
export async function stopExercise(db: Db, assignmentId: string) {
  must(await db.rpc('stop_exercise', { p_assignment: assignmentId }))
}

export async function loadExerciseDay(db: Db, patientId: string, day?: string) {
  return decodeExerciseDay(must(await db.rpc('exercise_day', day ? { p_patient: patientId, p_day: day } : { p_patient: patientId })) as unknown as RawDay)
}

/** Publishes a new exercise into a schedule. Later edits use publishPrescription, which keeps it there. */
export async function publishScheduledPrescription(db: Db, scheduleId: string, request: PrescriptionRequest) {
  must(await db.rpc('publish_scheduled_prescription', { p_schedule: scheduleId, ...prescriptionArguments(request) }))
}

export type TodayState = 'exercise' | 'done' | 'rest' | 'upcoming' | 'finished' | 'none'
/** What a patient has to do today: the exercises still to do, and when the next ones are if there are none. */
export type TodayPlan<T> = { todo: T[]; done: number; due: number; state: TodayState; nextDay: string | null; startsOn: string | null }

/**
 * Today's plan from a patient's exercises and their exercise day. An exercise finished today leaves the list; a missed day is not
 * carried over, because only today's are listed. The next day is the soonest of each schedule's next exercise day, or tomorrow
 * while an every-day exercise is on the plan.
 */
export function planForToday<T extends { assignmentId: string }>(exercises: readonly T[], day: ExerciseDay): TodayPlan<T> {
  const of = new Map(day.exercises.map((item) => [item.assignmentId, item]))
  const due = exercises.filter((exercise) => of.get(exercise.assignmentId)?.due)
  const todo = due.filter((exercise) => !of.get(exercise.assignmentId)?.done)
  const everyDay = exercises.some((exercise) => of.get(exercise.assignmentId)?.scheduleId === null)
  const withExercises = day.schedules.filter((schedule) => schedule.exerciseCount > 0)
  const nextDay = [...withExercises.map((schedule) => schedule.nextDay), everyDay ? addDays(day.day, 1) : null].filter((date): date is string => date !== null).sort()[0] ?? null
  const startsOn = withExercises.filter((schedule) => schedule.state === 'upcoming').map((schedule) => schedule.startsOn).sort()[0] ?? null
  const state: TodayState = exercises.length === 0 ? 'none' : todo.length > 0 ? 'exercise' : due.length > 0 ? 'done'
    : withExercises.some((schedule) => schedule.state === 'rest') ? 'rest' : startsOn ? 'upcoming' : 'finished'
  return { todo, done: due.length - todo.length, due: due.length, state, nextDay, startsOn }
}
