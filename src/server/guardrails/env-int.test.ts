import { afterEach, describe, expect, it, vi } from 'vitest'
import { envInt } from './env-int'

describe('envInt', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('未设置 → 回退默认', () => {
    expect(envInt('EVOLOOP_TEST_INT_UNSET', 99)).toBe(99)
  })

  it('空串/空白/非整数/非正数一律回退默认（Vercel 空串注入防线）', () => {
    for (const v of ['', '   ', 'abc', '0', '-5', '1.5', 'NaN']) {
      vi.stubEnv('EVOLOOP_TEST_INT', v)
      expect(envInt('EVOLOOP_TEST_INT', 42)).toBe(42)
    }
  })

  it('合法正整数生效（含首尾空白容忍）', () => {
    vi.stubEnv('EVOLOOP_TEST_INT', '20')
    expect(envInt('EVOLOOP_TEST_INT', 42)).toBe(20)
    vi.stubEnv('EVOLOOP_TEST_INT', ' 500 ')
    expect(envInt('EVOLOOP_TEST_INT', 42)).toBe(500)
  })
})
