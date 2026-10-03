import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema-postgres.ts',
  out: './drizzle/postgres',
})
