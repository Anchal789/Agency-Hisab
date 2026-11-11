import { httpsCallable } from 'firebase/functions'
import type {
  CreateGodownSaleInput,
  RecordEmptyReturnInput,
  ReverseGodownSaleInput,
  UpdateGodownSaleInput,
} from '@shared/schemas/godown'
import { getFirebase } from '@/services/firebase/client'

export async function createGodownSale(
  input: CreateGodownSaleInput,
): Promise<{ id: string; reused: boolean }> {
  const callable = httpsCallable<CreateGodownSaleInput, { id: string; reused: boolean }>(
    getFirebase().functions,
    'createGodownSale',
  )
  const result = await callable(input)
  return result.data
}

export async function updateGodownSale(input: UpdateGodownSaleInput): Promise<{ id: string }> {
  const callable = httpsCallable<UpdateGodownSaleInput, { id: string }>(
    getFirebase().functions,
    'updateGodownSale',
  )
  const result = await callable(input)
  return result.data
}

export async function reverseGodownSale(input: ReverseGodownSaleInput): Promise<{ id: string }> {
  const callable = httpsCallable<ReverseGodownSaleInput, { id: string }>(
    getFirebase().functions,
    'reverseGodownSale',
  )
  const result = await callable(input)
  return result.data
}

export async function recordEmptyReturn(
  input: RecordEmptyReturnInput,
): Promise<{ id: string; reused: boolean }> {
  const callable = httpsCallable<RecordEmptyReturnInput, { id: string; reused: boolean }>(
    getFirebase().functions,
    'recordEmptyReturn',
  )
  const result = await callable(input)
  return result.data
}

export function newTransactionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `tx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}
