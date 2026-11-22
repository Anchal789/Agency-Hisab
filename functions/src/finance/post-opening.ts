import { FieldValue, getFirestore, type DocumentData } from 'firebase-admin/firestore'
import * as functions from 'firebase-functions/v1'
import { AGENCY_TIME_ZONE, businessDateInTimeZone } from '../../../shared/calculations/business-date'
import {
  OPENING_CHUNK_DEFAULT_SALES,
  OPENING_MAX_DESTINATIONS,
  classifyGodownSaleCohort,
  publishedBalancePaise,
  splitSaleIdsForBudget,
} from '../../../shared/calculations/finance-classification'
import { parseAgencySettings } from '../../../shared/models/agency-config'
import {
  destinationOpeningLedgerId,
  saleCollectionLedgerId,
} from '../../../shared/models/finance'
import { resolveDestinationOwnership } from '../../../shared/rules/destination-ownership'
import { evaluateOpeningAnchor } from '../../../shared/rules/opening-anchor'
import {
  abandonFinancialOpeningSealSchema,
  beginFinancialOpeningSealSchema,
  buildOpeningRollupSchema,
  listOpeningReviewsSchema,
  markOpeningReadySchema,
  materializeOpeningReceivablesSchema,
  planFinancialOpeningSchema,
  prepareOpeningChunkSchema,
  publishFinancialOpeningSchema,
  saveOpeningBalanceSheetSchema,
  verifyOpeningReceivableSchema,
} from '../../../shared/schemas/finance-opening'
import { requireAdmin } from '../auth/guards'
import { createMoneyObligationForSaleInTx } from './money-obligation-claims'
import { assertIdempotentOrReplay, writeIdempotencyInTx } from './financial-ledger'
import { commitLedgerLinesInTx, prepareLedgerLinesInTx } from './ledger-write'
import {
  GATE_DOC,
  PUBLICATION_DOC,
  gateRef,
  getGateState,
  hashSaleIds,
  loadOpeningWorkerGuardsInTx,
  newGenerationId,
  planRef,
  publicationRef,
  sessionRef,
  sha256Hex,
} from './opening-context'

function requestHash(payload: unknown): string {
  return sha256Hex(JSON.stringify(payload))
}

function firstZodMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message || 'Invalid request.'
}

async function requireOwnershipReady() {
  const agencySnap = await getFirestore().collection('settings').doc('agency').get()
  const agency = parseAgencySettings(agencySnap.data() as Record<string, unknown> | undefined)
  const resolved = resolveDestinationOwnership(agency.receivingAccounts)
  if (!resolved.ok) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      resolved.details.join(' ') || 'Destination ownership is not ready.',
    )
  }
  return { agency, matches: resolved.matches }
}

export const beginFinancialOpeningSeal = functions
  .region('asia-south1')
  .https.onCall(async (data, context) => {
    const actorUid = requireAdmin(context)
    const parsed = beginFinancialOpeningSealSchema.safeParse(data)
    if (!parsed.success) {
      throw new functions.https.HttpsError('invalid-argument', firstZodMessage(parsed.error))
    }
    const input = parsed.data
    await requireOwnershipReady()

    const db = getFirestore()
    const anchorSnap = await db.collection('transactions').doc(input.anchorTransactionId).get()
    const anchorData = anchorSnap.exists ? (anchorSnap.data() ?? {}) : null
    const anchorEval = evaluateOpeningAnchor({
      transaction: anchorData
        ? {
            id: anchorSnap.id,
            type: String(anchorData.type ?? ''),
            status: String(anchorData.status ?? ''),
            businessDate: String(anchorData.businessDate ?? ''),
            note: typeof anchorData.note === 'string' ? anchorData.note : null,
            quantities:
              anchorData.quantities && typeof anchorData.quantities === 'object'
                ? (anchorData.quantities as { filledIssued?: number })
                : null,
            inventoryPayload:
              anchorData.inventoryPayload && typeof anchorData.inventoryPayload === 'object'
                ? (anchorData.inventoryPayload as Record<string, unknown>)
                : null,
            reversedByTransactionId:
              typeof anchorData.reversedByTransactionId === 'string'
                ? anchorData.reversedByTransactionId
                : null,
            reversalOf: typeof anchorData.reversalOf === 'string' ? anchorData.reversalOf : null,
          }
        : null,
      openingDate: input.openingDate,
      mismatchReason: input.anchorDateMismatchReason,
    })
    if (!anchorEval.ok) {
      const code =
        anchorEval.code === 'not_found'
          ? 'not-found'
          : anchorEval.code === 'date_mismatch'
            ? 'invalid-argument'
            : 'failed-precondition'
      throw new functions.https.HttpsError(code, anchorEval.message)
    }
    const anchorDate = anchorEval.businessDate

    const priorAnchorSessions = await db
      .collection('openingSessions')
      .where('anchorTransactionId', '==', input.anchorTransactionId)
      .limit(10)
      .get()
    const conflictingSession = priorAnchorSessions.docs.find((doc) => {
      if (doc.id === input.sessionId) return false
      const state = String(doc.data()?.state ?? '')
      return state !== 'abandoned'
    })
    if (conflictingSession) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'This stock receipt already anchors another financial opening session.',
      )
    }

    const hash = requestHash(input)
    const generationId = newGenerationId()

    const result = await db.runTransaction(async (tx) => {
      const replay = await assertIdempotentOrReplay(tx, db, input.idempotencyKey, hash)
      if (replay.replay) {
        return { sessionId: replay.transactionId, generationId: null as string | null, reused: true }
      }

      const gateSnap = await tx.get(gateRef())
      const gate = gateSnap.data() ?? {}
      if (gateSnap.exists && gate.state && gate.state !== 'not_opened') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Financial opening is already sealing or published.',
        )
      }

      const pubSnap = await tx.get(publicationRef())
      const pub = pubSnap.data() ?? {}
      if (typeof pub.publishedSessionId === 'string') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Financial opening is already published.',
        )
      }

      tx.set(sessionRef(input.sessionId), {
        state: 'preparing',
        fence: 1,
        generationId,
        openingDate: input.openingDate,
        anchorTransactionId: input.anchorTransactionId,
        anchorBusinessDate: anchorDate,
        anchorDateMismatchReason: input.anchorDateMismatchReason ?? null,
        mutationEpochAtPlan: 0,
        createdBy: actorUid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      tx.set(gateRef(), {
        state: 'sealing',
        mutationEpoch: 0,
        activeSessionId: input.sessionId,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid,
      })
      if (!pubSnap.exists) {
        tx.set(publicationRef(), {
          publishedSessionId: null,
          publishedGenerationId: null,
          publishedAt: null,
        })
      }
      writeIdempotencyInTx(tx, db, {
        key: input.idempotencyKey,
        actorUid,
        requestHash: hash,
        transactionId: input.sessionId,
      })
      tx.set(db.collection('auditLogs').doc(), {
        action: 'finance.opening.begin',
        actorUid,
        sessionId: input.sessionId,
        generationId,
        openingDate: input.openingDate,
        createdAt: FieldValue.serverTimestamp(),
      })
      return { sessionId: input.sessionId, generationId, reused: false }
    })

    return result
  })

