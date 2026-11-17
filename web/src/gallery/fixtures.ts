import type { Availability, Booking, WaitlistEntry } from '@/data/booking'
import type { AffectedBooking, CenterCalendar } from '@/data/calendar'
import type { CatalogueExercise } from '@/data/catalogue'
import type { ChatMessage, Conversation } from '@/data/chat'
import type { Schedule, ScheduleRow, ScheduleSession } from '@/data/schedule'
import type { RequestDetail, RequestRow, SchedulerSummary, SeriesDate, TherapistChoice } from '@/data/scheduler'
import { activitySummary, type HistoricalSession } from '@/data/history'
import type { Inbox } from '@/data/notifications'
import type { MyExercise } from '@/data/patient'
import type { MyProfile } from '@/data/profile'
import type { AdminAccount, AdminExercise, AdminLink, AdminSummary, AuditEvent, BackendStatus } from '@/features/admin/types'
import type { PrivacyState } from '@/features/patient/PatientCareView'
import type { TodayPlan } from '@/data/exerciseSchedule'
import type { PatientHome } from '@/features/patient/PatientHomeView'
import type { PatientSummary } from '@/features/therapist/PatientTable'
import type { PatientRecord } from '@/features/therapist/PatientRecordView'
import type { TherapistHome } from '@/features/therapist/TherapistHomeView'

// Synthetic people for design review only. Never bundled into production.
const elbow = 'Elbow flexion'
const shoulder = 'Shoulder abduction'
const knee = 'Seated knee extension'

export const patients: PatientSummary[] = [
  { id: 'p1', name: 'Ana Dela Cruz', plans: 2, latest: { exercise: elbow, low: 20, high: 120, reached: [14, 112], when: '2026-11-05T02:10:00Z' } },
  { id: 'p2', name: 'Ramon Bautista', plans: 1, latest: { exercise: shoulder, low: 15, high: 90, reached: [10, 84], when: '2026-11-05T01:20:00Z' } },
  { id: 'p3', name: 'Liza Mercado', plans: 1, latest: { exercise: knee, low: 15, high: 80, reached: [12, 86], when: '2026-11-04T07:45:00Z' } },
  { id: 'p4', name: 'Jose Villanueva', plans: 2, latest: { exercise: shoulder, low: 20, high: 110, reached: [18, 71], when: '2026-11-04T03:30:00Z' } },
  { id: 'p5', name: 'Grace Aquino', plans: 1, latest: { exercise: elbow, low: 25, high: 100, reached: null, when: null } },
  { id: 'p6', name: 'Paolo Ramos', plans: 0, latest: null },
]

export const therapistHome: TherapistHome = {
  name: 'Dana', patients: 18, plans: 24, sessions: 20, withoutPlan: 2,
  latest: patients.flatMap((p) => (p.latest?.reached ? [{ id: `s-${p.id}`, patientId: p.id, patient: p.name, exercise: p.latest.exercise, low: p.latest.low, high: p.latest.high, reached: p.latest.reached }] : [])),
  recent: patients.slice(0, 3),
}

const days = ['2026-10-12', '2026-10-15', '2026-10-19', '2026-10-22', '2026-10-26', '2026-10-29', '2026-11-02', '2026-11-05']
const reach = [64, 71, 79, 76, 92, 98, 105, 112]

export const record: PatientRecord = {
  id: 'p1', name: 'Ana Dela Cruz', username: 'ana.delacruz', gender: 'Female', birthdate: '1971-03-14', contact: '0917 555 0142', address: 'Quezon City',
  today: '2026-11-06',
  schedules: [{
    id: 's1', patientId: 'p1', therapistId: 't1', therapistName: 'Dana Reyes', startsOn: '2026-11-02', endsOn: '2026-11-29', restWeekdays: [7], restDates: ['2026-11-14'],
    exerciseDays: 23, restDays: 5, exerciseCount: 2, state: 'exercise', daysLeft: 19, nextDay: '2026-11-07', mine: true,
    plans: [
      { id: 'a1', exercise: elbow, version: 3, side: 'right', low: 20, high: 120, repetitions: 10, instructions: 'Keep your upper arm against your side and bend the elbow slowly, then lower with control.', reached: [14, 112], today: 'done' },
      { id: 'a2', exercise: knee, custom: true, version: 1, side: 'left', low: 15, high: 80, repetitions: 8, focus: 'Knee', instructions: 'Sit tall on a firm chair and straighten the knee, then lower it slowly.', reached: null, today: 'todo' },
    ],
  }],
  everyDay: [],
  ended: [],
  trend: {
    exercise: elbow, detail: 'Right side, version 3, prescribed 20° to 120°',
    points: days.map((day, index) => ({ id: day, label: new Date(day).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }), value: index === 3 ? null : reach[index]! - 14 })),
  },
}

