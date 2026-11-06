import { httpsCallable } from 'firebase/functions'
import type { ManageAgencyConfigInput } from '@shared/schemas/agency-settings'
import { getFirebase } from '@/services/firebase/client'

export async function manageAgencyConfig(input: ManageAgencyConfigInput): Promise<{ ok: true; id?: string }> {
  const callable = httpsCallable<ManageAgencyConfigInput, { ok: true; id?: string }>(
    getFirebase().functions,
    'manageAgencyConfig',
  )
  const result = await callable(input)
  return result.data
}