export const saveOpeningBalanceSheet = functions.region('asia-south1').https.onCall(async (data, context) => {
  const actorUid = requireAdmin(context)
  const parsed = saveOpeningBalanceSheetSchema.safeParse(data)
  if (!parsed.success) {
    throw new functions.https.HttpsError('invalid-argument', firstZodMessage(parsed.error))
  }
  const input = parsed.data
  const { matches } = await requireOwnershipReady()
  const allowedIds = new Set(matches.map((row) => row.accountId))
  if (input.balances.length > OPENING_MAX_DESTINATIONS) {
    throw new functions.https.HttpsError('invalid-argument', 'At most 40 destinations are allowed.')
  }
  if (input.balances.length !== matches.length) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Enter an opening amount for every configured payment destination.',
    )
  }
  const seen = new Set<string>()
  for (const row of input.balances) {
    if (!allowedIds.has(row.accountId)) {
      throw new functions.https.HttpsError('invalid-argument', `Unknown destination ${row.accountId}.`)
    }
    if (seen.has(row.accountId)) {
      throw new functions.https.HttpsError('invalid-argument', 'Duplicate destination in opening balances.')
    }
    seen.add(row.accountId)
  }
  if (!input.ownerLoanVerified) {
    throw new functions.https.HttpsError('invalid-argument', 'Owner loan must be explicitly verified.')
  }

  const db = getFirestore()
  const hash = requestHash(input)
  await db.runTransaction(async (tx) => {
    const replay = await assertIdempotentOrReplay(tx, db, input.idempotencyKey, hash)
    if (replay.replay) return

    const sessionSnap = await tx.get(sessionRef(input.sessionId))
    if (!sessionSnap.exists) throw new functions.https.HttpsError('not-found', 'Session not found.')
    const session = sessionSnap.data() ?? {}
    if (session.state !== 'preparing') {
      throw new functions.https.HttpsError(
        'failed-precondition',
        session.state === 'ready_to_publish'
          ? 'Setup is ready to publish. Finish publishing, or cancel setup before changing balances.'
          : 'Session must be preparing.',
      )
    }
    if (session.generationId !== input.generationId || Number(session.fence) !== input.fence) {
      throw new functions.https.HttpsError('failed-precondition', 'Stale opening worker.')
    }

    const sheetId = `${input.sessionId}_${input.generationId}`
    const amounts: Record<string, number> = {}
    for (const row of input.balances) amounts[row.accountId] = row.amountPaise

    const preparedLedger = await prepareLedgerLinesInTx(
      tx,
      db,
      input.balances.map((row) => ({
        entryId: destinationOpeningLedgerId(input.sessionId, input.generationId, row.accountId),
        accountId: row.accountId,
        amountPaise: row.amountPaise,
        direction: 'credit' as const,
        entryClass: 'destination_opening' as const,
        businessDate: String(session.openingDate),
        transactionId: `opening_${input.sessionId}`,
        recordScope: 'opening' as const,
        openingSessionId: input.sessionId,
        openingGenerationId: input.generationId,
      })),
    )

    tx.set(db.collection('openingBalanceSheets').doc(sheetId), {
      sessionId: input.sessionId,
      openingGenerationId: input.generationId,
      amountsPaise: amounts,
      ownerLoanOutstandingPaise: input.ownerLoanOutstandingPaise,
      ownerLoanVerified: true,
      verifiedBy: actorUid,
      verifiedAt: FieldValue.serverTimestamp(),
    })
    commitLedgerLinesInTx(tx, db, preparedLedger, actorUid)

    writeIdempotencyInTx(tx, db, {
      key: input.idempotencyKey,
      actorUid,
      requestHash: hash,
      transactionId: sheetId,
    })
  })
  return { ok: true }
})