export const catalogue: CatalogueExercise[] = [
  { id: 'v1', name: elbow, algorithm: 'elbow-flexion-v1', instructions: 'Place the camera at chest height, side-on to the arm being measured.', exerciseId: 'e1', custom: false, selectable: true, retired: false, joint: null },
  { id: 'v2', name: shoulder, algorithm: 'shoulder-abduction-v1', instructions: 'Face the camera and raise the arm out to the side, keeping your trunk upright.', exerciseId: 'e2', custom: false, selectable: true, retired: false, joint: null },
  { id: 'v3', name: knee, algorithm: 'joint-angle-v1', instructions: 'Sit tall on a firm chair and straighten the knee, then lower it slowly.', exerciseId: 'e3', custom: true, selectable: true, retired: false, joint: 'KNEE' },
]

const prescription = (id: string, version: number): NonNullable<HistoricalSession['prescription']> => ({
  id, assignmentId: 'a1', version, exerciseVersionId: 'v1', exerciseName: elbow, algorithm: 'elbow-flexion-v1', side: 'right', low: 20, high: 120, targetRepetitions: 10,
})

export const sessions: HistoricalSession[] = days.map((day, index): HistoricalSession => ({
  id: `h${index}`, patientId: 'p1', startedAt: `${day}T02:00:00Z`, endedAt: `${day}T02:12:00Z`, status: index === 3 ? 'interrupted' : 'completed', modelVersion: 'pose-landmarker-lite-float16-v1', algorithmVersion: 'elbow-flexion-v1',
  prescription: prescription('rx1', 3),
  measurements: [{ key: 'elbow-flexion-v1', side: 'right', minimum: 14, maximum: reach[index]!, repetitions: index === 5 ? 7 : index === 3 ? 4 : 10, incomplete: index === 5 ? 3 : 0, quality: index === 3 ? 'limited' : 'valid', validFrames: 420, invalidFrames: 12 }],
})).reverse()
/** A fixed day, so the sample summary reads the same whenever it is reviewed. */
export const exerciseActivity = activitySummary(sessions, new Date(2026, 10, 6, 12))

