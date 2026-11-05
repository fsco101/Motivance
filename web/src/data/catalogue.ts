export type Joint = 'SHOULDER' | 'ELBOW' | 'WRIST' | 'HIP' | 'KNEE' | 'ANKLE'
export const JOINTS: readonly Joint[] = ['SHOULDER', 'ELBOW', 'WRIST', 'HIP', 'KNEE', 'ANKLE']

export const CUSTOM_ALGORITHM = 'joint-angle-v1'
export const CATALOGUE_SELECT = 'id,version,algorithm_key,definition,exercises(id,owner_id)'
const SUPPORTED = new Set(['elbow-flexion-v1', 'shoulder-abduction-v1', CUSTOM_ALGORITHM])

export type CatalogueExercise = {
  /** The published version, which is what a prescription pins. */
  id: string
  name: string
  algorithm: string
  instructions: string
  exerciseId: string
  custom: boolean
  /** False for retired or superseded versions, which stay named on existing plans but cannot be newly assigned. */
  selectable: boolean
  /** The exercise itself is gone, not just this version. The server refuses to publish it, so a plan on it must change exercise. */
  retired: boolean
  joint: Joint | null
}

type Row = {
  id: string
  version: number
  algorithm_key: string
  definition: unknown
  exercises: { id: string; owner_id: string | null } | null
}

const text = (value: unknown) => (typeof value === 'string' ? value : '')
const asJoint = (value: unknown): Joint | null => (JOINTS.includes(value as Joint) ? (value as Joint) : null)

/**
 * Mirrors CatalogueJson on Android. The parent row is hidden by row-level security once an exercise is retired, which
 * keeps it named on existing plans while it can no longer be chosen.
 */
export function decodeCatalogue(rows: readonly Row[], account: string): CatalogueExercise[] {
  // Published versions are immutable and stay readable, so older ones remain in this list for naming existing plans.
  const newest = new Map<string, number>()
  for (const row of rows) if (row.exercises) newest.set(row.exercises.id, Math.max(newest.get(row.exercises.id) ?? 0, row.version))
  return rows.flatMap((row) => {
    const definition = (row.definition ?? {}) as Record<string, unknown>
    const custom = row.algorithm_key === CUSTOM_ALGORITHM
    const joint = custom ? asJoint(definition.measured_joint) : null
    if (!SUPPORTED.has(row.algorithm_key) || (custom && joint === null)) return []
    const parent = row.exercises
    const owner = parent?.owner_id ?? null
    return [{
      id: row.id,
      name: text(definition.name) || row.algorithm_key,
      algorithm: row.algorithm_key,
      instructions: text(definition.instructions_en),
      exerciseId: parent?.id ?? '',
      custom,
      selectable: parent !== null && (owner === null || owner === account) && row.version === newest.get(parent.id),
      retired: parent === null,
      joint,
    }]
  })
}