export const planFinancialOpening = functions.region('asia-south1').https.onCall(async (data, context) => {
  const actorUid = requireAdmin(context)
  const parsed = planFinancialOpeningSchema.safeParse(data)
  if (!parsed.success) {
    throw new functions.https.HttpsError('invalid-argument', firstZodMessage(parsed.error))
  }
  const input = parsed.data
  const db = getFirestore()

  const sessionSnap = await sessionRef(input.sessionId).get()
  if (!sessionSnap.exists) throw new functions.https.HttpsError('not-found', 'Session not found.')
  const session = sessionSnap.data() ?? {}
  if (session.state !== 'preparing') {
    throw new functions.https.HttpsError(
      'failed-precondition',
      session.state === 'ready_to_publish'
        ? 'Setup is ready to publish. Finish publishing, or cancel setup before preparing records again.'
        : 'Session must be preparing.',
    )
  }
  if (session.generationId !== input.generationId || Number(session.fence) !== input.fence) {
    throw new functions.https.HttpsError('failed-precondition', 'Stale opening worker.')
  }

  const gate = await getGateState()
  if (gate.state !== 'sealing') {
    throw new functions.https.HttpsError('failed-precondition', 'Gate must be sealing.')
  }
  const openingDate = String(session.openingDate)
  const today = businessDateInTimeZone(new Date(), AGENCY_TIME_ZONE)

  // Page sales outside the transaction (bounded pages).
  const salesSnap = await db
    .collection('transactions')
    .where('type', '==', 'godown_sale')
    .where('status', '==', 'posted')
    .get()

  const pre: string[] = []
  const bridge: string[] = []
  const future: string[] = []
  for (const doc of salesSnap.docs) {
    const row = doc.data()
    const businessDate = String(row.businessDate ?? '')
    const cohort = classifyGodownSaleCohort({ businessDate, openingDate, today })
    if (cohort === 'pre_cutover') pre.push(doc.id)
    else if (cohort === 'post_cutover') bridge.push(doc.id)
    else future.push(doc.id)
  }
  pre.sort()
  bridge.sort()
  future.sort()

  const preParts = splitSaleIdsForBudget(pre, OPENING_CHUNK_DEFAULT_SALES)
  const bridgeParts = splitSaleIdsForBudget(bridge, OPENING_CHUNK_DEFAULT_SALES)
  const futureParts = splitSaleIdsForBudget(future, OPENING_CHUNK_DEFAULT_SALES)

  const rebuildParts = (
    parts: string[][],
    cohort: 'pre_cutover' | 'post_cutover' | 'future_dated',
    prefix: string,
  ) => {
    return parts.map((saleIds, index) => {
      const chunkId = `${input.sessionId}_${input.generationId}_${prefix}_${index}_p0`
      return { chunkId, cohort, saleIds, idsHash: hashSaleIds(saleIds) }
    })
  }
  const chunks = [
    ...rebuildParts(preParts, 'pre_cutover', 'pre'),
    ...rebuildParts(bridgeParts, 'post_cutover', 'bridge'),
    ...rebuildParts(futureParts, 'future_dated', 'future'),
  ]

  const hash = requestHash({ ...input, mutationEpoch: gate.mutationEpoch, chunks: chunks.map((c) => c.chunkId) })

  await db.runTransaction(async (tx) => {
    const replay = await assertIdempotentOrReplay(tx, db, input.idempotencyKey, hash)
    if (replay.replay) return

    await loadOpeningWorkerGuardsInTx(tx, {
      sessionId: input.sessionId,
      generationId: input.generationId,
      fence: input.fence,
      mutationEpoch: gate.mutationEpoch,
      expectedStates: ['preparing'],
    })

    const planId = `${input.sessionId}_${input.generationId}`
    tx.set(planRef(input.sessionId, input.generationId), {
      sessionId: input.sessionId,
      openingGenerationId: input.generationId,
      fence: input.fence,
      mutationEpoch: gate.mutationEpoch,
      openingDate,
      classificationAsOfDate: today,
      expectedPreCount: pre.length,
      expectedBridgeCount: bridge.length,
      expectedFutureCount: future.length,
      expectedChunkCount: chunks.length,
      chunkIds: chunks.map((c) => c.chunkId),
      preHash: hashSaleIds(pre),
      bridgeHash: hashSaleIds(bridge),
      futureHash: hashSaleIds(future),
      planHash: sha256Hex(chunks.map((c) => c.idsHash).join('|')),
      createdBy: actorUid,
      createdAt: FieldValue.serverTimestamp(),
    })

    for (const chunk of chunks) {
      tx.set(db.collection('openingChunks').doc(chunk.chunkId), {
        sessionId: input.sessionId,
        openingGenerationId: input.generationId,
        cohort: chunk.cohort,
        saleIds: chunk.saleIds,
        idsHash: chunk.idsHash,
        saleCount: chunk.saleIds.length,
      })
    }

    tx.update(sessionRef(input.sessionId), {
      mutationEpochAtPlan: gate.mutationEpoch,
      updatedAt: FieldValue.serverTimestamp(),
    })

    writeIdempotencyInTx(tx, db, {
      key: input.idempotencyKey,
      actorUid,
      requestHash: hash,
      transactionId: planId,
    })
  })

  return {
    ok: true,
    expectedPreCount: pre.length,
    expectedBridgeCount: bridge.length,
    expectedFutureCount: future.length,
    expectedChunkCount: chunks.length,
    chunkIds: chunks.map((c) => c.chunkId),
  }
})

