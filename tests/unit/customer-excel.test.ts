import { describe, expect, it } from 'vitest'
import {
  applyColumnMappingChange,
  classifyImportRows,
  hasRequiredImportMapping,
  mapSheetRows,
  parseFlexibleDate,
  suggestColumnMapping,
} from '../../shared/customers/excel'
import { splitFullName } from '../../shared/models/customer'
import { createCustomerSchema } from '../../shared/schemas/customer'

describe('customer excel import helpers', () => {
  it('suggests separate name columns when present', () => {
    const mapping = suggestColumnMapping(['First Name', 'Surname', 'Consumer No', 'Addr', 'Town', 'Last Refill'])
    expect(mapping.fullName).toBeUndefined()
    expect(mapping.firstName).toBe('First Name')
    expect(mapping.lastName).toBe('Surname')
    expect(mapping.consumerNumber).toBe('Consumer No')
    expect(mapping.address).toBe('Addr')
    expect(mapping.city).toBe('Town')
    expect(mapping.lastRefillDate).toBe('Last Refill')
  })

  it('suggests Consumer Name as a full-name column and skips first/last', () => {
    const mapping = suggestColumnMapping(['Consumer Name', 'Consumer Number', 'Address', 'City'])
    expect(mapping.fullName).toBe('Consumer Name')
    expect(mapping.firstName).toBeUndefined()
    expect(mapping.lastName).toBeUndefined()
    expect(mapping.consumerNumber).toBe('Consumer Number')
    expect(hasRequiredImportMapping(mapping)).toBe(true)
  })

  it('splits full names without dropping middle words or initials', () => {
    expect(splitFullName('  Ram   Kumar  ')).toEqual({
      firstName: 'Ram',
      lastName: 'Kumar',
      displayName: 'Ram Kumar',
    })
    expect(splitFullName('Sita')).toEqual({ firstName: 'Sita', lastName: '', displayName: 'Sita' })
    expect(splitFullName('A B C')).toEqual({ firstName: 'A', lastName: 'B C', displayName: 'A B C' })
    expect(splitFullName('R. K. Sharma')).toEqual({
      firstName: 'R.',
      lastName: 'K. Sharma',
      displayName: 'R. K. Sharma',
    })
    expect(splitFullName('सीता देवी')).toEqual({
      firstName: 'सीता',
      lastName: 'देवी',
      displayName: 'सीता देवी',
    })
    expect(splitFullName('')).toEqual({ firstName: '', lastName: '', displayName: '' })
  })

  it('maps full-name column rows into firstName, lastName, and displayName', () => {
    const rows = mapSheetRows(
      [
        { 'Consumer Name': '  Asha   Rani  Devi ', 'Consumer Number': '00123', City: 'Miragpur' },
        { 'Consumer Name': 'OnlyOne', 'Consumer Number': '00124', City: '' },
      ],
      {
        fullName: 'Consumer Name',
        consumerNumber: 'Consumer Number',
        city: 'City',
      },
    )
    expect(rows[0]).toMatchObject({
      firstName: 'Asha',
      lastName: 'Rani Devi',
      displayName: 'Asha Rani Devi',
      consumerNumber: '00123',
    })
    expect(rows[1]).toMatchObject({
      firstName: 'OnlyOne',
      lastName: '',
      displayName: 'OnlyOne',
    })
  })

  it('prevents the same column from mapping to full name and split name fields', () => {
    const withFull = applyColumnMappingChange({}, 'fullName', 'Consumer Name')
    expect(withFull).toEqual({ fullName: 'Consumer Name' })
    const switched = applyColumnMappingChange(
      { fullName: 'Consumer Name', consumerNumber: 'No' },
      'firstName',
      'Consumer Name',
    )
    expect(switched.fullName).toBeUndefined()
    expect(switched.firstName).toBe('Consumer Name')
  })

  it('accepts imported single-word names in the write schema', () => {
    const parsed = createCustomerSchema.safeParse({
      firstName: 'Sita',
      lastName: '',
      address: '',
      city: '',
      consumerNumber: '55',
      lastRefillDate: null,
    })
    expect(parsed.success).toBe(true)
  })

  it('parses multiple date formats and preserves leading zeros', () => {
    expect(parseFlexibleDate('2026-03-01')).toEqual({ ok: true, iso: '2026-03-01' })
    expect(parseFlexibleDate('01/03/2026')).toEqual({ ok: true, iso: '2026-03-01' })
    expect(parseFlexibleDate('not-a-date')).toEqual({ ok: false })

    const rows = mapSheetRows(
      [
        {
          'First Name': 'Asha',
          'Last Name': 'Devi',
          Address: 'Ward 1',
          City: 'Miragpur',
          'Consumer Number': '00123',
          'Last Refill Date': '15-01-2026',
        },
      ],
      {
        firstName: 'First Name',
        lastName: 'Last Name',
        address: 'Address',
        city: 'City',
        consumerNumber: 'Consumer Number',
        lastRefillDate: 'Last Refill Date',
      },
    )
    expect(rows[0]?.consumerNumber).toBe('00123')
    expect(rows[0]?.lastRefillDate).toBe('2026-01-15')
    expect(rows[0]?.displayName).toBe('Asha Devi')
  })

  it('classifies empty, missing, duplicate, existing, and invalid date rows', () => {
    const rows = mapSheetRows(
      [
        { First: '', Last: '', Consumer: '', Address: '', City: '', Date: '' },
        { First: 'Ram', Last: 'Kumar', Consumer: '100', Address: 'A', City: 'B', Date: 'bad' },
        { First: 'Sita', Last: 'Devi', Consumer: '100', Address: 'C', City: 'D', Date: '2026-01-01' },
        { First: 'Gita', Last: 'Devi', Consumer: '200', Address: 'E', City: 'F', Date: '2026-01-02' },
        { First: 'Only', Last: 'Name', Consumer: '', Address: '', City: '', Date: '' },
      ],
      {
        firstName: 'First',
        lastName: 'Last',
        address: 'Address',
        city: 'City',
        consumerNumber: 'Consumer',
        lastRefillDate: 'Date',
      },
    )
    const classified = classifyImportRows(rows, new Set(['200']))
    expect(classified[0]?.status).toBe('invalid')
    expect(classified[1]?.status).toBe('invalid')
    expect(classified[2]?.status).toBe('invalid')
    expect(classified[3]?.status).toBe('invalid')
    expect(classified[4]?.status).toBe('invalid')

    const validOnly = classifyImportRows(
      mapSheetRows(
        [{ Name: 'Ok User', Consumer: '300', Address: '', City: '', Date: '' }],
        {
          fullName: 'Name',
          consumerNumber: 'Consumer',
          address: 'Address',
          city: 'City',
          lastRefillDate: 'Date',
        },
      ),
      new Set(),
    )
    expect(validOnly[0]?.status).toBe('valid')
    if (validOnly[0]?.status === 'valid') {
      expect(validOnly[0].row.displayName).toBe('Ok User')
    }
  })
})
