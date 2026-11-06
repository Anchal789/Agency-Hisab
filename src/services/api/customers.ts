import { httpsCallable } from 'firebase/functions'
import type {
  CommitCustomerImportInput,
  CreateCustomerInput,
  UpdateCustomerInput,
} from '@shared/schemas/customer'
import { getFirebase } from '@/services/firebase/client'

export async function createCustomer(input: CreateCustomerInput): Promise<{ id: string }> {
  const callable = httpsCallable<CreateCustomerInput, { id: string }>(getFirebase().functions, 'createCustomer')
  const result = await callable(input)
  return result.data
}

export async function updateCustomer(input: UpdateCustomerInput): Promise<{ id: string }> {
  const callable = httpsCallable<UpdateCustomerInput, { id: string }>(getFirebase().functions, 'updateCustomer')
  const result = await callable(input)
  return result.data
}

export async function checkCustomerConsumerNumbers(consumerNumbers: string[]): Promise<string[]> {
  const callable = httpsCallable<{ consumerNumbers: string[] }, { existing: string[] }>(
    getFirebase().functions,
    'checkCustomerConsumerNumbers',
  )
  const result = await callable({ consumerNumbers })
  return result.data.existing
}

export type CommitCustomerImportResult = {
  batchId: string
  createdCount: number
  skippedCount: number
  skipped: Array<{ rowNumber: number; consumerNumber: string; reason: string }>
  duplicate: boolean
}

export async function commitCustomerImport(input: CommitCustomerImportInput): Promise<CommitCustomerImportResult> {
  const callable = httpsCallable<CommitCustomerImportInput, CommitCustomerImportResult>(
    getFirebase().functions,
    'commitCustomerImport',
  )
  const result = await callable(input)
  return result.data
}