export const prepareOpeningChunk = functions.region('asia-south1').https.onCall(async (data, context) => {
  const actorUid = requireAdmin(context)
  const parsed = prepareOpeningChunkSchema.safeParse(data)
  if (!parsed.success) {
    throw new functions.https.HttpsError('invalid-argument', firstZodMessage(parsed.error))
  }
  const input = parsed.data
  const db = getFirestore()
  const hash = requestHash(input)

  const chunkSnap = await db.collection('openingChunks').doc(input.chunkId).get()
  if (!chunkSnap.exists) throw new functions.https.HttpsError('not-found', 'Chunk not found.')
  const chunk = chunkSnap.data() ?? {}
  if (chunk.openingGenerationId !== input.generationId || chunk.sessionId !== input.sessionId) {
    throw new functions.https.HttpsError('failed-precondition', 'Chunk does not match session/generation.')
  }
  const saleIds = Array.isArray(chunk.saleIds) ? (chunk.saleIds as string[]) : []
  const cohort = String(chunk.cohort)
  const sessionSnap = await sessionRef(input.sessionId).get()
  const openingDate = String(sessionSnap.data()?.openingDate ?? '')

  await db.runTransaction(async (tx) => {
    const replay = await assertIdempotentOrReplay(tx, db, input.idempotencyKey, hash)
    if (replay.replay) return

    const gateSnap = await tx.get(gateRef())
    const gate = gateSnap.data() ?? {}
    await loadOpeningWorkerGuardsInTx(tx, {
      sessionId: input.sessionId,
      generationId: input.generationId,
      fence: input.fence,
      mutationEpoch: Number(gate.mutationEpoch ?? 0),
      expectedStates: ['preparing'],
    })

    const planSnap = await tx.get(planRef(input.sessionId, input.generationId))
    if (!planSnap.exists) {
      throw new functions.https.HttpsError('failed-precondition', 'Opening plan is missing.')
    }
    if (Number(planSnap.data()?.mutationEpoch) !== Number(gate.mutationEpoch ?? 0)) {
      throw new functions.https.HttpsError('failed-precondition', 'Plan mutation epoch is stale.')
    }

    const today = businessDateInTimeZone(new Date(), AGENCY_TIME_ZONE)
    const expectedCohort =
      cohort === 'pre_cutover' ? 'pre_cutover' : cohort === 'post_cutover' ? 'post_cutover' : 'future_dated'

    type SalePrep = {
      saleId: string
      sale: DocumentData
      actual: 'pre_cutover' | 'post_cutover' | 'future_dated'
      receivedPaise: number
      duePaise: number
      salePaise: number
      accountId: string | null
      contentHash: string
      cutoverExistsSame: boolean
      cutoverConflict: boolean
    }

    const salePreps: SalePrep[] = []
    const ledgerInputs: Parameters<typeof prepareLedgerLinesInTx>[2] = []

    for (const saleId of saleIds) {
      const saleSnap = await tx.get(db.collection('transactions').doc(saleId))
      if (!saleSnap.exists) {
        throw new functions.https.HttpsError('failed-precondition', `Sale ${saleId} missing.`)
      }
      const sale = saleSnap.data() ?? {}
      if (sale.type !== 'godown_sale' || sale.status !== 'posted') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Sale ${saleId} is no longer an eligible posted godown sale.`,
        )
      }
      const businessDate = String(sale.businessDate ?? '')
      const actual = classifyGodownSaleCohort({ businessDate, openingDate, today })
      if (actual !== expectedCohort) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Sale ${saleId} cohort changed; rebuild the plan.`,
        )
      }
      const amounts = sale.amountsPaise ?? {}
      const receivedPaise = Number(amounts.receivedPaise ?? 0)
      const duePaise = Number(amounts.duePaise ?? 0)
      const salePaise = Number(amounts.salePaise ?? 0)
      const accountId = typeof sale.receivingAccountId === 'string' ? sale.receivingAccountId : null
      const contentHash = sha256Hex(
        [actual, businessDate, salePaise, receivedPaise, duePaise, accountId ?? ''].join('|'),
      )
      const existingCutover = await tx.get(db.collection('saleCutoverRecords').doc(saleId))
      salePreps.push({
        saleId,
        sale,
        actual,
        receivedPaise,
        duePaise,
        salePaise,
        accountId,
        contentHash,
        cutoverExistsSame: existingCutover.exists && existingCutover.data()?.contentHash === contentHash,
        cutoverConflict: existingCutover.exists && existingCutover.data()?.contentHash !== contentHash,
      })
      if (actual === 'post_cutover' && receivedPaise > 0 && accountId) {
        ledgerInputs.push({
          entryId: saleCollectionLedgerId(saleId, accountId),
          accountId,
          amountPaise: receivedPaise,
          direction: 'credit',
          entryClass: 'sale_collection',
          businessDate,
          transactionId: saleId,
          recordScope: 'opening',
          openingSessionId: input.sessionId,
          openingGenerationId: input.generationId,
          customerId: typeof sale.customerId === 'string' ? sale.customerId : null,
        })
      }
    }

    const preparedLedger = await prepareLedgerLinesInTx(tx, db, ledgerInputs)

    // --- writes only below ---
    const bridgeNetByAccount: Record<string, number> = {}
    for (const prep of salePreps) {
      if (prep.cutoverConflict) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Cutover integrity conflict for ${prep.saleId}.`,
        )
      }
      if (!prep.cutoverExistsSame) {
        tx.set(db.collection('saleCutoverRecords').doc(prep.saleId), {
          saleId: prep.saleId,
          cohort: prep.actual,
          businessDateAtClassification: String(prep.sale.businessDate ?? ''),
          salePaise: prep.salePaise,
          receivedPaise: prep.receivedPaise,
          duePaise: prep.duePaise,
          receivingAccountId: prep.accountId,
          recordScope: 'opening',
          openingSessionId: input.sessionId,
          openingGenerationId: input.generationId,
          financeEffect:
            prep.actual === 'pre_cutover'
              ? 'opening_snapshot'
              : prep.actual === 'post_cutover'
                ? 'phase5_posted'
                : 'deferred',
          receivableStatus: 'none',
          historicalExceptionState: null,
          contentHash: prep.contentHash,
          createdBy: actorUid,
          createdAt: FieldValue.serverTimestamp(),
        })
      }

      if (prep.actual === 'pre_cutover') {
        let snapshotStatus: 'captured' | 'zero_collection' | 'incomplete' = 'incomplete'
        if (prep.receivedPaise === 0) snapshotStatus = 'zero_collection'
        else if (prep.receivedPaise > 0 && prep.accountId) snapshotStatus = 'captured'
        tx.set(
          db.collection('openingCollectionSnapshots').doc(prep.saleId),
          {
            saleId: prep.saleId,
            snapshotStatus,
            amountPaise: prep.receivedPaise,
            accountId: prep.accountId,
            recordScope: 'opening',
            openingSessionId: input.sessionId,
            openingGenerationId: input.generationId,
            varianceClass: null,
            reason: null,
            createdBy: actorUid,
            createdAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
      } else if (prep.actual === 'post_cutover') {
        if (prep.receivedPaise > 0 && prep.accountId) {
          bridgeNetByAccount[prep.accountId] =
            (bridgeNetByAccount[prep.accountId] ?? 0) + prep.receivedPaise
        }
        tx.set(
          db.collection('openingCollectionSnapshots').doc(prep.saleId),
          {
            saleId: prep.saleId,
            snapshotStatus: 'not_applicable',
            amountPaise: 0,
            accountId: null,
            recordScope: 'opening',
            openingSessionId: input.sessionId,
            openingGenerationId: input.generationId,
            createdBy: actorUid,
            createdAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
      }
    }

    commitLedgerLinesInTx(tx, db, preparedLedger, actorUid)

    tx.set(db.collection('openingChunkCompletions').doc(input.chunkId), {
      sessionId: input.sessionId,
      openingGenerationId: input.generationId,
      chunkId: input.chunkId,
      saleCount: saleIds.length,
      idsHash: chunk.idsHash,
      perAccountBridgeNetPaise: bridgeNetByAccount,
      completedBy: actorUid,
      completedAt: FieldValue.serverTimestamp(),
    })

    writeIdempotencyInTx(tx, db, {
      key: input.idempotencyKey,
      actorUid,
      requestHash: hash,
      transactionId: input.chunkId,
    })
  })

  return { ok: true, chunkId: input.chunkId }
})

export const verifyOpeningReceivable = functions.region('asia-south1').https.onCall(async (data, context) => {
  const actorUid = requireAdmin(context)
  const parsed = verifyOpeningReceivableSchema.safeParse(data)
  if (!parsed.success) {
    throw new functions.https.HttpsError('invalid-argument', firstZodMessage(parsed.error))
  }
  const input = parsed.data
  if (input.decision === 'exclude' && !input.reason) {
    throw new functions.https.HttpsError('invalid-argument', 'Exclusion requires a reason.')
  }

  const db = getFirestore()
  const saleSnap = await db.collection('transactions').doc(input.saleId).get()
  if (!saleSnap.exists) throw new functions.https.HttpsError('not-found', 'Sale not found.')
  const sale = saleSnap.data() ?? {}
  const historicalDue = Number(sale.amountsPaise?.duePaise ?? 0)
  if (input.approvedAmountPaise !== historicalDue && !input.reason) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Changing the approved amount requires a reason.',
    )
  }

  const reviewId = `${input.sessionId}_${input.generationId}_${input.saleId}`
  const hash = requestHash(input)
  await db.runTransaction(async (tx) => {
    const replay = await assertIdempotentOrReplay(tx, db, input.idempotencyKey, hash)
    if (replay.replay) return
    const gateSnap = await tx.get(gateRef())
    await loadOpeningWorkerGuardsInTx(tx, {
      sessionId: input.sessionId,
      generationId: input.generationId,
      fence: input.fence,
      mutationEpoch: Number(gateSnap.data()?.mutationEpoch ?? 0),
      expectedStates: ['preparing'],
    })
    tx.set(db.collection('openingReceivableReviews').doc(reviewId), {
      sourceSaleId: input.saleId,
      historicalDuePaise: historicalDue,
      approvedAmountPaise: input.decision === 'exclude' ? 0 : input.approvedAmountPaise,
      decision: input.decision,
      reason: input.reason ?? null,
      customerId: typeof sale.customerId === 'string' ? sale.customerId : null,
      customerName: sale.customerSnapshot?.name ?? '',
      businessDate: sale.businessDate,
      openingSessionId: input.sessionId,
      openingGenerationId: input.generationId,
      verifiedBy: actorUid,
      verifiedAt: FieldValue.serverTimestamp(),
    })
    writeIdempotencyInTx(tx, db, {
      key: input.idempotencyKey,
      actorUid,
      requestHash: hash,
      transactionId: reviewId,
    })
  })
  return { ok: true, reviewId }
})

export const materializeOpeningReceivables = functions
  .region('asia-south1')
  .https.onCall(async (data, context) => {
    const actorUid = requireAdmin(context)
    const parsed = materializeOpeningReceivablesSchema.safeParse(data)
    if (!parsed.success) {
      throw new functions.https.HttpsError('invalid-argument', firstZodMessage(parsed.error))
    }
    const input = parsed.data
    const db = getFirestore()
    // One sale per transaction so claim reads stay before writes.
    for (const saleId of input.saleIds) {
      const saleHash = requestHash({ ...input, saleId })
      await db.runTransaction(async (tx) => {
        const replay = await assertIdempotentOrReplay(
          tx,
          db,
          `${input.idempotencyKey}_${saleId}`,
          saleHash,
        )
        if (replay.replay) return
        const gateSnap = await tx.get(gateRef())
        await loadOpeningWorkerGuardsInTx(tx, {
          sessionId: input.sessionId,
          generationId: input.generationId,
          fence: input.fence,
          mutationEpoch: Number(gateSnap.data()?.mutationEpoch ?? 0),
          expectedStates: ['preparing'],
        })
        const reviewId = `${input.sessionId}_${input.generationId}_${saleId}`
        const reviewSnap = await tx.get(db.collection('openingReceivableReviews').doc(reviewId))
        if (!reviewSnap.exists) {
          throw new functions.https.HttpsError(
            'failed-precondition',
            `Sale ${saleId} has not been reviewed.`,
          )
        }
        const review = reviewSnap.data() ?? {}
        if (review.decision !== 'include' || Number(review.approvedAmountPaise) <= 0) {
          writeIdempotencyInTx(tx, db, {
            key: `${input.idempotencyKey}_${saleId}`,
            actorUid,
            requestHash: saleHash,
            transactionId: saleId,
          })
          return
        }
        const saleSnap = await tx.get(db.collection('transactions').doc(saleId))
        const sale = saleSnap.data() ?? {}
        await createMoneyObligationForSaleInTx(tx, db, {
          saleId,
          customerId: typeof sale.customerId === 'string' ? sale.customerId : null,
          customerKind: sale.customerKind === 'custom' ? 'custom' : 'registered',
          customerName: String(sale.customerSnapshot?.name ?? ''),
          businessDate: String(sale.businessDate ?? ''),
          amountPaise: Number(review.approvedAmountPaise),
          source: 'opening_receivable',
          recordScope: 'opening',
          openingSessionId: input.sessionId,
          openingGenerationId: input.generationId,
          actorUid,
        })
        tx.set(
          db.collection('saleCutoverRecords').doc(saleId),
          { receivableStatus: 'staged', updatedAt: FieldValue.serverTimestamp() },
          { merge: true },
        )
        writeIdempotencyInTx(tx, db, {
          key: `${input.idempotencyKey}_${saleId}`,
          actorUid,
          requestHash: saleHash,
          transactionId: saleId,
        })
      })
    }
    return { ok: true }
  })

export const buildOpeningRollup = functions.region('asia-south1').https.onCall(async (data, context) => {
  const actorUid = requireAdmin(context)
  const parsed = buildOpeningRollupSchema.safeParse(data)
  if (!parsed.success) {
    throw new functions.https.HttpsError('invalid-argument', firstZodMessage(parsed.error))
  }
  const input = parsed.data
  const db = getFirestore()
  const sheetId = `${input.sessionId}_${input.generationId}`
  const sheetSnap = await db.collection('openingBalanceSheets').doc(sheetId).get()
  if (!sheetSnap.exists) {
    throw new functions.https.HttpsError('failed-precondition', 'Opening balance sheet is missing.')
  }
  const sheet = sheetSnap.data() ?? {}
  const amounts = (sheet.amountsPaise ?? {}) as Record<string, number>

  const planSnap = await planRef(input.sessionId, input.generationId).get()
  if (!planSnap.exists) throw new functions.https.HttpsError('failed-precondition', 'Plan missing.')
  const plan = planSnap.data() ?? {}
  const chunkIds = Array.isArray(plan.chunkIds) ? (plan.chunkIds as string[]) : []

  const bridgeNet: Record<string, number> = {}
  for (const chunkId of chunkIds) {
    const completion = await db.collection('openingChunkCompletions').doc(chunkId).get()
    if (!completion.exists) {
      throw new functions.https.HttpsError('failed-precondition', `Chunk ${chunkId} is incomplete.`)
    }
    const nets = (completion.data()?.perAccountBridgeNetPaise ?? {}) as Record<string, number>
    for (const [accountId, value] of Object.entries(nets)) {
      bridgeNet[accountId] = (bridgeNet[accountId] ?? 0) + Number(value)
    }
  }

  const published: Record<string, number> = {}
  for (const accountId of Object.keys(amounts)) {
    published[accountId] = publishedBalancePaise(Number(amounts[accountId] ?? 0), bridgeNet[accountId] ?? 0)
  }
  for (const accountId of Object.keys(bridgeNet)) {
    if (!(accountId in published)) {
      published[accountId] = publishedBalancePaise(0, bridgeNet[accountId] ?? 0)
    }
  }

  const hash = requestHash(input)
  await db.runTransaction(async (tx) => {
    const replay = await assertIdempotentOrReplay(tx, db, input.idempotencyKey, hash)
    if (replay.replay) return
    const gateSnap = await tx.get(gateRef())
    await loadOpeningWorkerGuardsInTx(tx, {
      sessionId: input.sessionId,
      generationId: input.generationId,
      fence: input.fence,
      mutationEpoch: Number(gateSnap.data()?.mutationEpoch ?? 0),
      expectedStates: ['preparing'],
    })
    tx.set(db.collection('openingRollups').doc(sheetId), {
      sessionId: input.sessionId,
      openingGenerationId: input.generationId,
      verifiedOpeningPaise: amounts,
      bridgeCollectionNetPaise: bridgeNet,
      publishedBalancePaise: published,
      ownerLoanOutstandingPaise: Number(sheet.ownerLoanOutstandingPaise ?? 0),
      builtBy: actorUid,
      builtAt: FieldValue.serverTimestamp(),
    })
    writeIdempotencyInTx(tx, db, {
      key: input.idempotencyKey,
      actorUid,
      requestHash: hash,
      transactionId: sheetId,
    })
  })
  return { ok: true, publishedBalancePaise: published }
})

export const markOpeningReady = functions.region('asia-south1').https.onCall(async (data, context) => {
  const actorUid = requireAdmin(context)
  const parsed = markOpeningReadySchema.safeParse(data)
  if (!parsed.success) {
    throw new functions.https.HttpsError('invalid-argument', firstZodMessage(parsed.error))
  }
  const input = parsed.data
  const db = getFirestore()
  const planSnap = await planRef(input.sessionId, input.generationId).get()
  if (!planSnap.exists) throw new functions.https.HttpsError('failed-precondition', 'Plan missing.')
  const plan = planSnap.data() ?? {}
  const chunkIds = Array.isArray(plan.chunkIds) ? (plan.chunkIds as string[]) : []
  for (const chunkId of chunkIds) {
    const completion = await db.collection('openingChunkCompletions').doc(chunkId).get()
    if (!completion.exists) {
      throw new functions.https.HttpsError('failed-precondition', `Incomplete chunk: ${chunkId}`)
    }
  }
  const rollupSnap = await db
    .collection('openingRollups')
    .doc(`${input.sessionId}_${input.generationId}`)
    .get()
  if (!rollupSnap.exists) {
    throw new functions.https.HttpsError('failed-precondition', 'Rollup missing.')
  }

  // Every pre-cutover sale must have a review.
  const expectedPre = Number(plan.expectedPreCount ?? 0)
  const reviews = await db
    .collection('openingReceivableReviews')
    .where('openingSessionId', '==', input.sessionId)
    .where('openingGenerationId', '==', input.generationId)
    .get()
  if (reviews.size < expectedPre) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      `Receivable reviews incomplete: ${reviews.size}/${expectedPre}.`,
    )
  }

  const hash = requestHash(input)
  await db.runTransaction(async (tx) => {
    const replay = await assertIdempotentOrReplay(tx, db, input.idempotencyKey, hash)
    if (replay.replay) return
    const sessionSnap = await tx.get(sessionRef(input.sessionId))
    if (!sessionSnap.exists) throw new functions.https.HttpsError('not-found', 'Session not found.')
    const existing = sessionSnap.data() ?? {}
    // Idempotent when already marked ready for this generation (publish retry safety).
    if (
      existing.state === 'ready_to_publish' &&
      existing.generationId === input.generationId &&
      Number(existing.fence) === input.fence
    ) {
      writeIdempotencyInTx(tx, db, {
        key: input.idempotencyKey,
        actorUid,
        requestHash: hash,
        transactionId: input.sessionId,
      })
      return
    }
    const gateSnap = await tx.get(gateRef())
    if (Number(gateSnap.data()?.mutationEpoch) !== Number(plan.mutationEpoch)) {
      throw new functions.https.HttpsError('failed-precondition', 'Mutation epoch changed.')
    }
    await loadOpeningWorkerGuardsInTx(tx, {
      sessionId: input.sessionId,
      generationId: input.generationId,
      fence: input.fence,
      mutationEpoch: Number(gateSnap.data()?.mutationEpoch ?? 0),
      expectedStates: ['preparing'],
    })
    tx.update(sessionRef(input.sessionId), {
      state: 'ready_to_publish',
      updatedAt: FieldValue.serverTimestamp(),
      readyBy: actorUid,
    })
    writeIdempotencyInTx(tx, db, {
      key: input.idempotencyKey,
      actorUid,
      requestHash: hash,
      transactionId: input.sessionId,
    })
  })
  return { ok: true }
})

export const publishFinancialOpening = functions.region('asia-south1').https.onCall(async (data, context) => {
  const actorUid = requireAdmin(context)
  const parsed = publishFinancialOpeningSchema.safeParse(data)
  if (!parsed.success) {
    throw new functions.https.HttpsError('invalid-argument', firstZodMessage(parsed.error))
  }
  const input = parsed.data
  const db = getFirestore()
  const rollupId = `${input.sessionId}_${input.generationId}`
  const rollupSnap = await db.collection('openingRollups').doc(rollupId).get()
  if (!rollupSnap.exists) {
    throw new functions.https.HttpsError('failed-precondition', 'Rollup missing.')
  }
  const rollup = rollupSnap.data() ?? {}
  const publishedBalances = (rollup.publishedBalancePaise ?? {}) as Record<string, number>
  const accountIds = Object.keys(publishedBalances)
  if (accountIds.length > OPENING_MAX_DESTINATIONS) {
    throw new functions.https.HttpsError('failed-precondition', 'Too many destinations.')
  }

  const hash = requestHash(input)
  await db.runTransaction(async (tx) => {
    const replay = await assertIdempotentOrReplay(tx, db, input.idempotencyKey, hash)
    if (replay.replay) return

    // All reads first (Firestore transaction rule).
    const gateSnap = await tx.get(gateRef())
    const pubSnap = await tx.get(publicationRef())
    const pub = pubSnap.data() ?? {}
    if (
      typeof pub.publishedSessionId === 'string' &&
      pub.publishedSessionId === input.sessionId &&
      pub.publishedGenerationId === input.generationId
    ) {
      return
    }
    if (typeof pub.publishedSessionId === 'string') {
      throw new functions.https.HttpsError('failed-precondition', 'Another opening is already published.')
    }

    const { session } = await loadOpeningWorkerGuardsInTx(tx, {
      sessionId: input.sessionId,
      generationId: input.generationId,
      fence: input.fence,
      mutationEpoch: Number(gateSnap.data()?.mutationEpoch ?? 0),
      expectedStates: ['ready_to_publish'],
    })

    const balanceSnaps: Array<{ accountId: string; exists: boolean }> = []
    for (const accountId of accountIds) {
      const existing = await tx.get(db.collection('financialBalances').doc(accountId))
      balanceSnaps.push({ accountId, exists: existing.exists })
    }
    for (const row of balanceSnaps) {
      if (row.exists) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Balance already exists for ${row.accountId}.`,
        )
      }
    }

    const openingDate = String(session.openingDate ?? '')

    // Writes only after all reads.
    for (const accountId of accountIds) {
      tx.set(db.collection('financialBalances').doc(accountId), {
        accountId,
        balancePaise: Number(publishedBalances[accountId] ?? 0),
        publishedSessionId: input.sessionId,
        publishedGenerationId: input.generationId,
        needsReconciliation: false,
        reconciliationReason: null,
        updatedByTransactionId: `opening_${input.sessionId}`,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    }

    tx.set(publicationRef(), {
      publishedSessionId: input.sessionId,
      publishedGenerationId: input.generationId,
      publishedAt: FieldValue.serverTimestamp(),
    })
    tx.set(
      gateRef(),
      {
        state: 'published',
        activeSessionId: input.sessionId,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid,
      },
      { merge: true },
    )
    tx.update(sessionRef(input.sessionId), {
      state: 'published',
      publishedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    tx.set(
      db.collection('settings').doc('agency'),
      {
        financialOpeningDate: openingDate,
        ownerLoanOutstandingPaise: Number(rollup.ownerLoanOutstandingPaise ?? 0),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid,
      },
      { merge: true },
    )

    writeIdempotencyInTx(tx, db, {
      key: input.idempotencyKey,
      actorUid,
      requestHash: hash,
      transactionId: input.sessionId,
    })
    tx.set(db.collection('auditLogs').doc(), {
      action: 'finance.opening.publish',
      actorUid,
      sessionId: input.sessionId,
      generationId: input.generationId,
      createdAt: FieldValue.serverTimestamp(),
    })
  })

  return { ok: true, publishedSessionId: input.sessionId, publishedGenerationId: input.generationId }
})

