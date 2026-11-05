import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

let client: SupabaseClient<Database> | undefined

function environment() {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined
  if (!url || !key) throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in web/.env')
  return { url, key }
}

/** Created on first use, so screens that need no backend, like the design gallery, can run without one. */
export function supabase() {
  if (!client) {
    const { url, key } = environment()
    client = createClient<Database>(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } })
  }
  return client
}

/**
 * Verifying a recovery code signs the person in. This separate, unsaved session keeps that from reaching the app until
 * the new password is accepted, so a rejected password stays on the form. Android holds its session back the same way.
 */
export function recoveryClient() {
  const { url, key } = environment()
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'motivance-recovery' } })
}
