import { envInt } from '@/config'
import type { createRepository } from '@/server/search/repository'

/** 当日 token 上限（调用时读 env，见 config）。 */
export const dailyTokenCap = () => envInt('AI_DAILY_TOKEN_CAP', 1_000_000)
export async function underDailyBudget(
  repo: ReturnType<typeof createRepository>,
  day = today(),
): Promise<boolean> {
  return (await repo.dayTokenUsage(day)) < dailyTokenCap()
}
export const today = () => new Date().toISOString().slice(0, 10)
