import { afterEach, describe, expect, it, vi } from 'vitest'
import { envFlag, envInt, envStr } from '@/config'

afterEach(() => vi.unstubAllEnvs())

describe('envStr', () => {
  it('未设置 → fallback（默认空串）', () => {
    expect(envStr('EVOLOOP_TEST_STR_UNSET', 'd')).toBe('d')
    expect(envStr('EVOLOOP_TEST_STR_UNSET')).toBe('')
  })

  it('空串/纯空白视为未设置（Vercel 空串注入防线）', () => {
    for (const v of ['', '   ', '\t', ' \n ']) {
      vi.stubEnv('EVOLOOP_TEST_STR', v)
      expect(envStr('EVOLOOP_TEST_STR', 'd')).toBe('d')
    }
  })

  it('命中时返回已 trim 的值', () => {
    vi.stubEnv('EVOLOOP_TEST_STR', '  value  ')
    expect(envStr('EVOLOOP_TEST_STR')).toBe('value')
  })

  it('调用时求值：stub 变更立即生效，无需重置模块', () => {
    vi.stubEnv('EVOLOOP_TEST_STR', 'a')
    expect(envStr('EVOLOOP_TEST_STR')).toBe('a')
    vi.stubEnv('EVOLOOP_TEST_STR', 'b')
    expect(envStr('EVOLOOP_TEST_STR')).toBe('b')
  })
})

describe('envInt', () => {
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

describe('envFlag', () => {
  it('未设置/空串 → fallback', () => {
    expect(envFlag('EVOLOOP_TEST_FLAG_UNSET')).toBe(false)
    expect(envFlag('EVOLOOP_TEST_FLAG_UNSET', true)).toBe(true)
    vi.stubEnv('EVOLOOP_TEST_FLAG', '')
    expect(envFlag('EVOLOOP_TEST_FLAG', true)).toBe(true)
  })

  it("'1' 与 'true'（忽略大小写与首尾空白）为真", () => {
    for (const v of ['1', 'true', 'TRUE', ' True ']) {
      vi.stubEnv('EVOLOOP_TEST_FLAG', v)
      expect(envFlag('EVOLOOP_TEST_FLAG')).toBe(true)
    }
  })

  it('其它值按假处理（是「显式关闭」而非「未设置」，故不取 fallback=true）', () => {
    for (const v of ['0', 'false', 'no']) {
      vi.stubEnv('EVOLOOP_TEST_FLAG', v)
      expect(envFlag('EVOLOOP_TEST_FLAG', true)).toBe(false)
    }
  })
})
