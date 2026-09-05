// DB_DRIVER 双驱动解析（spec 决策 #13）：默认 sqlite，未知值启动即报错。
// 运行时懒调用（不做模块级 env 快照）——与 lib/market 的 market.code 同款先例。
export type DbDriver = 'sqlite' | 'postgres'

const DRIVERS: readonly DbDriver[] = ['sqlite', 'postgres']

export function resolveDbDriver(env: Record<string, string | undefined> = process.env): DbDriver {
  // 空串/纯空白视为未设置（Vercel 常注入 DB_DRIVER=''），回落 sqlite；仅显式未知值才报错。
  const raw = (env.DB_DRIVER ?? '').trim().toLowerCase() || 'sqlite'
  const found = DRIVERS.find((d) => d === raw)
  if (!found) throw new Error(`Unknown DB_DRIVER '${raw}' (expected: sqlite | postgres)`)
  return found
}
