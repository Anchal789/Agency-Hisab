import { httpsCallable } from 'firebase/functions'
import type {
  ChangeOwnPasswordInput,
  CreateStaffInput,
  ResetStaffPasswordInput,
  UpdateStaffAccessInput,
} from '@shared/schemas/staff'
import { getFirebase } from '@/services/firebase/client'

export async function createStaffAccount(input: CreateStaffInput): Promise<{ uid: string }> {
  const callable = httpsCallable<CreateStaffInput, { uid: string }>(getFirebase().functions, 'createStaffUser')
  const result = await callable(input)
  return result.data
}

export async function updateStaffAccount(input: UpdateStaffAccessInput): Promise<void> {
  const callable = httpsCallable(getFirebase().functions, 'updateStaffAccess')
  await callable(input)
}

export async function resetStaffPassword(input: ResetStaffPasswordInput): Promise<void> {
  const callable = httpsCallable(getFirebase().functions, 'resetStaffPassword')
  await callable(input)
}

export async function changeOwnPassword(input: ChangeOwnPasswordInput): Promise<void> {
  const callable = httpsCallable(getFirebase().functions, 'changeOwnPassword')
  await callable(input)
}
