import { afterEach, describe, expect, it, vi } from 'vitest'
import { aiRequestTimeoutMs } from '@/config'
import { dailyTokenCap } from './budget'
import { maxTurns } from './session-state'
import { maxMessageChars, maxOutputTokens } from './text'

afterEach(() => vi.unstubAllEnvs())

describe('AI resource configuration limits', () => {
  it('caps message, output, turn and daily budget settings', () => {
    vi.stubEnv('AI_MAX_MESSAGE_CHARS', '999999')
    vi.stubEnv('AI_MAX_OUTPUT_TOKENS', '999999')
    vi.stubEnv('AI_MAX_TURNS', '999999')
    vi.stubEnv('AI_DAILY_TOKEN_CAP', '999999999')
    vi.stubEnv('AI_REQUEST_TIMEOUT_MS', '999999999')

    expect(maxMessageChars()).toBe(4_000)
    expect(maxOutputTokens()).toBe(2_000)
    expect(maxTurns()).toBe(100)
    expect(dailyTokenCap()).toBe(10_000_000)
    expect(aiRequestTimeoutMs()).toBe(120_000)
  })

  it('keeps normal values and fallback defaults unchanged', () => {
    expect(maxMessageChars()).toBe(800)
    expect(maxOutputTokens()).toBe(500)
    expect(maxTurns()).toBe(20)
    expect(dailyTokenCap()).toBe(1_000_000)
    expect(aiRequestTimeoutMs()).toBe(20_000)
  })
})
