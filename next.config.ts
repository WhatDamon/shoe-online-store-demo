import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Landing hero 编辑感 lifestyle 图（离线/失效时 Hero 静默降级为 ink 底色块）
      { protocol: 'https', hostname: 'images.unsplash.com' },
    ],
  },
}

export default nextConfig