export const myExercises: MyExercise[] = [
  { assignmentId: 'a1', versionId: 'pv1', exerciseVersionId: 'v1', name: 'Elbow flexion', instructions: 'Sit tall, keep your upper arm still, and bend your elbow slowly.', side: 'left', low: 20, high: 120, repetitions: 10, focus: 'ELBOW', version: 2, sideSeconds: null },
  { assignmentId: 'a2', versionId: 'pv2', exerciseVersionId: 'v2', name: 'Shoulder abduction', instructions: 'Raise your arm out to the side, then lower it with control.', side: 'right', low: 15, high: 90, repetitions: 8, focus: null, version: 1, sideSeconds: null },
]
const today = new Date()
const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7))
const slotsOn = (date: string, left: readonly number[]) => left.map((remaining, index) => {
  const hour = String(9 + index).padStart(2, '0')
  return { startsAt: `${date}T${hour}:00:00+08:00`, endsAt: `${date}T${String(10 + index).padStart(2, '0')}:00:00+08:00`, remaining, mine: index === 2, waiting: false }
})
const bookingDate = '2026-12-07'
export const availability: Availability = {
  timeZone: 'Asia/Manila',
  days: [
    { date: bookingDate, status: 'open', holiday: null, slots: slotsOn(bookingDate, [3, 1, 2, 0, 3, 2, 1, 3]) },
    { date: '2026-12-08', status: 'holiday', holiday: 'Feast of the Immaculate Conception of Mary', slots: [] },
    { date: '2026-12-09', status: 'open', holiday: null, slots: slotsOn('2026-12-09', [2, 2, 2, 2, 2, 2, 2, 2]) },
    { date: '2026-12-12', status: 'closed', holiday: null, slots: [] },
  ],
}
export const waitlist: WaitlistEntry[] = [
  { id: 'w1', startsAt: '2026-12-09T02:00:00Z', endsAt: '2026-12-09T03:00:00Z', open: true },
  { id: 'w2', startsAt: '2026-12-10T06:00:00Z', endsAt: '2026-12-10T07:00:00Z', open: false },
]
export const myBookings: Booking[] = [
  { id: 'k1', reference: 'BK-2026-000142', status: 'confirmed', reason: null, startsAt: '2026-12-07T01:00:00Z', endsAt: '2026-12-07T02:00:00Z', previousStartsAt: null, visitReason: 'Follow-up for my left elbow after the cast came off.', patient: 'Ana Dela Cruz', patientPhoto: null, therapist: 'Dana Reyes', therapistPhoto: null, location: '12 Mabini Street, Quezon City', cancelUntil: '2026-12-06T01:00:00Z', canCancel: true, rescheduleUntil: '2026-12-06T01:00:00Z', canReschedule: true, reschedulesLeft: 2 },
  { id: 'k2', reference: 'BK-2026-000158', status: 'pending', reason: null, startsAt: '2026-12-14T02:00:00Z', endsAt: '2026-12-14T03:00:00Z', previousStartsAt: null, visitReason: 'Shoulder stiffness when reaching overhead.', patient: 'Ana Dela Cruz', patientPhoto: null, therapist: null, therapistPhoto: null, location: '12 Mabini Street, Quezon City', cancelUntil: '2026-12-13T02:00:00Z', canCancel: true, rescheduleUntil: '2026-12-13T02:00:00Z', canReschedule: true, reschedulesLeft: 2 },
  { id: 'k3', reference: 'BK-2026-000097', status: 'rejected', reason: 'No therapist available that week', startsAt: '2026-10-20T02:00:00Z', endsAt: '2026-10-20T03:00:00Z', previousStartsAt: null, visitReason: null, patient: 'Ana Dela Cruz', patientPhoto: null, therapist: null, therapistPhoto: null, location: '12 Mabini Street, Quezon City', cancelUntil: null, canCancel: false, rescheduleUntil: null, canReschedule: false, reschedulesLeft: 0 },
]
/** Two of three exercises still to do today; the empty state is a rest day. */
export const myToday: TodayPlan<MyExercise> = { todo: myExercises, done: 1, due: 3, state: 'exercise', nextDay: '2026-11-19', startsOn: null }
export const restDay: TodayPlan<MyExercise> = { todo: [], done: 0, due: 0, state: 'rest', nextDay: '2026-11-19', startsOn: null }

export const patientHome: PatientHome = {
  name: 'Ana Dela Cruz', today: { todo: myExercises, done: 1, due: 3, state: 'exercise', nextDay: null, startsOn: null },
  week: Array.from({ length: 7 }, (_, index) => ({ day: new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index), done: index < 2 })),
  session: myBookings[0]!,
  recent: [{ id: 'r1', startedAt: '2026-11-04T01:30:00Z', status: 'completed' }, { id: 'r2', startedAt: '2026-11-03T02:10:00Z', status: 'interrupted' }, { id: 'r3', startedAt: '2026-11-02T01:45:00Z', status: 'completed' }],
}
export const privacy: PrivacyState = { consent: 'granted', requests: [{ id: 'd1', kind: 'export', status: 'requested', createdAt: '2026-11-04T01:30:00Z' }, { id: 'd2', kind: 'delete', status: 'declined', createdAt: '2026-10-20T01:30:00Z' }] }

