import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
export const productEmbeddings = sqliteTable('product_embeddings', {
  productId: text('product_id').primaryKey(),
  contentHash: text('content_hash').notNull(),
  model: text('model').notNull(),
  vector: text('vector').notNull(), // JSON number[]
})
export const aiUsage = sqliteTable('ai_usage', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  day: text('day').notNull(),
  model: text('model').notNull(),
  promptTokens: integer('prompt_tokens').notNull(),
  completionTokens: integer('completion_tokens').notNull(),
  sessionKey: text('session_key').notNull(),
  createdAt: integer('created_at').notNull(),
})
export const schema = { productEmbeddings, aiUsage }
