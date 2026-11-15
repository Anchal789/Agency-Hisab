import { describe, expect, it, vi } from 'vitest'
import { setCutoverDateIfUnsetInTx } from '../../functions/src/inventory/apply-inventory'

describe('setCutoverDateIfUnsetInTx', () => {
  it('is write-only and skips when cutover is already set', () => {
    const set = vi.fn()
    const tx = { set } as unknown as Parameters<typeof setCutoverDateIfUnsetInTx>[0]
    const ref = { path: 'settings/agency' } as Parameters<typeof setCutoverDateIfUnsetInTx>[1]

    setCutoverDateIfUnsetInTx(tx, ref, '2026-11-01', '2026-11-14', 'admin-1')
    expect(set).not.toHaveBeenCalled()

    setCutoverDateIfUnsetInTx(tx, ref, null, '2026-11-14', 'admin-1')
    expect(set).toHaveBeenCalledTimes(1)
    expect(set.mock.calls[0]?.[0]).toBe(ref)
    expect(set.mock.calls[0]?.[2]).toEqual({ merge: true })
    expect(set.mock.calls[0]?.[1]).toMatchObject({
      inventoryCutoverDate: '2026-11-14',
      updatedBy: 'admin-1',
    })
  })

  it('does not perform reads (regression: read-after-write INTERNAL on createStockOpening)', () => {
    const set = vi.fn()
    const get = vi.fn()
    const tx = { set, get } as unknown as Parameters<typeof setCutoverDateIfUnsetInTx>[0]
    const ref = { path: 'settings/agency' } as Parameters<typeof setCutoverDateIfUnsetInTx>[1]

    setCutoverDateIfUnsetInTx(tx, ref, undefined, '2026-11-14', 'admin-1')
    expect(get).not.toHaveBeenCalled()
    expect(set).toHaveBeenCalledTimes(1)
  })
})
