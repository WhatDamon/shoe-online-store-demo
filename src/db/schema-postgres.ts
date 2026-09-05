import { bigint, doublePrecision, integer, pgTable, serial, text } from 'drizzle-orm/pg-core'

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

export const products = pgTable('products', {
  id: text('id').primaryKey(),
  handle: text('handle').notNull().unique(),
  title: text('title').notNull(),
  subtitle: text('subtitle').notNull(),
  description: text('description').notNull(),
  priceAmount: doublePrecision('price_amount').notNull(), // sqlite real 等价
  currency: text('currency').notNull(),
  productType: text('product_type').notNull(),
  collections: text('collections').notNull(), // JSON string[]
  sizes: text('sizes').notNull(), // JSON number[]（canonical EU）
  colors: text('colors').notNull(), // JSON Colorway[]
  features: text('features').notNull(), // JSON string[]
  tags: text('tags').notNull(), // JSON string[]
  construction: text('construction').notNull(), // JSON {pattern,density,printedUpper}
  visual: text('visual').notNull(), // JSON {palette,accent,views}
  images: text('images').notNull(), // JSON string[]（webp 路径）
  fitNotes: text('fit_notes').notNull(),
  createdAt: text('created_at').notNull(),
})

export const schema = { productEmbeddings, aiUsage, products }
