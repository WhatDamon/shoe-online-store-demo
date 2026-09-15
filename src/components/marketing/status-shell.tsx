import type { ReactNode } from 'react'
import { site } from '@/lib/site'
import { SiteShell } from './site-shell'

/** 状态页 CTA：错误页的重试按钮与两个页面的链接共用同一视觉。 */
export const STATUS_CTA_CLASS =
  'inline-flex items-center justify-center rounded-full bg-ink px-7 py-3 text-sm font-medium text-canvas transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400'

// 错误页与 404 共用的整屏壳：两者都在根布局下渲染（绕过组布局的 SiteShell），故自带全局壳。
// 标题与说明由调用方给，CTA 走 children —— 错误页是「重试 + 逛店」两个，404 只有一个链接。
export function StatusShell({
  title,
  description,
  children,
}: {
  title: ReactNode
  description: ReactNode
  children: ReactNode
}) {
  return (
    <SiteShell>
      <div className="flex flex-1 flex-col items-center justify-center bg-canvas px-6 py-24 text-center text-ink">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-brand">{site.name}</p>
        <h1 className="font-heading mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
          {title}
        </h1>
        <p className="mt-3 max-w-md text-neutral-600">{description}</p>
        {children}
      </div>
    </SiteShell>
  )
}
