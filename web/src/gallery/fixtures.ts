import type { CatalogueExercise } from '@/data/catalogue'
import type { HistoricalSession } from '@/data/history'
import type { MyProfile } from '@/data/profile'
import type { AdminAccount, AdminExercise, AdminLink, AdminSummary, AuditEvent } from '@/features/admin/types'
import type { PatientSummary } from '@/features/therapist/PatientCard'
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
  name: 'Dana', patients: 18, plans: 24, sessions: 20,
  latest: patients.flatMap((p) => (p.latest?.reached ? [{ id: `s-${p.id}`, patientId: p.id, patient: p.name, exercise: p.latest.exercise, low: p.latest.low, high: p.latest.high, reached: p.latest.reached }] : [])),
  recent: patients.slice(0, 3),
}

const days = ['2026-10-12', '2026-10-15', '2026-10-19', '2026-10-22', '2026-10-26', '2026-10-29', '2026-11-02', '2026-11-05']
const reach = [64, 71, 79, 76, 92, 98, 105, 112]

export const record: PatientRecord = {
  id: 'p1', name: 'Ana Dela Cruz', username: 'ana.delacruz', gender: 'Female', birthdate: '1971-03-14', contact: '0917 555 0142', address: 'Quezon City',
  plans: [
    { id: 'a1', exercise: elbow, version: 3, side: 'right', low: 20, high: 120, repetitions: 10, instructions: 'Keep your upper arm against your side and bend the elbow slowly, then lower with control.', reached: [14, 112] },
    { id: 'a2', exercise: knee, custom: true, version: 1, side: 'left', low: 15, high: 80, repetitions: 8, focus: 'Knee', instructions: 'Sit tall on a firm chair and straighten the knee, then lower it slowly.', reached: null },
  ],
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

export const summary: AdminSummary = { accounts: 214, disabled: 3, patients: 186, therapists: 24, admins: 4, activeLinks: 171, unlinkedPatients: 15, exercises: 9, activeExercises: 7, sessionsWeek: 412, pendingRequests: 2 }

export const accounts: AdminAccount[] = [
  { id: '7c0e1f2a-0000-4000-8000-000000000001', name: 'Dana Reyes', email: 'dana.reyes@example.test', username: 'dana', active: true, roles: ['patient', 'therapist'], joined: '2026-08-02T01:00:00Z', lastSignIn: '2026-11-05T00:40:00Z' },
  { id: '7c0e1f2a-0000-4000-8000-000000000002', name: 'Marco Santos', email: 'marco.santos@example.test', active: true, roles: ['patient', 'admin'], joined: '2026-07-20T01:00:00Z', lastSignIn: '2026-11-05T03:05:00Z' },
  { id: '7c0e1f2a-0000-4000-8000-000000000003', name: 'Ana Dela Cruz', email: 'ana.delacruz@example.test', username: 'ana.delacruz', active: true, roles: ['patient'], joined: '2026-09-11T01:00:00Z', lastSignIn: '2026-11-05T02:00:00Z', photo: null },
  { id: '7c0e1f2a-0000-4000-8000-000000000004', name: 'Ramon Bautista', email: 'ramon.bautista@example.test', active: true, roles: ['patient'], joined: '2026-09-15T01:00:00Z', lastSignIn: '2026-11-04T09:00:00Z' },
  { id: '7c0e1f2a-0000-4000-8000-000000000005', name: 'Liza Mercado', email: 'liza.mercado@example.test', active: false, roles: ['patient'], joined: '2026-09-28T01:00:00Z', lastSignIn: '2026-10-02T09:00:00Z' },
  { id: '7c0e1f2a-0000-4000-8000-000000000006', name: 'Noel Garcia', email: 'noel.garcia@example.test', active: true, roles: ['patient', 'therapist'], joined: '2026-08-14T01:00:00Z', lastSignIn: null },
]

export const links: AdminLink[] = [
  { therapist: accounts[0]!.id, therapistName: 'Dana Reyes', patient: accounts[2]!.id, patientName: 'Ana Dela Cruz', active: true },
  { therapist: accounts[0]!.id, therapistName: 'Dana Reyes', patient: accounts[3]!.id, patientName: 'Ramon Bautista', active: true },
  { therapist: accounts[5]!.id, therapistName: 'Noel Garcia', patient: accounts[4]!.id, patientName: 'Liza Mercado', active: false },
  { therapist: accounts[5]!.id, therapistName: 'Noel Garcia', patient: accounts[3]!.id, patientName: 'Ramon Bautista', active: true },
]

export const exercises: AdminExercise[] = [
  { id: 'e1', code: 'elbow-flexion', active: true, version: 2, name: elbow, english: 'Place the camera at chest height, side-on to the arm being measured.', filipino: 'Ilagay ang camera sa taas ng dibdib, nakatagilid sa brasong susukatin.', custom: false },
  { id: 'e2', code: 'shoulder-abduction', active: true, version: 2, name: shoulder, english: 'Face the camera and raise the arm out to the side, keeping your trunk upright.', filipino: 'Humarap sa camera at itaas ang braso sa tagiliran, nang tuwid ang katawan.', custom: false },
  { id: 'e3', code: 'custom-7f1', active: true, version: 1, name: knee, english: 'Sit tall on a firm chair and straighten the knee, then lower it slowly.', filipino: '', custom: true },
  { id: 'e4', code: 'custom-9a2', active: false, version: 1, name: 'Standing hip flexion', english: 'Stand beside a chair for balance and lift the thigh slowly.', filipino: '', custom: true },
]

export const activity: AuditEvent[] = [
  { id: 9, kind: 'prescription', category: 'clinical', target: 'Ana Dela Cruz', actor: 'Dana Reyes', recordedAt: '2026-11-05T03:12:00Z' },
  { id: 8, kind: 'roleGranted', category: 'accounts', target: 'Noel Garcia', actor: 'Marco Santos', recordedAt: '2026-11-05T02:44:00Z' },
  { id: 7, kind: 'linkCreated', category: 'links', target: 'Dana Reyes and Ramon Bautista', actor: 'Marco Santos', recordedAt: '2026-11-05T01:30:00Z' },
  { id: 6, kind: 'versionPublished', category: 'catalogue', target: elbow, actor: 'Marco Santos', recordedAt: '2026-11-04T08:15:00Z' },
  { id: 5, kind: 'requestCreated', category: 'privacy', target: 'Liza Mercado', actor: 'Liza Mercado', recordedAt: '2026-11-04T05:02:00Z' },
  { id: 4, kind: 'accountDisabled', category: 'accounts', target: 'Liza Mercado', actor: 'Marco Santos', recordedAt: '2026-11-03T10:20:00Z' },
  { id: 3, kind: 'session', category: 'clinical', target: 'Ramon Bautista', actor: null, recordedAt: '2026-11-03T02:00:00Z' },
]

export const profile: MyProfile = {
  firstName: 'Dana', lastName: 'Reyes', username: 'dana_reyes', gender: 'female', birthdate: '1988-07-02', address: 'Quezon City', contact: '+63 917 555 0133', consent: true,
  email: 'dana.reyes@example.test', photo: null, complete: true,
}
