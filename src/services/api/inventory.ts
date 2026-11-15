import { httpsCallable } from 'firebase/functions'
import type {
  ApproveInventoryTransactionInput,
  CreateStockOpeningInput,
  CreateStockReceiptInput,
  CreateStockReconciliationInput,
  CreateStockReturnToDistributorInput,
  CreateStockTransferInput,
  RejectInventoryTransactionInput,
} from '@shared/schemas/inventory'
import { getFirebase } from '@/services/firebase/client'

type CreateResult = { id: string; reused: boolean; status: string }

export async function createStockOpening(input: CreateStockOpeningInput): Promise<CreateResult> {
  const callable = httpsCallable<CreateStockOpeningInput, CreateResult>(getFirebase().functions, 'createStockOpening')
  return (await callable(input)).data
}

export async function createStockReceipt(input: CreateStockReceiptInput): Promise<CreateResult> {
  const callable = httpsCallable<CreateStockReceiptInput, CreateResult>(getFirebase().functions, 'createStockReceipt')
  return (await callable(input)).data
}

export async function createStockReturnToDistributor(
  input: CreateStockReturnToDistributorInput,
): Promise<CreateResult> {
  const callable = httpsCallable<CreateStockReturnToDistributorInput, CreateResult>(
    getFirebase().functions,
    'createStockReturnToDistributor',
  )
  return (await callable(input)).data
}

export async function createStockTransfer(input: CreateStockTransferInput): Promise<CreateResult> {
  const callable = httpsCallable<CreateStockTransferInput, CreateResult>(
    getFirebase().functions,
    'createStockTransfer',
  )
  return (await callable(input)).data
}

export async function createStockReconciliation(input: CreateStockReconciliationInput): Promise<CreateResult> {
  const callable = httpsCallable<CreateStockReconciliationInput, CreateResult>(
    getFirebase().functions,
    'createStockReconciliation',
  )
  return (await callable(input)).data
}

export async function approveInventoryTransaction(
  input: ApproveInventoryTransactionInput,
): Promise<{ id: string }> {
  const callable = httpsCallable<ApproveInventoryTransactionInput, { id: string }>(
    getFirebase().functions,
    'approveInventoryTransaction',
  )
  return (await callable(input)).data
}

export async function rejectInventoryTransaction(
  input: RejectInventoryTransactionInput,
): Promise<{ id: string }> {
  const callable = httpsCallable<RejectInventoryTransactionInput, { id: string }>(
    getFirebase().functions,
    'rejectInventoryTransaction',
  )
  return (await callable(input)).data
}

export function newInventoryTransactionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}
