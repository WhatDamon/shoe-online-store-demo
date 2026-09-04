import { bigint, integer, pgTable, serial, text } from 'drizzle-orm/pg-core'

// Postgres 方言 schema（spec 决策 #13）：列语义与 sqlite 版对齐，
// 由 schema-parity 契约测试防漂移。createdAt 用 bigint（毫秒值超出 int32）。
export const productEmbeddings = pgTable('product_embeddings', {
  productId: text('product_id').primaryKey(),
  contentHash: text('content_hash').notNull(),
  model: text('model').notNull(),
  vector: text('vector').notNull(), // JSON number[]
})

export const aiUsage = pgTable('ai_usage', {
  id: serial('id').primaryKey(),
  day: text('day').notNull(),
  model: text('model').notNull(),
  promptTokens: integer('prompt_tokens').notNull(),
  completionTokens: integer('completion_tokens').notNull(),
  sessionKey: text('session_key').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(), // sqlite INTEGER(64) 等价
})

export const schema = { productEmbeddings, aiUsage }
