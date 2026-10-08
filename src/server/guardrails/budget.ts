import { aiRequestTimeoutMs, envIntMax } from '@/config'
import type { BudgetRepository } from './budget-contract'

/** 当日 token 上限（调用时读 env，见 config）。 */
export const dailyTokenCap = () => envIntMax('AI_DAILY_TOKEN_CAP', 1_000_000, 10_000_000)
// Allow substantially longer than the provider deadline before conservatively recovering work.
export const reservationStaleMs = () => Math.max(300_000, aiRequestTimeoutMs() * 3 + 60_000)
export async function underDailyBudget(
  repo: Pick<BudgetRepository, 'dayTokenUsage'>,
  day = today(),
): Promise<boolean> {
  return (await repo.dayTokenUsage(day)) < dailyTokenCap()
}
export const today = () => new Date().toISOString().slice(0, 10)
