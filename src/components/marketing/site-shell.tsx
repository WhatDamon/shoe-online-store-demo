'use client'

import type { ReactNode } from 'react'
import { cn } from 'cn'
import { AppBar } from './app-bar'
import { Footer } from './footer'

/**
 * 全站外壳：固定 AppBar + 内容 main + Footer，挂载在每组路由布局上。
 *
 * tone 决定头部在未滚动时的表现：
 * - overlay：透明 + 白色文字，压在深色 Hero 全出血图上（Landing 专用）；
 * - solid（默认）：canvas 底色 + ink 文字，内容预留头部高度（pt-16）。
 * 滚动后两者统一为磨砂态。'use client' 仅为可在 error.tsx（客户端）复用，
 * 内容通过 children 槽从服务端布局传入，不强制页面进入客户端边界。
 */
export function SiteShell({
  tone = 'solid',
  children,
}: {
  tone?: 'overlay' | 'solid'
  children: ReactNode
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-ink">
      {/* 键盘/读屏跳转链接（WCAG 2.4.1）：Tab 首元素即达，跳过头部导航直达正文。 */}
      <a
        href="#main"
        className="sr-only z-[60] rounded-md bg-ink px-4 py-2 text-sm font-medium text-canvas focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:outline-2 focus:outline-offset-2 focus:outline-brand"
      >
        Skip to content
      </a>
      <AppBar tone={tone} />
      {/* id="main" 是 skip link 的落地锚点（tabIndex=-1 使旧版 Safari 也能接收焦点）。 */}
      <main
        id="main"
        tabIndex={-1}
        className={cn('flex flex-1 flex-col', tone === 'solid' && 'pt-16')}
      >
        {children}
      </main>
      <Footer />
    </div>
  )
}
