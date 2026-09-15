/**
 * 环境变量门面。取值一律**调用时**读 process.env、不做模块级快照：既让测试可以
 * vi.stubEnv 后直测而无需重置模块，也让部署重启后的配置变更即时生效。
 *
 * 部署硬化（§8.5）—— 这是本模块存在的理由：
 * Vercel 控制台常注入空串/纯空白值（新增变量未填、复制时带空格）。裸
 * `Number(process.env.AI_DAILY_TOKEN_CAP)` 会把封顶打成 0（`Number('') === 0`），
 * 结果是每次请求都被护栏拒绝、且不留日志；`process.env.DB_DRIVER || 'sqlite'` 同款坑。
 * 因此三个 helper 一律把「缺失 / 空串 / 纯空白」视为未设置并回退默认。
 */

/** 字符串 env：缺失/空串/纯空白 → fallback；命中则返回已 trim 的值。 */
export const envStr = (name: string, fallback = ''): string => {
  const raw = process.env[name]
  if (raw == null) return fallback
  const trimmed = raw.trim()
  return trimmed === '' ? fallback : trimmed
}

/** 正整数 env：缺失/空/空白/非整数/非正数 → fallback（只有合法正整数生效）。 */
export const envInt = (name: string, fallback: number): number => {
  const raw = process.env[name]
  if (raw == null) return fallback
  const n = Number(raw.trim())
  return Number.isInteger(n) && n > 0 ? n : fallback
}

/** 布尔 env：'1' / 'true'（忽略大小写与首尾空白）为真；缺失/空/其它值 → fallback。 */
export const envFlag = (name: string, fallback = false): boolean => {
  const raw = envStr(name)
  if (raw === '') return fallback
  return raw === '1' || raw.toLowerCase() === 'true'
}
