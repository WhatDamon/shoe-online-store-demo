import type { createRepository } from '@/server/search/repository'

export const DAILY_TOKEN_CAP = Number(process.env.AI_DAILY_TOKEN_CAP ?? 1_000_000)
export async function underDailyBudget(repo: ReturnType<typeof createRepository>, day = today()): Promise<boolean> {
  return (await repo.dayTokenUsage(day)) < DAILY_TOKEN_CAP
}
export const today = () => new Date().toISOString().slice(0, 10)