export const requests: RequestRow[] = [
  { id: 'q1', reference: 'BK-2026-000158', status: 'pending', reason: null, startsAt: '2026-12-14T02:00:00Z', endsAt: '2026-12-14T03:00:00Z', patientId: 'p1', patient: 'Ana Dela Cruz', patientPhoto: null, visitReason: 'Knee pain after walking; would like a mobility check.', therapistId: null, therapist: null, therapistPhoto: null, attendance: null, started: false, seriesId: null, createdAt: '2026-11-05T02:00:00Z' },
  { id: 'q2', reference: 'BK-2026-000157', status: 'confirmed', reason: null, startsAt: '2026-12-07T01:00:00Z', endsAt: '2026-12-07T02:00:00Z', patientId: 'p2', patient: 'Ramon Bautista', patientPhoto: null, visitReason: 'Weekly elbow strengthening course.', therapistId: 't1', therapist: 'Dana Reyes', therapistPhoto: null, attendance: 'attended', started: true, seriesId: 's1', createdAt: '2026-11-04T02:00:00Z' },
  { id: 'q3', reference: 'BK-2026-000149', status: 'rescheduled', reason: 'Therapist training', startsAt: '2026-12-09T05:00:00Z', endsAt: '2026-12-09T06:00:00Z', patientId: 'p3', patient: 'Liza Mendoza', patientPhoto: null, visitReason: null, therapistId: 't2', therapist: 'Omar Lim', therapistPhoto: null, attendance: null, started: true, seriesId: null, createdAt: '2026-11-02T02:00:00Z' },
  { id: 'q4', reference: 'BK-2026-000097', status: 'rejected', reason: 'No therapist available that week', startsAt: '2026-10-20T02:00:00Z', endsAt: '2026-10-20T03:00:00Z', patientId: 'p1', patient: 'Ana Dela Cruz', patientPhoto: null, visitReason: null, therapistId: null, therapist: null, therapistPhoto: null, attendance: null, started: false, seriesId: null, createdAt: '2026-10-12T02:00:00Z' },
]
export const requestDetail: RequestDetail = {
  id: 'q1', seriesId: null, seriesRemaining: 0,
  events: [{ id: 1, action: 'requested', actorRole: 'patient', actor: 'Ana Dela Cruz', actorPhoto: null, fromStatus: null, toStatus: 'pending', toStartsAt: '2026-12-14T02:00:00Z', toAttendance: null, reason: null, recordedAt: '2026-11-05T02:00:00Z' }],
}
export const schedulerSummary: SchedulerSummary = { pending: 6, today: 9, booked: 57, places: 120, utilization: 48, date: '2026-12-07', weekFrom: '2026-12-07', weekTo: '2026-12-13' }
export const seriesDates: SeriesDate[] = [
  { startsAt: '2026-12-07T01:00:00Z', endsAt: '2026-12-07T02:00:00Z', problem: null }, { startsAt: '2026-12-14T01:00:00Z', endsAt: '2026-12-14T02:00:00Z', problem: 'therapist_busy' },
  { startsAt: '2026-12-21T01:00:00Z', endsAt: '2026-12-21T02:00:00Z', problem: null }, { startsAt: '2026-12-28T01:00:00Z', endsAt: '2026-12-28T02:00:00Z', problem: 'holiday' },
]
export const therapistChoices: TherapistChoice[] = [
  { id: 't1', name: 'Dana Reyes', photo: null, linked: true, busy: false, onLeave: false }, { id: 't2', name: 'Omar Lim', photo: null, linked: false, busy: true, onLeave: false }, { id: 't3', name: 'Grace Tan', photo: null, linked: false, busy: false, onLeave: true },
  { id: 't4', name: 'Rico Santos', photo: null, linked: false, busy: false, onLeave: false },
]

/** A working day by the hour, nine to five in Manila, with a session in the hours given. */
const dayOf = (date: string, sessions: Record<number, Partial<ScheduleSession>>, leave: readonly number[] = []): ScheduleRow[] => Array.from({ length: 8 }, (_, index) => {
  const hour = 9 + index
  const at = (value: number) => `${date}T${String(value - 8).padStart(2, '0')}:00:00Z`
  const session = sessions[hour]
  return {
    startsAt: at(hour), endsAt: at(hour + 1), onLeave: !session && leave.includes(hour),
    session: session ? { id: `s${date}${hour}`, reference: 'BK-2026-000158', status: 'confirmed', startsAt: at(hour), endsAt: at(hour + 1), location: 'Motivance Center, Quezon City', visitReason: 'Follow-up for my left elbow after the cast came off.', therapist: 'Dana Reyes', therapistPhoto: null, patientId: null, patient: null, patientPhoto: null, linked: false, attendance: null, started: false, ...session } : null,
  }
})
export const schedule: Schedule = {
  days: [
    { date: '2026-12-07', status: 'open', holiday: null, onLeave: false, rows: dayOf('2026-12-07', { 9: { therapist: 'Dana Reyes', reference: 'BK-2026-000157' } }) },
    { date: '2026-12-12', status: 'closed', holiday: null, onLeave: false, rows: [] },
    { date: '2026-12-14', status: 'open', holiday: null, onLeave: false, rows: dayOf('2026-12-14', { 10: { therapist: 'Dana Reyes' } }) },
    { date: '2026-12-15', status: 'open', holiday: null, onLeave: false, rows: dayOf('2026-12-15', {}) },
    { date: '2026-12-25', status: 'holiday', holiday: 'Christmas Day', onLeave: false, rows: [] },
  ],
}
export const therapistSchedule: Schedule = {
  days: [
    { date: '2026-12-12', status: 'closed', holiday: null, onLeave: false, rows: [] },
    {
      date: '2026-12-14', status: 'open', holiday: null, onLeave: true, rows: dayOf('2026-12-14', {
        10: { patient: 'Ana Dela Cruz', patientId: 'p1', linked: true, started: true, attendance: 'attended' }, 13: { patient: 'Ramon Bautista', patientId: 'p2', linked: false, reference: 'BK-2026-000157', status: 'rescheduled' },
      }, [15, 16]),
    },
    { date: '2026-12-25', status: 'holiday', holiday: 'Christmas Day', onLeave: false, rows: [] },
  ],
}