export const abandonFinancialOpeningSeal = functions
  .region('asia-south1')
  .https.onCall(async (data, context) => {
    const actorUid = requireAdmin(context)
    const parsed = abandonFinancialOpeningSealSchema.safeParse(data)
    if (!parsed.success) {
      throw new functions.https.HttpsError('invalid-argument', firstZodMessage(parsed.error))
    }
    const input = parsed.data
    const db = getFirestore()
    const hash = requestHash(input)
    await db.runTransaction(async (tx) => {
      const replay = await assertIdempotentOrReplay(tx, db, input.idempotencyKey, hash)
      if (replay.replay) return
      const pubSnap = await tx.get(publicationRef())
      if (typeof pubSnap.data()?.publishedSessionId === 'string') {
        throw new functions.https.HttpsError('failed-precondition', 'Cannot abandon after publication.')
      }
      const sessionSnap = await tx.get(sessionRef(input.sessionId))
      if (!sessionSnap.exists) throw new functions.https.HttpsError('not-found', 'Session not found.')
      const session = sessionSnap.data() ?? {}
      if (Number(session.fence) !== input.fence) {
        throw new functions.https.HttpsError('failed-precondition', 'Stale fence.')
      }
      if (session.state !== 'preparing' && session.state !== 'ready_to_publish') {
        throw new functions.https.HttpsError('failed-precondition', 'Session cannot be abandoned.')
      }
      tx.update(sessionRef(input.sessionId), {
        state: 'abandoned',
        fence: Number(session.fence) + 1,
        abandonReason: input.reason,
        abandonedBy: actorUid,
        abandonedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      tx.set(
        gateRef(),
        {
          state: 'not_opened',
          activeSessionId: null,
          mutationEpoch: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actorUid,
        },
        { merge: true },
      )
      writeIdempotencyInTx(tx, db, {
        key: input.idempotencyKey,
        actorUid,
        requestHash: hash,
        transactionId: input.sessionId,
      })
    })
    return { ok: true }
  })

export const listOpeningReviews = functions.region('asia-south1').https.onCall(async (data, context) => {
  requireAdmin(context)
  const parsed = listOpeningReviewsSchema.safeParse(data)
  if (!parsed.success) {
    throw new functions.https.HttpsError('invalid-argument', firstZodMessage(parsed.error))
  }
  const input = parsed.data
  const db = getFirestore()
  const planSnap = await planRef(input.sessionId, input.generationId).get()
  if (!planSnap.exists) throw new functions.https.HttpsError('not-found', 'Plan not found.')

  const reviewsSnap = await db
    .collection('openingReceivableReviews')
    .where('openingSessionId', '==', input.sessionId)
    .where('openingGenerationId', '==', input.generationId)
    .limit(input.limit ?? 100)
    .get()

  return {
    reviews: reviewsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
  }
})

export const getFinancialOpeningStatus = functions.region('asia-south1').https.onCall(async (_data, context) => {
  requireAdmin(context)
  const db = getFirestore()
  const [gate, publication, agencySnap] = await Promise.all([
    getGateState(),
    db.doc(PUBLICATION_DOC).get(),
    db.collection('settings').doc('agency').get(),
  ])
  const agency = parseAgencySettings(agencySnap.data() as Record<string, unknown> | undefined)
  const ownership = resolveDestinationOwnership(agency.receivingAccounts)

  let activeSession: Record<string, unknown> | null = null
  let balanceSheet: Record<string, unknown> | null = null
  let plan: Record<string, unknown> | null = null
  let hasRollup = false
  let reviewCount = 0

  if (gate.state === 'sealing' && gate.activeSessionId) {
    const sessionSnap = await sessionRef(gate.activeSessionId).get()
    if (sessionSnap.exists) {
      const session = sessionSnap.data() ?? {}
      const generationId = typeof session.generationId === 'string' ? session.generationId : ''
      activeSession = {
        id: sessionSnap.id,
        state: session.state ?? null,
        fence: Number(session.fence ?? 0),
        generationId: generationId || null,
        openingDate: session.openingDate ?? null,
        anchorTransactionId: session.anchorTransactionId ?? null,
        anchorBusinessDate: session.anchorBusinessDate ?? null,
        anchorDateMismatchReason: session.anchorDateMismatchReason ?? null,
      }
      if (generationId) {
        const sheetId = `${sessionSnap.id}_${generationId}`
        const [sheetSnap, planSnap, rollupSnap, reviewsSnap] = await Promise.all([
          db.collection('openingBalanceSheets').doc(sheetId).get(),
          planRef(sessionSnap.id, generationId).get(),
          db.collection('openingRollups').doc(sheetId).get(),
          db
            .collection('openingReceivableReviews')
            .where('openingSessionId', '==', sessionSnap.id)
            .where('openingGenerationId', '==', generationId)
            .limit(200)
            .get(),
        ])
        if (sheetSnap.exists) {
          balanceSheet = {
            amountsPaise: sheetSnap.data()?.amountsPaise ?? {},
            ownerLoanOutstandingPaise: Number(sheetSnap.data()?.ownerLoanOutstandingPaise ?? 0),
            ownerLoanVerified: sheetSnap.data()?.ownerLoanVerified === true,
          }
        }
        if (planSnap.exists) {
          const planData = planSnap.data() ?? {}
          plan = {
            expectedPreCount: Number(planData.expectedPreCount ?? 0),
            expectedBridgeCount: Number(planData.expectedBridgeCount ?? 0),
            expectedFutureCount: Number(planData.expectedFutureCount ?? 0),
            expectedChunkCount: Number(planData.expectedChunkCount ?? 0),
            chunkIds: Array.isArray(planData.chunkIds) ? planData.chunkIds : [],
            mutationEpoch: Number(planData.mutationEpoch ?? 0),
          }
        }
        hasRollup = rollupSnap.exists
        reviewCount = reviewsSnap.size
      }
    }
  }

  return {
    gate,
    publication: publication.exists
      ? publication.data()
      : { publishedSessionId: null, publishedGenerationId: null, publishedAt: null },
    ownership,
    financialOpeningDate: agency.financialOpeningDate,
    ownerLoanOutstandingPaise: agency.ownerLoanOutstandingPaise,
    activeSession,
    balanceSheet,
    plan,
    hasRollup,
    reviewCount,
  }
})

// silence unused GATE_DOC import warning in some TS configs
void GATE_DOC
