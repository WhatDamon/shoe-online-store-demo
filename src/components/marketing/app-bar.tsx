'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { HeartIcon, MenuIcon, SearchIcon } from 'lucide-react'
import { site } from '@/lib/site'
import { useWishlist } from '@/components/shop/wishlist-provider'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { cn } from 'cn'

/**
 * 固定头部（规格 §9 全局导航）：位于每个路由组的 SiteShell 顶部。
 *
 * tone 决定未滚动时的表现：
 * - overlay：顶部透明 + 白色文字，压在深色 Hero 全出血图上（Landing 专用）；
 * - solid（默认）：canvas 实底 + ink 文字，用于普通内容页。
 * 滚动 > 8px 后统一变为磨砂底。纯交互客户端组件，数据来自 site 配置与
 * WishlistProvider，无自有状态数据源。
 */
export function AppBar({ tone = 'solid' }: { tone?: 'overlay' | 'solid' } = {}) {
  const { items } = useWishlist()
  const count = items.length
  const [scrolled, setScrolled] = useState(false)

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

  const searchSolid = scrolled || tone === 'solid'
  const wishlistLabel = `Wishlist, ${count} ${count === 1 ? 'item' : 'items'}`
  const iconLinkClass =
    'inline-flex h-9 w-9 items-center justify-center rounded-full text-current transition-opacity hover:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current'

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-40 transition-colors',
        scrolled
          ? 'border-b border-ink/10 bg-canvas/85 text-ink backdrop-blur-md'
          : tone === 'overlay'
            ? 'border-b border-transparent bg-transparent text-white'
            : 'border-b border-ink/10 bg-canvas text-ink'
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4">
        {/* 左：移动菜单（md 隐藏）+ 品牌 */}
        <div className="flex flex-1 items-center gap-2">
          <div className="md:hidden">
            <Sheet>
              <SheetTrigger
                aria-label="Open menu"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-current transition-opacity hover:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
              >
                <MenuIcon className="size-5" />
              </SheetTrigger>
              <SheetContent side="left">
                <SheetHeader>
                  <SheetTitle>Menu</SheetTitle>
                </SheetHeader>
                <nav aria-label="Mobile" className="flex flex-col gap-1 px-2">
                  {site.nav.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="rounded-md px-3 py-2.5 text-[15px] font-medium text-foreground transition-colors hover:bg-muted"
                    >
                      {item.label}
                    </Link>
                  ))}
                </nav>
              </SheetContent>
            </Sheet>
          </div>
          <Link
            href="/"
            className="font-heading text-lg font-semibold tracking-tight transition-opacity hover:opacity-80"
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
          <form action="/shop" role="search" className="hidden items-center lg:flex">
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none relative left-2.5 z-10 size-4 text-current opacity-70"
            />
            <Input
              name="q"
              type="search"
              placeholder="Search"
              aria-label="Search products"
              className={cn(
                'h-9 w-44 rounded-full pl-8 text-sm transition-colors',
                searchSolid
                  ? 'border-neutral-300 bg-white text-ink placeholder:text-neutral-400'
                  : 'border-white/25 bg-white/10 text-white placeholder:text-white/60'
              )}
            />
          </form>
          <Link
            href="/shop"
            aria-label="Search"
            className={cn(iconLinkClass, 'lg:hidden')}
          >
            <SearchIcon className="size-5" />
          </Link>
          <Link
            href="/shop"
            aria-label={wishlistLabel}
            className={cn(iconLinkClass, 'relative')}
          >
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
    </header>
  )
}
