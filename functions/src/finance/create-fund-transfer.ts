import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import * as functions from 'firebase-functions/v1'
import { AGENCY_TIME_ZONE } from '../../../shared/calculations/business-date'
import { parseAgencySettings } from '../../../shared/models/agency-config'
import {
  fundTransferInLedgerId,
  fundTransferOutLedgerId,
} from '../../../shared/models/finance'
import {
  fundTransferAccountErrorMessage,
  validateFundTransferAccounts,
} from '../../../shared/rules/fund-transfer'
import { todayHisabBusinessDate, validateHisabBusinessDate } from '../../../shared/rules/hisab-date'
import { createFundTransferSchema, getFundTransferSchema } from '../../../shared/schemas/finance-hisab'
import { requirePermission } from '../auth/permission-guards'
import {
  assertIdempotentOrReplay,
  writeIdempotencyInTx,
} from './financial-ledger'
import {
  commitBalanceDeltasInTx,
  commitLedgerLinesInTx,
  prepareBalanceDocsInTx,
  prepareLedgerLinesInTx,
} from './ledger-write'
import { getGateState, getPublicationPointer, sha256Hex } from './opening-context'

function firstZodMessage(error: { issues: Array<{ message?: string }> }): string {
  return error.issues[0]?.message || 'Invalid request.'
}

function requestHash(payload: unknown): string {
  return sha256Hex(JSON.stringify(payload))
}

/**
 * Phase 5F.2 — ordinary fund transfer between non-portal destinations.
 * Posts atomic fund_transfer_out (debit) + fund_transfer_in (credit).
 * Does not create revenue/expense. Does not touch Godown collections.
 */
