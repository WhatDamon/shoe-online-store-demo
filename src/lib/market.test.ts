import { describe, expect, it, vi, afterEach } from 'vitest'
import { market } from './market'

describe('market', () => {
  afterEach(() => vi.unstubAllEnvs())
  it('defaults to US size system', () => {
    vi.stubEnv('SITE_MARKET', '')
    expect(market.sizeSystem).toBe('US')
  })
  it('maps EU market config to EU system', () => {
    vi.stubEnv('SITE_MARKET', 'EU')
    expect(market.sizeSystem).toBe('EU')
  })
})
