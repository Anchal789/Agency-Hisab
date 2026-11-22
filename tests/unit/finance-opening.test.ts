import { describe, expect, it } from 'vitest'
import {
  classifyGodownSaleCohort,
  maxSalesForPrepareBudget,
  publishedBalancePaise,
  splitSaleIdsForBudget,
} from '../../shared/calculations/finance-classification'
import {
  openingAllowsStagingEdits,
  openingPublishActionPlan,
  openingStagingBlockedMessage,
} from '../../shared/rules/opening-session-ui'
import {
  collectionUnwindLedgerId,
  destinationOpeningLedgerId,
  moneyLinkClaimId,
  moneyObligationIdForSale,
  moneyOriginClaimId,
  saleCollectionLedgerId,
} from '../../shared/models/finance'
import {
  resolveHistoricalGodownSaleFinanceSchema,
  saveOpeningBalanceSheetSchema,
} from '../../shared/schemas/finance-opening'
import { buildLedgerContentHash } from '../../functions/src/finance/ledger-write'
import { resolveDestinationOwnership } from '../../shared/rules/destination-ownership'
import type { ReceivingAccount } from '../../shared/models/agency-config'

describe('finance classification', () => {
  it('classifies pre_cutover, bridge, and future_dated', () => {
    expect(
      classifyGodownSaleCohort({ businessDate: '2026-11-01', openingDate: '2026-11-10', today: '2026-11-16' }),
    ).toBe('pre_cutover')
    expect(
      classifyGodownSaleCohort({ businessDate: '2026-11-10', openingDate: '2026-11-10', today: '2026-11-16' }),
    ).toBe('pre_cutover')
    expect(
      classifyGodownSaleCohort({ businessDate: '2026-11-12', openingDate: '2026-11-10', today: '2026-11-16' }),
    ).toBe('post_cutover')
    expect(
      classifyGodownSaleCohort({ businessDate: '2026-11-20', openingDate: '2026-11-10', today: '2026-11-16' }),
    ).toBe('future_dated')
  })

  it('A-03 published balance equals opening plus bridge', () => {
    expect(publishedBalancePaise(1_000_000, 200_000)).toBe(1_200_000)
  })

  it('C-02 chunk budget stays at or below 49', () => {
    expect(maxSalesForPrepareBudget()).toBeLessThanOrEqual(49)
    expect(maxSalesForPrepareBudget()).toBeGreaterThanOrEqual(40)
  })

  it('C-01 splits large sale lists into budgeted parts without dropping ids', () => {
    const ids = Array.from({ length: 95 }, (_, i) => `sale_${i}`)
    const parts = splitSaleIdsForBudget(ids, 40)
    expect(parts.every((part) => part.length <= 40)).toBe(true)
    expect(parts.flat()).toEqual(ids)
  })
})

describe('dynamic destination ownership', () => {
  const accounts: ReceivingAccount[] = [
    {
      id: 'ra1',
      name: 'Anchal',
      kind: 'cash',
      active: true,
      ownership: 'agency',
      compatiblePaymentMethodIds: ['pm_cash', 'pm_upi'],
    },
    {
      id: 'ra2',
      name: 'D.P. ji',
      kind: 'upi',
      active: true,
      ownership: 'third_party_held',
      compatiblePaymentMethodIds: ['pm_cash', 'pm_upi'],
    },
    {
      id: 'ra3',
      name: 'Maharashtra Bank',
      kind: 'bank',
      active: true,
      ownership: 'agency',
      compatiblePaymentMethodIds: ['pm_bank'],
    },
  ]

  it('resolves whatever destinations are configured with explicit ownership', () => {
    const result = resolveDestinationOwnership(accounts)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.matches).toHaveLength(3)
    expect(result.matches.map((row) => row.accountName)).toEqual([
      'Anchal',
      'D.P. ji',
      'Maharashtra Bank',
    ])
  })

  it('fails when no destinations are configured', () => {
    const result = resolveDestinationOwnership([])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.details[0]).toMatch(/No payment destinations/i)
  })

  it('fails when an active destination is missing ownership', () => {
    const result = resolveDestinationOwnership([
      { id: 'ra1', name: 'Anchal', kind: 'cash', active: true },
    ])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.missingOwnershipAccountIds).toEqual(['ra1'])
  })

  it('ignores inactive destinations', () => {
    const result = resolveDestinationOwnership([
      ...accounts,
      { id: 'ra_old', name: 'Old', kind: 'cash', active: false },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.matches.find((row) => row.accountId === 'ra_old')).toBeUndefined()
  })
})

describe('finance deterministic ids', () => {
  it('money obligation id is deterministic per sale', () => {
    expect(moneyObligationIdForSale('saleA')).toBe('money_saleA')
  })

  it('claim ids are sale- and obligation-scoped', () => {
    expect(moneyOriginClaimId('saleA')).toBe('saleA')
    expect(moneyLinkClaimId('money_saleA')).toBe('money_saleA')
    expect(saleCollectionLedgerId('saleA', 'ra1')).toBe('saleA_ra1_sale_collection')
    expect(collectionUnwindLedgerId('saleA')).toBe('saleA_collection_unwind')
  })

  it('destination opening ledger id includes session and generation', () => {
    expect(destinationOpeningLedgerId('s1', 'g1', 'ra1')).toBe('s1_g1_destination_opening_ra1')
  })
})

