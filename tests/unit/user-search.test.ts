import { describe, expect, it } from 'vitest'
import { filterUsers, userMatchesSearch } from '../../shared/users/search'

const users = [
  { displayName: 'Ramesh Kumar', phoneE164: '+919876543210', status: 'active' as const },
  { displayName: 'Sita Devi', phoneE164: '+919811122233', status: 'disabled' as const },
  { displayName: 'Admin User', phoneE164: '+919800000001', status: 'active' as const },
]

describe('user search', () => {
  it('matches full and partial names case-insensitively', () => {
    expect(userMatchesSearch(users[0], 'ramesh')).toBe(true)
    expect(userMatchesSearch(users[0], 'KUMAR')).toBe(true)
    expect(userMatchesSearch(users[0], 'xyz')).toBe(false)
  })

  it('matches full and partial phone numbers across formats', () => {
    expect(userMatchesSearch(users[0], '9876543210')).toBe(true)
    expect(userMatchesSearch(users[0], '+91 98765-43210')).toBe(true)
    expect(userMatchesSearch(users[0], '98765')).toBe(true)
    expect(userMatchesSearch(users[0], '98111')).toBe(false)
  })

  it('combines search with status filtering', () => {
    expect(filterUsers(users, { search: 'sita', status: 'all' })).toHaveLength(1)
    expect(filterUsers(users, { search: 'sita', status: 'active' })).toHaveLength(0)
    expect(filterUsers(users, { search: '98', status: 'disabled' }).map((row) => row.displayName)).toEqual(['Sita Devi'])
    expect(filterUsers(users, { search: '', status: 'all' })).toHaveLength(3)
  })
})
