import { eq, sql } from 'drizzle-orm'
import { aiUsage, productEmbeddings } from '@/db/schema-postgres'
import { ensurePgTables } from '@/db/client'
import type { PgAppDb } from '@/db/client'
import { parseVector } from './vector'
import type { EmbeddingRow } from './repository'

/** Postgres 实现（决策 #13）：方法形状与 sqlite 版完全一致 → 可当 Repository 用。 */
export function createPostgresRepository(db: PgAppDb) {
  return {
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
      await db.delete(productEmbeddings)
      await db.delete(aiUsage)
    },
  }
}