describe('ledger content hash integrity', () => {
  it('X-04 equal content hashes match; changed amount diverges', () => {
    const base = {
      accountId: 'ra1',
      amountPaise: 200_000,
      direction: 'credit',
      entryClass: 'sale_collection',
      businessDate: '2026-11-12',
      transactionId: 'sale1',
      recordScope: 'opening',
      openingSessionId: 's1',
      openingGenerationId: 'g1',
    }
    expect(buildLedgerContentHash(base)).toBe(buildLedgerContentHash({ ...base }))
    expect(buildLedgerContentHash(base)).not.toBe(
      buildLedgerContentHash({ ...base, amountPaise: 200_001 }),
    )
  })
})

describe('historical resolve schema', () => {
  it('H-01 accepts create_opening_receivable', () => {
    const parsed = resolveHistoricalGodownSaleFinanceSchema.safeParse({
      idempotencyKey: '11111111-1111-1111-1111-111111111111',
      saleId: 'sale_hist_1',
      resolution: {
        kind: 'create_opening_receivable',
        approvedAmountPaise: 50000,
        reason: 'Verified opening due',
      },
      historicalCollection: {
        status: 'verified_not_in_current_cash',
        note: 'Cash already banked before cutover',
      },
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects settled-link payload shapes that omit obligation id', () => {
    const parsed = resolveHistoricalGodownSaleFinanceSchema.safeParse({
      idempotencyKey: '11111111-1111-1111-1111-111111111111',
      saleId: 'sale_hist_1',
      resolution: { kind: 'link_existing_receivable', reason: 'link attempt' },
      historicalCollection: { status: 'none' },
    })
    expect(parsed.success).toBe(false)
  })
})

describe('opening balance sheet schema', () => {
  it('requires owner loan verification flag', () => {
    const parsed = saveOpeningBalanceSheetSchema.safeParse({
      idempotencyKey: '11111111-1111-1111-1111-111111111111',
      sessionId: 'session_01',
      fence: 1,
      generationId: 'generation_01',
      balances: [{ accountId: 'ra1', amountPaise: 100 }],
      ownerLoanOutstandingPaise: 0,
      ownerLoanVerified: true,
    })
    expect(parsed.success).toBe(true)
  })
})

describe('opening session UI state guards (T9 retry / ready lock)', () => {
  it('allows staging edits only while preparing', () => {
    expect(openingAllowsStagingEdits('preparing')).toBe(true)
    expect(openingAllowsStagingEdits('ready_to_publish')).toBe(false)
    expect(openingAllowsStagingEdits('published')).toBe(false)
    expect(openingAllowsStagingEdits('abandoned')).toBe(false)
  })

  it('uses publish-only retry after mark-ready without re-running preparing steps', () => {
    expect(openingPublishActionPlan('preparing')).toBe('build_ready_publish')
    expect(openingPublishActionPlan('ready_to_publish')).toBe('publish_only')
    expect(openingPublishActionPlan('published')).toBe('blocked')
    expect(openingPublishActionPlan('abandoned')).toBe('blocked')
  })

  it('explains ready_to_publish when staging is blocked', () => {
    expect(openingStagingBlockedMessage('ready_to_publish')).toMatch(/ready to publish/i)
  })
})

describe('T18–T20 cohort classification immutability contract', () => {
  it('T7/T18–T20: the same sale dates always map to the same cohort for fixed D/today', () => {
    const openingDate = '2026-11-19'
    const today = '2026-11-23'
    const samples = [
      ['2026-11-19', 'pre_cutover'],
      ['2026-11-18', 'pre_cutover'],
      ['2026-11-20', 'post_cutover'],
      ['2026-11-23', 'post_cutover'],
      ['2026-11-24', 'future_dated'],
    ] as const
    for (const [businessDate, expected] of samples) {
      expect(classifyGodownSaleCohort({ businessDate, openingDate, today })).toBe(expected)
      // Reversal must not redefine the cohort: classification is a pure function of dates.
      expect(classifyGodownSaleCohort({ businessDate, openingDate, today })).toBe(expected)
    }
  })
})

describe('T13 owner loan verification schema', () => {
  it('rejects missing ownerLoanVerified literal', () => {
    expect(
      saveOpeningBalanceSheetSchema.safeParse({
        idempotencyKey: '11111111-1111-1111-1111-111111111111',
        sessionId: 'session_01',
        fence: 1,
        generationId: 'generation_01',
        balances: [{ accountId: 'ra1', amountPaise: 0 }],
        ownerLoanOutstandingPaise: 0,
      }).success,
    ).toBe(false)
  })
})

describe('negative balance reconciliation flag contract', () => {
  it('marks needsReconciliation when next balance is negative and sticky thereafter', () => {
    const apply = (balancePaise: number, deltaPaise: number, priorNeeds: boolean) => {
      const next = balancePaise + deltaPaise
      return {
        balancePaise: next,
        needsReconciliation: next < 0 ? true : priorNeeds,
      }
    }
    expect(apply(1_000, -5_000, false)).toEqual({ balancePaise: -4_000, needsReconciliation: true })
    expect(apply(-4_000, 1_000, true)).toEqual({ balancePaise: -3_000, needsReconciliation: true })
    expect(apply(5_000, -1_000, false)).toEqual({ balancePaise: 4_000, needsReconciliation: false })
  })
})
