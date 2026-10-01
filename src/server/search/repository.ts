import { and, eq, sql } from 'drizzle-orm'
import {
  aiBudgetDays,
  aiBudgetReservations,
  aiUsage,
  productEmbeddings,
  products,
} from '@/db/schema'
import { db } from '@/db/client'
import type { AppDb, PgAppDb } from '@/db/client'
import { resolveDbDriver } from '@/db/dialect'
import { type ProductRecord, withoutId } from '@/db/product-row'
import { parseVector } from './vector'
import { createPostgresRepository } from './repository-postgres'
import type { EmbeddingRow } from './embedding-row'

// 仓储只做持久化与整表读写：筛选/查找留在内存（catalog/filter.ts）。
// 前提是目录规模 ~10²（当前 29 款），全表 listAllProducts 再 find/filter 的成本可忽略；
// 若增长到 10⁴ 量级，需把筛选下推到 SQL（Repository 增加 query 方法）。
export function createRepository(db: AppDb) {
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
      return db.transaction((tx) => {
        const [existing] = tx
          .select({ status: aiBudgetReservations.status })
          .from(aiBudgetReservations)
          .where(eq(aiBudgetReservations.requestId, input.requestId))
          .limit(1)
          .all()
        if (existing) return existing.status === 'pending'

        tx.insert(aiBudgetDays)
          .values({
            day: input.day,
            reservedTokens: 0,
            // Bootstrap existing ledgers when upgrading to atomic reservations.
            usedTokens: sql`(select coalesce(sum(prompt_tokens + completion_tokens), 0) from ai_usage where day = ${input.day})`,
          })
          .onConflictDoNothing()
          .run()
        const [updated] = tx
          .update(aiBudgetDays)
          .set({ reservedTokens: sql`${aiBudgetDays.reservedTokens} + ${tokens}` })
          .where(
            and(
              eq(aiBudgetDays.day, input.day),
              sql`${aiBudgetDays.reservedTokens} + ${aiBudgetDays.usedTokens} + ${tokens} <= ${cap}`,
            ),
          )
          .returning({ day: aiBudgetDays.day })
          .all()
        if (!updated) return false
        tx.insert(aiBudgetReservations)
          .values({
            requestId: input.requestId,
            day: input.day,
            reservedTokens: tokens,
            actualTokens: 0,
            status: 'pending',
            createdAt: Date.now(),
          })
          .run()
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
      return db.transaction((tx) => {
        const [reservation] = tx
          .select()
          .from(aiBudgetReservations)
          .where(eq(aiBudgetReservations.requestId, input.requestId))
          .limit(1)
          .all()
        if (!reservation) return false
        if (reservation.status === 'settled') return true
        if (reservation.status !== 'pending') return false
        const [claimed] = tx
          .update(aiBudgetReservations)
          .set({ status: 'settling' })
          .where(
            and(
              eq(aiBudgetReservations.requestId, input.requestId),
              eq(aiBudgetReservations.status, 'pending'),
            ),
          )
          .returning()
          .all()
        if (!claimed) return false
        const extra = Math.max(0, actualTokens - claimed.reservedTokens)
        if (extra > 0) {
          const cap =
            input.cap == null ? Number.MAX_SAFE_INTEGER : Math.max(0, Math.floor(input.cap))
          const [toppedUp] = tx
            .update(aiBudgetDays)
            .set({ reservedTokens: sql`${aiBudgetDays.reservedTokens} + ${extra}` })
            .where(
              and(
                eq(aiBudgetDays.day, claimed.day),
                sql`${aiBudgetDays.reservedTokens} + ${aiBudgetDays.usedTokens} + ${extra} <= ${cap}`,
              ),
            )
            .returning({ day: aiBudgetDays.day })
            .all()
          if (!toppedUp) throw new Error('AI budget reservation day is missing')
        }
        tx.update(aiBudgetDays)
          .set({
            reservedTokens: sql`${aiBudgetDays.reservedTokens} - ${claimed.reservedTokens + extra}`,
            usedTokens: sql`${aiBudgetDays.usedTokens} + ${actualTokens}`,
          })
          .where(eq(aiBudgetDays.day, claimed.day))
          .run()
        tx.insert(aiUsage)
          .values({ ...input.usage, createdAt: Date.now() })
          .run()
        tx.update(aiBudgetReservations)
          .set({ status: 'settled', actualTokens })
          .where(eq(aiBudgetReservations.requestId, input.requestId))
          .run()
        return true
      })
    },
    async releaseDailyBudget(requestId: string): Promise<boolean> {
      return db.transaction((tx) => {
        const [reservation] = tx
          .select()
          .from(aiBudgetReservations)
          .where(eq(aiBudgetReservations.requestId, requestId))
          .limit(1)
          .all()
        if (!reservation) return false
        if (reservation.status === 'released') return true
        if (reservation.status !== 'pending') return false
        const [claimed] = tx
          .update(aiBudgetReservations)
          .set({ status: 'released' })
          .where(
            and(
              eq(aiBudgetReservations.requestId, requestId),
              eq(aiBudgetReservations.status, 'pending'),
            ),
          )
          .returning()
          .all()
        if (!claimed) return false
        tx.update(aiBudgetDays)
          .set({
            reservedTokens: sql`${aiBudgetDays.reservedTokens} - ${claimed.reservedTokens}`,
          })
          .where(eq(aiBudgetDays.day, claimed.day))
          .run()
        return true
      })
    },
    async getEmbedding(productId: string): Promise<EmbeddingRow | null> {
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
      await db.insert(aiUsage).values({ ...u, createdAt: Date.now() })
    },
    async dayTokenUsage(day: string): Promise<number> {
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
      await db.delete(aiBudgetReservations)
      await db.delete(aiBudgetDays)
      await db.delete(productEmbeddings)
      await db.delete(aiUsage)
      await db.delete(products)
    },
    // ---- products 表（DB 为运行时目录源）----
    async countProducts(): Promise<number> {
      const [row] = await db.select({ n: sql<number>`count(*)` }).from(products)
      return Number(row?.n ?? 0)
    },
    async listAllProducts(): Promise<ProductRecord[]> {
      return db.select().from(products)
    },
    async upsertProducts(records: ProductRecord[]): Promise<void> {
      for (const r of records) {
        await db
          .insert(products)
          .values(r)
          .onConflictDoUpdate({ target: products.id, set: withoutId(r) })
      }
    },
  }
}

export type Repository = ReturnType<typeof createRepository>

/** 按 DB_DRIVER 返回默认驱动实现（sqlite 本地 / postgres 云端）。
 * db() 负责 driver 分派并缓存两种连接；此处仅做类型收窄到对应驱动接口。 */
export function createDefaultRepository(): Repository {
  const connection = db()
  return resolveDbDriver() === 'postgres'
    ? createPostgresRepository(connection as PgAppDb)
    : createRepository(connection as AppDb)
}