export const calendar: CenterCalendar = {
  settings: {
    centerName: 'Motivance Therapy Center', location: 'Motivance Center, Quezon City', slotMinutes: 60, slotCapacity: 3, cancelCutoffHours: 24, rescheduleCutoffHours: 24, minimumNoticeHours: 24,
    bookingHorizonDays: 60, maxActiveBookings: 5, maxSelfReschedules: 2,
  },
  hours: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, isOpen: weekday < 6, opensAt: '09:00', closesAt: '17:00' })),
  holidays: [
    { id: 'h1', name: 'Christmas Day', kind: 'regular', startsOn: '2026-12-25', endsOn: '2026-12-25' },
    { id: 'h2', name: 'Year-end break', kind: 'seasonal', startsOn: '2026-12-28', endsOn: '2027-01-01' },
  ],
  closures: [
    { id: 'c1', startsAt: '2026-12-11T16:00:00Z', endsAt: '2026-12-12T16:00:00Z', allDay: true, reason: 'Water supply maintenance' },
    { id: 'c2', startsAt: '2026-12-09T05:00:00Z', endsAt: '2026-12-09T07:00:00Z', allDay: false, reason: 'Staff training' },
  ],
  timeOff: [
    { id: 'o1', therapistId: 't1', therapist: 'Dana Reyes', therapistPhoto: null, startsAt: '2026-12-16T01:00:00Z', endsAt: '2026-12-16T05:00:00Z', reason: 'Conference' },
    { id: 'o2', therapistId: 't2', therapist: 'Omar Lim', therapistPhoto: null, startsAt: '2026-12-21T01:00:00Z', endsAt: '2026-12-23T09:00:00Z', reason: 'Family leave' },
  ],
}
export const affected: AffectedBooking[] = [
  { id: 'q1', reference: 'BK-2026-000158', status: 'pending', startsAt: '2026-12-14T02:00:00Z', endsAt: '2026-12-14T03:00:00Z', patient: 'Ana Dela Cruz', patientPhoto: null, therapistId: null, therapist: null, therapistPhoto: null },
  { id: 'q2', reference: 'BK-2026-000157', status: 'confirmed', startsAt: '2026-12-14T03:00:00Z', endsAt: '2026-12-14T04:00:00Z', patient: 'Ramon Bautista', patientPhoto: null, therapistId: 't1', therapist: 'Dana Reyes', therapistPhoto: null },
]

const noteFacts = {
  sessions: 0, lastStartsAt: null, reference: 'BK-2026-000158', startsAt: '2026-12-14T02:00:00Z', endsAt: '2026-12-14T03:00:00Z', previousStartsAt: null, patient: 'Ana Dela Cruz', therapist: 'Dana Reyes',
  reason: null, readAt: null, subjectId: 't1', subjectName: 'Dana Reyes', subjectPhoto: null, completed: null, target: null, days: null, conversationId: null, sender: null,
}
export const inbox: Inbox = {
  unread: 3,
  rows: [
    { ...noteFacts, id: 'n9', kind: 'chat_message', reference: '', startsAt: null, endsAt: null, patient: null, conversationId: 'c1', sender: 'Dana Reyes', subjectName: 'Dana Reyes', createdAt: '2026-12-01T04:00:00Z' },
    { ...noteFacts, id: 'n0', kind: 'plan_updated', reference: '', startsAt: null, endsAt: null, patient: null, createdAt: '2026-12-01T03:00:00Z' },
    { ...noteFacts, id: 'n1', kind: 'confirmed', createdAt: '2026-12-01T02:00:00Z' },
    { ...noteFacts, id: 'n2', kind: 'cancelled', reason: 'Water supply maintenance', startsAt: '2026-12-09T02:00:00Z', endsAt: '2026-12-09T03:00:00Z', createdAt: '2026-11-30T05:00:00Z' },
    { ...noteFacts, id: 'n3', kind: 'rescheduled', previousStartsAt: '2026-12-02T02:00:00Z', readAt: '2026-11-29T05:00:00Z', createdAt: '2026-11-28T05:00:00Z' },
  ],
}

