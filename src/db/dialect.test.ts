import { describe, expect, it } from 'vitest'
import { resolveDbDriver } from './dialect'

describe('resolveDbDriver (spec decision #13)', () => {
  it('defaults to sqlite when DB_DRIVER is unset', () => {
    expect(resolveDbDriver({})).toBe('sqlite')
  })
  it('treats empty/whitespace DB_DRIVER as unset (Vercel injects DB_DRIVER="")', () => {
    expect(resolveDbDriver({ DB_DRIVER: '' })).toBe('sqlite')
    expect(resolveDbDriver({ DB_DRIVER: '   ' })).toBe('sqlite')
  })
  it('honors DB_DRIVER=postgres', () => {
    expect(resolveDbDriver({ DB_DRIVER: 'postgres' })).toBe('postgres')
  })
  it('trims and lowercases the value', () => {
    expect(resolveDbDriver({ DB_DRIVER: ' Postgres ' })).toBe('postgres')
    expect(resolveDbDriver({ DB_DRIVER: 'SQLITE' })).toBe('sqlite')
  })
  it('throws at boot on unknown drivers', () => {
    expect(() => resolveDbDriver({ DB_DRIVER: 'mysql' })).toThrow(/Unknown DB_DRIVER 'mysql'/)
  })
})