export const createFundTransfer = functions.region('asia-south1').https.onCall(async (data, context) => {
  const actorUid = await requirePermission(context, 'finance.transfer')
  const parsed = createFundTransferSchema.safeParse(data)
  if (!parsed.success) {
    throw new functions.https.HttpsError('invalid-argument', firstZodMessage(parsed.error))
  }
  const input = parsed.data

  const [gate, publication] = await Promise.all([getGateState(), getPublicationPointer()])
  if (gate.state !== 'published' || !publication.publishedSessionId || !publication.publishedGenerationId) {
    throw new functions.https.HttpsError('failed-precondition', 'Financial opening is not published.')
  }

  const db = getFirestore()
  const agencySnap = await db.collection('settings').doc('agency').get()
  const agency = parseAgencySettings(agencySnap.data() as Record<string, unknown> | undefined)
  const financialOpeningDate = agency.financialOpeningDate
  if (!financialOpeningDate) {
    throw new functions.https.HttpsError('failed-precondition', 'Financial opening date is missing.')
  }

  const today = todayHisabBusinessDate()
  const dateCheck = validateHisabBusinessDate({
    selected: input.businessDate,
    financialOpeningDate,
    today,
  })
  if (!dateCheck.ok) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      dateCheck.code === 'future'
        ? 'Business date cannot be in the future.'
        : dateCheck.code === 'before_opening'
          ? 'Business date cannot be before the financial opening date.'
          : 'Invalid business date.',
    )
  }

  const accountsCheck = validateFundTransferAccounts({
    sourceAccountId: input.sourceAccountId,
    destinationAccountId: input.destinationAccountId,
    accounts: agency.receivingAccounts,
  })
  if (!accountsCheck.ok) {
    throw new functions.https.HttpsError('failed-precondition', fundTransferAccountErrorMessage(accountsCheck.code))
  }

  const hash = requestHash({
    transactionId: input.transactionId,
    sourceAccountId: input.sourceAccountId,
    destinationAccountId: input.destinationAccountId,
    amountPaise: input.amountPaise,
    businessDate: input.businessDate,
    note: input.note ?? null,
  })

  const outEntryId = fundTransferOutLedgerId(input.transactionId)
  const inEntryId = fundTransferInLedgerId(input.transactionId)

  const result = await db.runTransaction(async (tx) => {
    const replay = await assertIdempotentOrReplay(tx, db, input.idempotencyKey, hash)
    if (replay.replay) {
      return { transactionId: replay.transactionId, reused: true }
    }

    const existingTx = await tx.get(db.collection('transactions').doc(input.transactionId))
    if (existingTx.exists) {
      const existing = existingTx.data() ?? {}
      if (existing.type === 'fund_transfer' && existing.idempotencyKey === input.idempotencyKey) {
        return { transactionId: input.transactionId, reused: true }
      }
      throw new functions.https.HttpsError('already-exists', 'Transaction id is already used.')
    }

    const balances = await prepareBalanceDocsInTx(tx, db, [
      input.sourceAccountId,
      input.destinationAccountId,
    ])
    const sourceBal = balances.get(input.sourceAccountId)
    const destBal = balances.get(input.destinationAccountId)
    if (!sourceBal || !destBal) {
      throw new functions.https.HttpsError('failed-precondition', 'Destination balance is missing.')
    }
    if (
      sourceBal.publishedSessionId !== publication.publishedSessionId ||
      sourceBal.publishedGenerationId !== publication.publishedGenerationId ||
      destBal.publishedSessionId !== publication.publishedSessionId ||
      destBal.publishedGenerationId !== publication.publishedGenerationId
    ) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Balances do not match the publication pointer.',
      )
    }
    if (sourceBal.needsReconciliation === true || destBal.needsReconciliation === true) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Cannot transfer while a destination needs reconciliation.',
      )
    }
    const sourceBalancePaise = Number(sourceBal.balancePaise ?? 0)
    if (sourceBalancePaise < input.amountPaise) {
      throw new functions.https.HttpsError('failed-precondition', 'Insufficient balance in the source destination.')
    }

    const prepared = await prepareLedgerLinesInTx(tx, db, [
      {
        entryId: outEntryId,
        accountId: input.sourceAccountId,
        amountPaise: input.amountPaise,
        direction: 'debit',
        entryClass: 'fund_transfer_out',
        businessDate: input.businessDate,
        transactionId: input.transactionId,
        recordScope: 'operational',
        idempotencyKey: input.idempotencyKey,
      },
      {
        entryId: inEntryId,
        accountId: input.destinationAccountId,
        amountPaise: input.amountPaise,
        direction: 'credit',
        entryClass: 'fund_transfer_in',
        businessDate: input.businessDate,
        transactionId: input.transactionId,
        recordScope: 'operational',
        relatedTransactionId: input.transactionId,
        idempotencyKey: input.idempotencyKey,
      },
    ])
    if (prepared.some((line) => line.conflict)) {
      throw new functions.https.HttpsError('failed-precondition', 'Ledger integrity conflict for this transfer.')
    }
    // Both lines already exist with same hash → treat as replay of a prior successful write.
    if (prepared.length === 2 && prepared.every((line) => line.existsWithSameHash)) {
      writeIdempotencyInTx(tx, db, {
        key: input.idempotencyKey,
        actorUid,
        requestHash: hash,
        transactionId: input.transactionId,
      })
      return { transactionId: input.transactionId, reused: true }
    }

    commitLedgerLinesInTx(tx, db, prepared, actorUid)
    commitBalanceDeltasInTx(tx, db, {
      balances,
      deltas: [
        { accountId: input.sourceAccountId, deltaPaise: -input.amountPaise, transactionId: input.transactionId },
        { accountId: input.destinationAccountId, deltaPaise: input.amountPaise, transactionId: input.transactionId },
      ],
      publishedSessionId: publication.publishedSessionId!,
      publishedGenerationId: publication.publishedGenerationId!,
    })

    tx.set(db.collection('transactions').doc(input.transactionId), {
      type: 'fund_transfer',
      status: 'posted',
      approval: 'not_required',
      businessDate: input.businessDate,
      timezone: AGENCY_TIME_ZONE,
      amountsPaise: { amountPaise: input.amountPaise },
      financePayload: {
        sourceAccountId: input.sourceAccountId,
        destinationAccountId: input.destinationAccountId,
        sourceName: accountsCheck.source.name,
        destinationName: accountsCheck.destination.name,
        note: input.note ?? null,
        outEntryId,
        inEntryId,
      },
      idempotencyKey: input.idempotencyKey,
      createdBy: actorUid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      reversedByTransactionId: null,
      reversalOf: null,
    })

    tx.set(db.collection('auditLogs').doc(), {
      action: 'finance.fund_transfer_created',
      actorUid,
      transactionId: input.transactionId,
      sourceAccountId: input.sourceAccountId,
      destinationAccountId: input.destinationAccountId,
      amountPaise: input.amountPaise,
      businessDate: input.businessDate,
      createdAt: FieldValue.serverTimestamp(),
    })

    writeIdempotencyInTx(tx, db, {
      key: input.idempotencyKey,
      actorUid,
      requestHash: hash,
      transactionId: input.transactionId,
    })

    return { transactionId: input.transactionId, reused: false }
  })

  return {
    ok: true,
    ...result,
    sourceAccountId: input.sourceAccountId,
    destinationAccountId: input.destinationAccountId,
    amountPaise: input.amountPaise,
    businessDate: input.businessDate,
  }
})

/** Read a posted fund transfer for details UI. */
export const getFundTransfer = functions.region('asia-south1').https.onCall(async (data, context) => {
  await requirePermission(context, 'finance.viewBalances')
  const parsed = getFundTransferSchema.safeParse(data)
  if (!parsed.success) {
    throw new functions.https.HttpsError('invalid-argument', firstZodMessage(parsed.error))
  }
  const snap = await getFirestore().collection('transactions').doc(parsed.data.transactionId).get()
  if (!snap.exists) {
    throw new functions.https.HttpsError('not-found', 'Transfer not found.')
  }
  const row = snap.data() ?? {}
  if (row.type !== 'fund_transfer') {
    throw new functions.https.HttpsError('failed-precondition', 'Transaction is not a fund transfer.')
  }
  return {
    id: snap.id,
    type: row.type,
    status: row.status ?? null,
    businessDate: row.businessDate ?? null,
    amountPaise: Number(row.amountsPaise?.amountPaise ?? 0),
    sourceAccountId: row.financePayload?.sourceAccountId ?? null,
    destinationAccountId: row.financePayload?.destinationAccountId ?? null,
    sourceName: row.financePayload?.sourceName ?? null,
    destinationName: row.financePayload?.destinationName ?? null,
    note: row.financePayload?.note ?? null,
    outEntryId: row.financePayload?.outEntryId ?? null,
    inEntryId: row.financePayload?.inEntryId ?? null,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt ?? null,
  }
})