export const summary: AdminSummary = { accounts: 214, disabled: 3, patients: 183, therapists: 24, schedulers: 3, admins: 4, activeLinks: 171, unlinkedPatients: 15, exercises: 9, activeExercises: 7, sessionsWeek: 412, pendingRequests: 2 }

export const accounts: AdminAccount[] = [
  { id: '7c0e1f2a-0000-4000-8000-000000000001', name: 'Dana Reyes', email: 'dana.reyes@example.test', username: 'dana', active: true, roles: ['patient', 'therapist'], joined: '2026-08-02T01:00:00Z', lastSignIn: '2026-11-05T00:40:00Z' },
  { id: '7c0e1f2a-0000-4000-8000-000000000002', name: 'Marco Santos', email: 'marco.santos@example.test', active: true, roles: ['patient', 'admin'], joined: '2026-07-20T01:00:00Z', lastSignIn: '2026-11-05T03:05:00Z' },
  { id: '7c0e1f2a-0000-4000-8000-000000000003', name: 'Ana Dela Cruz', email: 'ana.delacruz@example.test', username: 'ana.delacruz', active: true, roles: ['patient'], joined: '2026-09-11T01:00:00Z', lastSignIn: '2026-11-05T02:00:00Z', photo: null },
  { id: '7c0e1f2a-0000-4000-8000-000000000004', name: 'Ramon Bautista', email: 'ramon.bautista@example.test', active: true, roles: ['patient'], joined: '2026-09-15T01:00:00Z', lastSignIn: '2026-11-04T09:00:00Z' },
  { id: '7c0e1f2a-0000-4000-8000-000000000005', name: 'Liza Mercado', email: 'liza.mercado@example.test', active: false, roles: ['patient'], joined: '2026-09-28T01:00:00Z', lastSignIn: '2026-10-02T09:00:00Z' },
  { id: '7c0e1f2a-0000-4000-8000-000000000006', name: 'Noel Garcia', email: 'noel.garcia@example.test', active: true, roles: ['patient', 'therapist'], joined: '2026-08-14T01:00:00Z', lastSignIn: null },
]

export const links: AdminLink[] = [
  { therapist: accounts[0]!.id, therapistName: 'Dana Reyes', therapistPhoto: null, patient: accounts[2]!.id, patientName: 'Ana Dela Cruz', patientPhoto: null, active: true },
  { therapist: accounts[0]!.id, therapistName: 'Dana Reyes', therapistPhoto: null, patient: accounts[3]!.id, patientName: 'Ramon Bautista', patientPhoto: null, active: true },
  { therapist: accounts[5]!.id, therapistName: 'Noel Garcia', therapistPhoto: null, patient: accounts[4]!.id, patientName: 'Liza Mercado', patientPhoto: null, active: false },
  { therapist: accounts[5]!.id, therapistName: 'Noel Garcia', therapistPhoto: null, patient: accounts[3]!.id, patientName: 'Ramon Bautista', patientPhoto: null, active: true },
]

export const exercises: AdminExercise[] = [
  { id: 'e1', code: 'elbow-flexion', active: true, version: 2, name: elbow, english: 'Place the camera at chest height, side-on to the arm being measured.', filipino: 'Ilagay ang camera sa taas ng dibdib, nakatagilid sa brasong susukatin.', custom: false },
  { id: 'e2', code: 'shoulder-abduction', active: true, version: 2, name: shoulder, english: 'Face the camera and raise the arm out to the side, keeping your trunk upright.', filipino: 'Humarap sa camera at itaas ang braso sa tagiliran, nang tuwid ang katawan.', custom: false },
  { id: 'e3', code: 'custom-7f1', active: true, version: 1, name: knee, english: 'Sit tall on a firm chair and straighten the knee, then lower it slowly.', filipino: '', custom: true },
  { id: 'e4', code: 'custom-9a2', active: false, version: 1, name: 'Standing hip flexion', english: 'Stand beside a chair for balance and lift the thigh slowly.', filipino: '', custom: true },
]

