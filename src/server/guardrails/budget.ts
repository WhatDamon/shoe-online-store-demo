import { envInt } from '@/config'
import type { BudgetRepository } from './budget-contract'

/** 当日 token 上限（调用时读 env，见 config）。 */
export const dailyTokenCap = () => envInt('AI_DAILY_TOKEN_CAP', 1_000_000)
// Allow substantially longer than the provider deadline before conservatively recovering work.
export const reservationStaleMs = () =>
  Math.max(300_000, envInt('AI_REQUEST_TIMEOUT_MS', 20_000) * 3 + 60_000)
export async function underDailyBudget(
  repo: Pick<BudgetRepository, 'dayTokenUsage'>,
  day = today(),
): Promise<boolean> {
  return (await repo.dayTokenUsage(day)) < dailyTokenCap()
}
export const today = () => new Date().toISOString().slice(0, 10)
