'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { HeartIcon, MenuIcon, SearchIcon, XIcon } from 'lucide-react'
import { site } from '@/lib/site'
import { useWishlist } from '@/components/shop/wishlist-provider'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { cn } from 'cn'

/**
 * 固定头部（规格 §9 全局导航）：位于每个路由组的 SiteShell 顶部。
 *
 * tone 决定未滚动时的表现：
 * - overlay：顶部透明 + 白色文字，压在深色 Hero 全出血图上（Landing 专用）；
 * - solid（默认）：canvas 实底 + ink 文字，用于普通内容页。
 * 滚动 > 8px 后统一变为磨砂底。纯交互客户端组件，数据来自 site 配置与
 * WishlistProvider，无自有状态数据源。
 *
 * 搜索对齐桌面/移动可用：lg+ 显示内联输入框；<lg 用搜索按钮展开整行输入
 * （autoFocus + Enter 提交到 /shop?q= + Escape/取消关闭），保证手机与桌面
 * 功能一致（无 lg 专用功能）。
 */
export function AppBar({
  tone = 'solid',
}: {
  tone?: 'overlay' | 'solid'
} = {}) {
  const { items } = useWishlist()
  const count = items.length
  const [scrolled, setScrolled] = useState(false)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  // 移动菜单用原生 <details>（零 JS 也可展开，见下方说明），ref 仅用于 JS
  // 可用时点击链接后收起面板（渐进增强，缺 JS 时无害）。
  const mobileMenuRef = useRef<HTMLDetailsElement>(null)

  // 初始恒为 false（SSR/水合一致）；监听 scroll 事件切换磨砂态。
  // setScrolled 仅出现在事件回调内（不在 effect 体内同步执行），
  // 避免 react-hooks/set-state-in-effect。
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    window.addEventListener('scroll', onScroll, { passive: true })
    // 滚动恢复/bfcache 返回时初始态恒 false 会使白字叠在浅底上不可见：
    // 挂载后异步自检一次（rAF 回调内 setState，不在 effect 同步体，规避
    // react-hooks/set-state-in-effect）。
    const frame = requestAnimationFrame(() => setScrolled(window.scrollY > 8))
    return () => {
      window.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [])

  // 搜索行常驻桌面（lg+）；手机展开态只在 <lg 显示。Escape 关闭。
  const closeMobileSearch = () => setMobileSearchOpen(false)
  const onMobileSearchRowKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeMobileSearch()
  }

  const searchSolid = scrolled || tone === 'solid'
  const wishlistLabel = `Wishlist, ${count} ${count === 1 ? 'item' : 'items'}`
  // 头部触控目标统一 ≥44px（Apple/Android 触控命中区规范下限）：真机手指出手偏
  // 离 36px 图标外沿即落空（表现为“点了没反应”），44px + 图标居中保证命中。
  const iconLinkClass =
    'inline-flex h-11 w-11 items-center justify-center rounded-full text-current transition-opacity hover:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current'

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-40 transition-colors',
        scrolled
          ? 'border-b border-ink/10 bg-canvas/85 text-ink backdrop-blur-md'
          : tone === 'overlay'
            ? 'border-b border-transparent bg-transparent text-white'
            : 'border-b border-ink/10 bg-canvas text-ink',
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4">
        {/* 左：移动菜单（md 隐藏）+ 品牌 */}
        <div className="flex flex-1 items-center gap-2">
          {/* 移动导航：原生 <details> 披露，不依赖任何 JS/组件库/门户/焦点陷阱。
              真机报告过：Android Chrome 上 JS 未水合时整站交互失效（汉堡/搜索/
              滚动磨砂全无反应）。details 由浏览器原生切换，无 JS 也必定能开；
              JS 可用时额外提供：点击链接收起 + 打开态图标切换 Menu→✕（纯 CSS）。 */}
          <details ref={mobileMenuRef} className="group relative md:hidden">
            <summary
              aria-label="Open menu"
              className="flex h-11 w-11 list-none cursor-pointer select-none items-center justify-center rounded-full text-current transition-opacity hover:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current [&::-webkit-details-marker]:hidden"
            >
              <MenuIcon className="size-5 group-open:hidden" />
              <XIcon className="hidden size-5 group-open:block" />
              <span className="sr-only">Menu</span>
            </summary>
            <nav
              aria-label="Mobile"
              className="absolute left-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-ink/10 bg-popover text-popover-foreground shadow-lg"
            >
              {site.nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => mobileMenuRef.current?.removeAttribute('open')}
                  className="block px-4 py-3 text-[15px] font-medium text-foreground transition-colors hover:bg-muted"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </details>
          <Link
            href="/"
            className="text-lg font-semibold tracking-tight transition-opacity hover:opacity-80"
          >
            {site.name}
          </Link>
        </div>

        {/* 中：桌面导航 */}
        <nav aria-label="Main" className="hidden flex-1 justify-center gap-8 md:flex">
          {site.nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm font-medium text-current transition-opacity hover:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-current"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* 右：搜索 + 愿望单 */}
        <div className="flex flex-1 items-center justify-end gap-1">
          {/* 桌面内联搜索：图标以输入框为锚绝对定位，垂直水平严格居中（不再用
              relative 硬推，避免偏移）；输入框 pl-10 让文字让出图标。 */}
          <form action="/shop" role="search" className="relative hidden items-center lg:flex">
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-current opacity-70"
            />
            <Input
              name="q"
              type="search"
              placeholder="Search"
              aria-label="Search products"
              className={cn(
                'h-9 w-44 rounded-full pl-10 text-sm transition-colors',
                searchSolid
                  ? 'border-neutral-300 bg-surface text-ink placeholder:text-neutral-400'
                  : 'border-white/25 bg-white/10 text-white placeholder:text-white/60',
              )}
            />
          </form>

          {/* 移动/平板搜索开关（<lg）：展开整行搜索 */}
          <div className="lg:hidden">
            <button
              type="button"
              aria-label="Search"
              aria-expanded={mobileSearchOpen}
              onClick={() => setMobileSearchOpen((v) => !v)}
              className={iconLinkClass}
            >
              <SearchIcon className="size-5" />
            </button>
          </div>

          <Link href="/shop" aria-label={wishlistLabel} className={cn(iconLinkClass, 'relative')}>
            <HeartIcon className="size-5" />
            <Badge
              variant="secondary"
              className="absolute -right-1 -top-1 min-w-4 px-1 text-[10px] tabular-nums"
            >
              {count}
            </Badge>
          </Link>
        </div>
      </div>

      {/* 移动展开搜索行：独立实底（header 可能为透明 overlay），autoFocus 即开即输 */}
      {mobileSearchOpen ? (
        <div
          role="search"
          onKeyDown={onMobileSearchRowKeyDown}
          className="border-t border-ink/10 bg-canvas px-4 pb-3 pt-2 text-ink lg:hidden"
        >
          <form action="/shop" className="mx-auto flex w-full max-w-6xl items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <SearchIcon
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-ink opacity-70"
              />
              <Input
                name="q"
                type="search"
                autoFocus
                placeholder="Search styles"
                aria-label="Search products"
                className="h-10 w-full rounded-full border-neutral-300 bg-surface pl-10 pr-4 text-ink placeholder:text-neutral-400"
              />
            </div>
            <button
              type="submit"
              className="h-10 shrink-0 rounded-full bg-ink px-5 text-sm font-medium text-canvas transition-opacity hover:opacity-80"
            >
              Search
            </button>
            <button
              type="button"
              aria-label="Close search"
              onClick={closeMobileSearch}
              className={cn(iconLinkClass, 'shrink-0 text-ink')}
            >
              <XIcon className="size-5" />
            </button>
          </form>
        </div>
      ) : null}
    </header>
  )
}