export const activity: AuditEvent[] = [
  { id: 9, kind: 'prescription', category: 'clinical', target: 'Ana Dela Cruz', actor: 'Dana Reyes', actorPhoto: null, recordedAt: '2026-11-05T03:12:00Z' },
  { id: 8, kind: 'roleGranted', category: 'accounts', target: 'Noel Garcia', actor: 'Marco Santos', actorPhoto: null, recordedAt: '2026-11-05T02:44:00Z' },
  { id: 7, kind: 'linkCreated', category: 'links', target: 'Dana Reyes and Ramon Bautista', actor: 'Marco Santos', actorPhoto: null, recordedAt: '2026-11-05T01:30:00Z' },
  { id: 6, kind: 'versionPublished', category: 'catalogue', target: elbow, actor: 'Marco Santos', actorPhoto: null, recordedAt: '2026-11-04T08:15:00Z' },
  { id: 5, kind: 'requestCreated', category: 'privacy', target: 'Liza Mercado', actor: 'Liza Mercado', actorPhoto: null, recordedAt: '2026-11-04T05:02:00Z' },
  { id: 4, kind: 'accountDisabled', category: 'accounts', target: 'Liza Mercado', actor: 'Marco Santos', actorPhoto: null, recordedAt: '2026-11-03T10:20:00Z' },
  { id: 3, kind: 'session', category: 'clinical', target: 'Ramon Bautista', actor: null, actorPhoto: null, recordedAt: '2026-11-03T02:00:00Z' },
]

export const profile: MyProfile = {
  firstName: 'Dana', lastName: 'Reyes', username: 'dana_reyes', gender: 'female', birthdate: '1988-07-02', address: 'Quezon City', contact: '+63 917 555 0133', consent: true,
  email: 'dana.reyes@example.test', photo: null, complete: true,
}

const said = (id: string, senderId: string | null, createdAt: string, body: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id, conversationId: 'c1', senderId, kind: 'text', body, data: {}, createdAt, deleted: false, ...extra })
/** Newest first, as the server returns them. `me` is the reader in the gallery, whichever workspace is shown. */
const media = (kind: 'image' | 'video', id: string, expiresAt: string) => ({
  attachment_kind: kind, mime: kind === 'video' ? 'video/webm' : 'image/jpeg', width: kind === 'video' ? 852 : 1200, height: kind === 'video' ? 480 : 1600,
  duration_ms: kind === 'video' ? 14_000 : null, bytes: 300_000, media_path: `c1/${id}/media`, preview_path: `c1/${id}/preview.jpg`, expires_at: expiresAt,
})
export const chatMessages: ChatMessage[] = [
  said('m12', 'me', '2026-11-05T03:10:00Z', 'Try this tonight', { kind: 'exercise', data: { assignment_id: 'a1', version: 3, exercise: 'Elbow flexion', side: 'right', low: 20, high: 120, repetitions: 10 } }),
  said('m11', 'other', '2026-11-05T03:00:00Z', '', { kind: 'progress', data: { scope: 'series', exercise: 'Elbow flexion', side: 'right', latest: 98, best: 98, change: 48, measured: 7, low: 20, high: 120, as_of: '2026-11-05T03:00:00Z' } }),
  said('m10', null, '2026-11-05T02:50:00Z', '', { kind: 'system', data: { event: 'session_finished', completed: 9, target: 10 } }),
  said('m9', 'other', '2026-11-05T02:30:00Z', '', { kind: 'attachment', data: media('video', 'm9', '2099-01-01T00:00:00Z') }),
  said('m8', 'me', '2026-11-05T02:25:00Z', 'Hold the band like this.', { kind: 'attachment', data: media('image', 'm8', '2099-01-01T00:00:00Z') }),
  said('m7', 'other', '2026-11-04T08:30:00Z', '', { kind: 'attachment', data: media('image', 'm7', '2026-11-10T00:00:00Z') }),
  said('m6', 'me', '2026-11-05T02:20:00Z', 'Good. Keep the upper arm still, and stop if it hurts.'),
  said('m5', 'other', '2026-11-05T02:14:00Z', 'Did ten this morning. The last two were hard.'),
  said('m4', null, '2026-11-05T01:00:00Z', '', { kind: 'system', data: { event: 'practice_reminder', date: '2026-11-05' } }),
  said('m3', 'me', '2026-11-04T09:05:00Z', '', { deleted: true }),
  said('m2', 'me', '2026-11-04T09:02:00Z', 'How did the elbow feel after Monday?'),
  said('m1', 'other', '2026-11-04T08:40:00Z', 'Hello! Is it normal to feel stiff in the morning?'),
]
export const conversations: Conversation[] = [
  { id: 'c1', side: 'therapist', otherId: 'p1', otherName: 'Ana Dela Cruz', otherPhoto: null, open: true, consented: true, media: true, muted: false, lastMessageAt: '2026-11-05T02:20:00Z', lastMessage: chatMessages[0]!, unread: 0 },
  { id: 'c2', side: 'therapist', otherId: 'p2', otherName: 'Ramon Bautista', otherPhoto: null, open: true, consented: true, media: false, muted: true, lastMessageAt: '2026-11-03T05:00:00Z', lastMessage: said('n1', 'other', '2026-11-03T05:00:00Z', 'Can we move Thursday?'), unread: 2 },
  { id: 'c3', side: 'therapist', otherId: 'p3', otherName: 'Liza Santos', otherPhoto: null, open: false, consented: true, media: true, muted: false, lastMessageAt: null, lastMessage: null, unread: 0 },
  // Linked, but has not turned messages on yet.
  { id: 'c4', side: 'therapist', otherId: 'p4', otherName: 'Noel Ramos', otherPhoto: null, open: false, consented: false, media: false, muted: false, lastMessageAt: null, lastMessage: null, unread: 0 },
]

