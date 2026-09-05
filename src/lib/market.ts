import type { SizeSystem } from '@/server/catalog/types'

const MARKET_SIZE_SYSTEM = {
  US: 'US',
  EU: 'EU',
  UK: 'UK',
  JP: 'JP',
  CN: 'CN',
} as const

export const market = {
  // 惰性读取：配置级单市场切换（决策 #9），不缓存模块级快照，
  // 使 vi.stubEnv 类测试与运行时配置变更均生效。
  get code(): string {
    return process.env.SITE_MARKET ?? 'US'
  },
  currency: 'USD' as const,
  locale: 'en-US',
  get sizeSystem(): SizeSystem {
    return MARKET_SIZE_SYSTEM[this.code as keyof typeof MARKET_SIZE_SYSTEM] ?? 'US'
  },
}
