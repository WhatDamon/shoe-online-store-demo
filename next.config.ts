import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // 产品与 hero 视觉均为本地资产（SVG / src/assets WebP），无需远程图片白名单。
  // better-sqlite3 是原生 .node 模块：交给运行时 external 加载（Turbopack 不打包 .node）。
  serverExternalPackages: ['better-sqlite3'],
  // Runtime Drizzle migrators read these SQL files from process.cwd(). Keep
  // both dialects in standalone/server traces so a deployed cold start can
  // initialize the selected database without a separate migration step.
  outputFileTracingIncludes: {
    '/*': ['./drizzle/sqlite/**/*', './drizzle/postgres/**/*'],
  },
  // 根布局由顶层动态段 [locale] 定义，未匹配的 URL 需要一个不依赖任何 layout 的
  // 全局 404（src/app/global-not-found.tsx）；Next 16 仍以 experimental 标记该能力。
  experimental: {
    globalNotFound: true,
  },
}

export default nextConfig
