import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // 产品与 hero 视觉均为本地资产（SVG / src/assets WebP），无需远程图片白名单。
  // better-sqlite3 是原生 .node 模块：交给运行时 external 加载（Turbopack 不打包 .node）。
  serverExternalPackages: ['better-sqlite3'],
}

export default nextConfig
