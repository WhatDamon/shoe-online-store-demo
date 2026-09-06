// 数字 env 解析（§8.5 部署硬化）：Vercel 控制台常注入空串/空白值（加行未填、复制带空格等），
// 裸 `Number('') === 0` 会把 AI_DAILY_TOKEN_CAP / AI_MAX_TURNS 等封顶打成 0 —— 每次请求都被护栏
// 拒绝（"taking a short break"）且无日志（决策 #8 时无此防线，DB_DRIVER '' / PG_SSL '' 同款坑）。
// 此助手把缺失/空/空白/非整数/非正数一律回退默认，仅合法正整数生效。
// 调用时才读 process.env（而非模块加载），便于测试 vi.stubEnv 后直测，无需重置模块。
export const envInt = (name: string, fallback: number): number => {
  const raw = process.env[name]
  if (raw == null) return fallback
  const n = Number(raw.trim())
  return Number.isInteger(n) && n > 0 ? n : fallback
}