const MB = 1_048_576
/** Two weeks to the same fixed day as the other samples, with a quiet weekend in each. */
const backendDays = Array.from({ length: 14 }, (_, index) => {
  const day = new Date(Date.UTC(2026, 10, 6 - 13 + index))
  const weekend = [0, 6].includes(day.getUTCDay())
  return { day: day.toISOString().slice(0, 10), sessions: weekend ? 9 + index : 48 + ((index * 7) % 19), messages: weekend ? 12 : 70 + ((index * 13) % 41), bookings: weekend ? 0 : 6 + (index % 5), accounts: index % 4 === 0 ? 3 : 1 }
})
export const backend: BackendStatus = {
  generatedAt: '2026-11-06T04:00:00Z',
  plan: { name: 'Supabase Free', databaseBytes: 500 * MB, storageBytes: 1024 * MB },
  database: { bytes: 141 * MB, tables: [{ name: 'session_measurements', bytes: 52 * MB }, { name: 'sessions', bytes: 21 * MB }, { name: 'chat_messages', bytes: 14 * MB }, { name: 'audit_events', bytes: 9 * MB }, { name: 'notifications', bytes: 6 * MB }, { name: 'bookings', bytes: 3 * MB }] },
  storage: { bytes: 812 * MB, files: 2_418, buckets: [{ bucket: 'chat-media', files: 2_204, bytes: 806 * MB }, { bucket: 'avatars', files: 214, bytes: 6 * MB }] },
  deliveries: { waiting: 3, oldestWaiting: '2026-11-06T03:59:20Z', failedWeek: 2, sentDay: 386 },
  accounts: { signedInWeek: 162, newWeek: 11, devices: 147 },
  activity: backendDays,
  jobs: [
    { name: 'booking-reminders', schedule: '*/5 * * * *', lastStatus: 'succeeded', lastRun: '2026-11-06T03:55:00Z', failuresDay: 0 },
    { name: 'notification-dispatch', schedule: '* * * * *', lastStatus: 'succeeded', lastRun: '2026-11-06T03:59:00Z', failuresDay: 0 },
    { name: 'send-scheduled-messages', schedule: '* * * * *', lastStatus: 'succeeded', lastRun: '2026-11-06T03:59:00Z', failuresDay: 0 },
  ],
}
export const emptyBackend: BackendStatus = {
  ...backend, database: { bytes: 18 * MB, tables: [] }, storage: { bytes: 0, files: 0, buckets: [] },
  deliveries: { waiting: 0, oldestWaiting: null, failedWeek: 0, sentDay: 0 }, accounts: { signedInWeek: 0, newWeek: 0, devices: 0 },
  activity: backendDays.map((row) => ({ ...row, sessions: 0, messages: 0, bookings: 0, accounts: 0 })),
}
