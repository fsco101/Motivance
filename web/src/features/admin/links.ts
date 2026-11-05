import { label, type AdminAccount } from './types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** What a person picks. It includes the email because two people can share a name, and picking the wrong one exposes records. */
export const pickerValue = (account: AdminAccount) => `${label(account)} (${account.email})`

/** Resolves a picked value or a pasted ID to an account ID, or null when it matches nobody exactly. */
export function resolveAccount(text: string, accounts: readonly AdminAccount[]) {
  const value = text.trim()
  return accounts.find((account) => pickerValue(account) === value || account.id === value)?.id ?? (UUID.test(value) ? value : null)
}
