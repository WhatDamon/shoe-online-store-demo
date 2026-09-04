import { eq, sql } from 'drizzle-orm'
import { productEmbeddings, aiUsage } from '@/db/schema'
import type { AppDb } from '@/db/client'

export interface EmbeddingRow {
  productId: string
  contentHash: string
  model: string
  vector: number[]
}

export function createRepository(db: AppDb) {
  return {
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
            vector: JSON.parse(row[0].vector),
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
        vector: JSON.parse(r.vector),
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
      await db.delete(productEmbeddings)
      await db.delete(aiUsage)
    },
  }
}
