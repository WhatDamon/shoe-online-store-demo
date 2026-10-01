export interface BudgetUsage {
  day: string
  model: string
  promptTokens: number
  completionTokens: number
  sessionKey: string
}

export interface BudgetReservationInput {
  requestId: string
  day: string
  tokens: number
  cap: number
}

export interface BudgetSettlementInput {
  requestId: string
  usage: BudgetUsage
  /** Legacy caller compatibility; already incurred usage is not capped at settlement. */
  cap?: number
}

// Policy depends on this port, independently of the catalog, embeddings and ORM driver.
export interface BudgetRepository {
  reserveDailyBudget(input: BudgetReservationInput): Promise<boolean>
  settleDailyBudget(input: BudgetSettlementInput): Promise<boolean>
  releaseDailyBudget(requestId: string): Promise<boolean>
  abandonDailyBudget(requestId: string): Promise<boolean>
  recoverDailyBudgetReservations(before: number, limit?: number): Promise<number>
  insertUsage(usage: BudgetUsage): Promise<void>
  dayTokenUsage(day: string): Promise<number>
}
