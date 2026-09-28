import { and, eq, sql } from 'drizzle-orm'
import {
  aiBudgetDays,
  aiBudgetReservations,
  aiUsage,
  productEmbeddings,
  products,
} from '@/db/schema-postgres'
import { ensurePgTables } from '@/db/client'
import type { PgAppDb } from '@/db/client'
import { type ProductRecord, withoutId } from '@/db/product-row'
import { parseVector } from './vector'
import type { EmbeddingRow } from './embedding-row'

/** Postgres 实现：方法形状与 sqlite 版完全一致 → 可当 Repository 用。 */
export function createPostgresRepository(db: PgAppDb) {
  return {
    async reserveDailyBudget(input: {
      requestId: string
      day: string
      tokens: number
      cap: number
    }): Promise<boolean> {
      const tokens = Math.max(0, Math.floor(input.tokens))
      const cap = Math.max(0, Math.floor(input.cap))
      if (!input.requestId || !input.day || tokens <= 0 || cap <= 0) return false
      await ensurePgTables(db)
      return db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ status: aiBudgetReservations.status })
          .from(aiBudgetReservations)
          .where(eq(aiBudgetReservations.requestId, input.requestId))
          .limit(1)
        if (existing) return existing.status === 'pending'

        await tx
          .insert(aiBudgetDays)
          .values({ day: input.day, reservedTokens: 0, usedTokens: 0 })
          .onConflictDoNothing()
        const [updated] = await tx
          .update(aiBudgetDays)
          .set({ reservedTokens: sql`${aiBudgetDays.reservedTokens} + ${tokens}` })
          .where(
            and(
              eq(aiBudgetDays.day, input.day),
              sql`${aiBudgetDays.reservedTokens} + ${aiBudgetDays.usedTokens} + ${tokens} <= ${cap}`,
            ),
          )
          .returning({ day: aiBudgetDays.day })
        if (!updated) return false
        await tx.insert(aiBudgetReservations).values({
          requestId: input.requestId,
          day: input.day,
          reservedTokens: tokens,
          actualTokens: 0,
          status: 'pending',
          createdAt: Date.now(),
        })
        return true
      })
    },
    async settleDailyBudget(input: {
      requestId: string
      usage: {
        day: string
        model: string
        promptTokens: number
        completionTokens: number
        sessionKey: string
      }
      cap?: number
    }): Promise<boolean> {
      const actualTokens = Math.max(
        0,
        Math.floor(input.usage.promptTokens) + Math.floor(input.usage.completionTokens),
      )
      await ensurePgTables(db)
      return db.transaction(async (tx) => {
        const [reservation] = await tx
          .select()
          .from(aiBudgetReservations)
          .where(eq(aiBudgetReservations.requestId, input.requestId))
          .limit(1)
        if (!reservation) return false
        if (reservation.status === 'settled') return true
        if (reservation.status !== 'pending') return false
        const [claimed] = await tx
          .update(aiBudgetReservations)
          .set({ status: 'settling' })
          .where(
            and(
              eq(aiBudgetReservations.requestId, input.requestId),
              eq(aiBudgetReservations.status, 'pending'),
            ),
          )
          .returning()
        if (!claimed) return false
        const extra = Math.max(0, actualTokens - claimed.reservedTokens)
        if (extra > 0) {
          const cap =
            input.cap == null ? Number.MAX_SAFE_INTEGER : Math.max(0, Math.floor(input.cap))
          const [toppedUp] = await tx
            .update(aiBudgetDays)
            .set({ reservedTokens: sql`${aiBudgetDays.reservedTokens} + ${extra}` })
            .where(
              and(
                eq(aiBudgetDays.day, claimed.day),
                sql`${aiBudgetDays.reservedTokens} + ${aiBudgetDays.usedTokens} + ${extra} <= ${cap}`,
              ),
            )
            .returning({ day: aiBudgetDays.day })
          if (!toppedUp) throw new Error('AI budget reservation day is missing')
        }
        await tx
          .update(aiBudgetDays)
          .set({
            reservedTokens: sql`${aiBudgetDays.reservedTokens} - ${claimed.reservedTokens + extra}`,
            usedTokens: sql`${aiBudgetDays.usedTokens} + ${actualTokens}`,
          })
          .where(eq(aiBudgetDays.day, claimed.day))
        await tx.insert(aiUsage).values({ ...input.usage, createdAt: Date.now() })
        await tx
          .update(aiBudgetReservations)
          .set({ status: 'settled', actualTokens })
          .where(eq(aiBudgetReservations.requestId, input.requestId))
        return true
      })
    },
    async releaseDailyBudget(requestId: string): Promise<boolean> {
      await ensurePgTables(db)
      return db.transaction(async (tx) => {
        const [reservation] = await tx
          .select()
          .from(aiBudgetReservations)
          .where(eq(aiBudgetReservations.requestId, requestId))
          .limit(1)
        if (!reservation) return false
        if (reservation.status === 'released') return true
        if (reservation.status !== 'pending') return false
        const [claimed] = await tx
          .update(aiBudgetReservations)
          .set({ status: 'released' })
          .where(
            and(
              eq(aiBudgetReservations.requestId, requestId),
              eq(aiBudgetReservations.status, 'pending'),
            ),
          )
          .returning()
        if (!claimed) return false
        await tx
          .update(aiBudgetDays)
          .set({
            reservedTokens: sql`${aiBudgetDays.reservedTokens} - ${claimed.reservedTokens}`,
          })
          .where(eq(aiBudgetDays.day, claimed.day))
        return true
      })
    },
    async getEmbedding(productId: string): Promise<EmbeddingRow | null> {
      await ensurePgTables(db)
      const row = await db
        .select()
        .from(productEmbeddings)
        .where(eq(productEmbeddings.productId, productId))
        .limit(1)
      return row[0]
        ? {
            productId: row[0].productId,
            contentHash: row[0].contentHash,
            model: row[0].model,
            vector: parseVector(row[0].vector),
          }
        : null
    },
    async upsertEmbedding(row: EmbeddingRow): Promise<void> {
      await ensurePgTables(db)
      await db
        .insert(productEmbeddings)
        .values({
          productId: row.productId,
          contentHash: row.contentHash,
          model: row.model,
          vector: JSON.stringify(row.vector),
        })
        .onConflictDoUpdate({
          target: productEmbeddings.productId,
          set: {
            contentHash: row.contentHash,
            model: row.model,
            vector: JSON.stringify(row.vector),
          },
        })
    },
    async allEmbeddings(model: string): Promise<EmbeddingRow[]> {
      await ensurePgTables(db)
      const rows = await db
        .select()
        .from(productEmbeddings)
        .where(eq(productEmbeddings.model, model))
      return rows.map((r) => ({
        productId: r.productId,
        contentHash: r.contentHash,
        model: r.model,
        vector: parseVector(r.vector),
      }))
    },
    async insertUsage(u: {
      day: string
      model: string
      promptTokens: number
      completionTokens: number
      sessionKey: string
    }): Promise<void> {
      await ensurePgTables(db)
      await db.insert(aiUsage).values({ ...u, createdAt: Date.now() })
    },
    async dayTokenUsage(day: string): Promise<number> {
      await ensurePgTables(db)
      const [row] = await db
        .select({
          total: sql<number>`coalesce(sum(${aiUsage.promptTokens} + ${aiUsage.completionTokens}), 0)`,
        })
        .from(aiUsage)
        .where(eq(aiUsage.day, day))
      return Number(row?.total ?? 0)
    },
    async wipe(): Promise<void> {
      // 仅测试
      await ensurePgTables(db)
      await db.delete(aiBudgetReservations)
      await db.delete(aiBudgetDays)
      await db.delete(productEmbeddings)
      await db.delete(aiUsage)
      await db.delete(products)
    },
    // ---- products 表（DB 为运行时目录源；与 sqlite 实现同形）----
    async countProducts(): Promise<number> {
      await ensurePgTables(db)
      const [row] = await db.select({ n: sql<number>`count(*)` }).from(products)
      return Number(row?.n ?? 0)
    },
    async listAllProducts(): Promise<ProductRecord[]> {
      await ensurePgTables(db)
      return db.select().from(products)
    },
    async upsertProducts(records: ProductRecord[]): Promise<void> {
      await ensurePgTables(db)
      for (const r of records) {
        await db
          .insert(products)
          .values(r)
          .onConflictDoUpdate({ target: products.id, set: withoutId(r) })
      }
    },
  }
}
