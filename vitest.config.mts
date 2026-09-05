import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// Vitest workers run under Node.js (not Bun), so `bun:sqlite` cannot load in
// tests. Alias it to a node:sqlite compat shim (src/test/bun-sqlite-compat.ts);
// production code is untouched and keeps importing the real `bun:sqlite`.
const bunSqliteCompat = path.resolve(import.meta.dirname, 'src/test/bun-sqlite-compat.ts')

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      'bun:sqlite': bunSqliteCompat,
    },
  },
  test: {
    setupFiles: ['src/test/setup.ts'],
    environment: 'jsdom',
    env: {
      // 决策 #17：默认目录源是 DB，单元测试保持纯内存 seed 语义（不落盘）。
      CATALOG_SOURCE: 'seed',
    },
    include: ['src/**/*.test.{ts,tsx}'],
    server: {
      deps: {
        // drizzle-orm/bun-sqlite's driver module imports `bun:sqlite` itself;
        // inline it so Vite transforms that import through the alias above.
        inline: ['drizzle-orm/bun-sqlite'],
      },
    },
  },
})
