/** <account id>/<32 random hex>.webp or .jpg in the public `avatars` bucket, as the database's check constraint allows. */
export const PHOTO_PATH = /^[0-9a-f-]{36}\/[0-9a-f]{32}\.(webp|jpg)$/

/**
 * The address of a stored profile photo. The database keeps only the file's path, because the same file is reached through
 * different hosts; this joins it to the backend the app talks to. Anything that is not a Motivance photo path gives null,
 * so a stored value can never point the browser elsewhere.
 */
export function photoAddress(path: string | null | undefined, base = import.meta.env.VITE_SUPABASE_URL as string | undefined) {
  if (!path || !base || !PHOTO_PATH.test(path)) return null
  return `${base.replace(/\/+$/, '')}/storage/v1/object/public/avatars/${path}`
}
