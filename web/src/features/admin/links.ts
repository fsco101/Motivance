import { label, primaryRole, type AdminAccount } from './types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** What a person picks. It includes the email because two people can share a name, and picking the wrong one exposes records. */
export const pickerValue = (account: AdminAccount) => `${label(account)} (${account.email})`

/** Resolves a picked value or a pasted ID to an account ID, or null when it matches nobody exactly. */
export function resolveAccount(text: string, accounts: readonly AdminAccount[]) {
  const value = text.trim()
  return accounts.find((account) => pickerValue(account) === value || account.id === value)?.id ?? (UUID.test(value) ? value : null)
}

/** Who can be linked, as on Android: the server refuses disabled accounts, and staff are not patients. */
export const therapistChoices = (accounts: readonly AdminAccount[]) => accounts.filter((account) => account.active && account.roles.includes('therapist'))
export const patientChoices = (accounts: readonly AdminAccount[]) => accounts.filter((account) => account.active && primaryRole(account) === 'patient')
