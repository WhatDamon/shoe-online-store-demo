import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
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
export const aiBudgetDays = sqliteTable('ai_budget_days', {
  day: text('day').primaryKey(),
  reservedTokens: integer('reserved_tokens').notNull().default(0),
  usedTokens: integer('used_tokens').notNull().default(0),
})
export const aiBudgetReservations = sqliteTable(
  'ai_budget_reservations',
  {
    requestId: text('request_id').primaryKey(),
    day: text('day').notNull(),
    reservedTokens: integer('reserved_tokens').notNull(),
    actualTokens: integer('actual_tokens').notNull().default(0),
    status: text('status').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('idx_ai_budget_reservations_recovery').on(table.status, table.createdAt, table.requestId),
  ],
)
export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  handle: text('handle').notNull().unique(),
  title: text('title').notNull(),
  subtitle: text('subtitle').notNull(),
  description: text('description').notNull(),
  priceAmount: real('price_amount').notNull(),
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

export const schema = {
  productEmbeddings,
  aiUsage,
  aiBudgetDays,
  aiBudgetReservations,
  products,
}
