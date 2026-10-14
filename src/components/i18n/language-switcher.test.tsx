import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { messages } from '@/i18n/messages'
import { LocaleProvider } from './locale-provider'
// 切换器渲染在 AppBar 里，而 AppBar 的既有测试不挂 router（usePathname 返回 null）；
// 这里直接控制 pathname，与 fab-landing.test.tsx 是同一手法（新增回归防线，不改动既有测试）。
const nav = vi.hoisted(() => ({ pathname: '/zh-CN/shop' }) as { pathname: string | null })
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }))

import { LanguageSwitcher } from './language-switcher'
import { AppBar } from '@/components/marketing/app-bar'
import { WishlistProvider } from '@/components/shop/wishlist-provider'

/** 渲染「当前语言 + 当前 pathname」这一组合，模拟真实页面（locale 由 [locale] 布局注入）。 */
function renderAt(locale: 'en' | 'zh-CN', pathname: string) {
  nav.pathname = pathname
  return render(
    <LocaleProvider locale={locale} messages={messages(locale)}>
      <LanguageSwitcher />
    </LocaleProvider>,
  )
}

describe('LanguageSwitcher', () => {
  it('在 /zh-CN/shop 上给出 /en/shop 与 /zh-CN/shop 两个入口', () => {
    // 审查重点 4：切换语言不得丢上下文，也不得叠成 /en/zh-CN/shop。
    renderAt('zh-CN', '/zh-CN/shop')

    expect(screen.getByRole('link', { name: 'EN' })).toHaveAttribute('href', '/en/shop')
    expect(screen.getByRole('link', { name: '中文' })).toHaveAttribute('href', '/zh-CN/shop')
    // 当前语言那项标记 aria-current（读屏能报「当前语言」），另一项不带。
    expect(screen.getByRole('link', { name: '中文' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('link', { name: 'EN' })).not.toHaveAttribute('aria-current')
  })

  it('在 /en 上给出 /en 与 /zh-CN（不带多余斜杠）', () => {
    renderAt('en', '/en')

    expect(screen.getByRole('link', { name: 'EN' })).toHaveAttribute('href', '/en')
    expect(screen.getByRole('link', { name: '中文' })).toHaveAttribute('href', '/zh-CN')
    expect(screen.getByRole('link', { name: 'EN' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('link', { name: '中文' })).not.toHaveAttribute('aria-current')
  })

  it('在 /en/shop 上往返切换稳定（不双重前缀）', () => {
    renderAt('en', '/en/shop')

    expect(screen.getByRole('link', { name: '中文' })).toHaveAttribute('href', '/zh-CN/shop')
    expect(screen.getByRole('link', { name: 'EN' })).toHaveAttribute('href', '/en/shop')
  })

  it('外层是带可及名的 group（不是 landmark：AppBar 里同时存在两个实例）', () => {
    renderAt('zh-CN', '/zh-CN/shop')

    expect(screen.getByRole('group', { name: '切换语言' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: '切换语言' })).not.toBeInTheDocument()
  })

  it('无 router 上下文（usePathname 返回 null）时不抛错，href 回落到两个语言根路径', () => {
    // 裁决 R37：AppBar 的既有测试（app-bar / app-bar-i18n / site-shell / extracted-copy）不挂
    // router，而 next 的 usePathname 在无 router 时返回 null，`splitPath` 会直接抛
    // `Cannot read properties of null (reading 'search')`。那四个文件一个字都不能改，
    // 所以 `?? '/'` 回退必须由本断言钉住——否则日后有人删掉它时，只有我们无权修改的
    // 那四个文件会红，等于把故障留给下一个人。
    nav.pathname = null
    expect(() =>
      render(
        <LocaleProvider locale="en" messages={messages('en')}>
          <LanguageSwitcher />
        </LocaleProvider>,
      ),
    ).not.toThrow()

    expect(screen.getByRole('link', { name: 'EN' })).toHaveAttribute('href', '/en')
    expect(screen.getByRole('link', { name: '中文' })).toHaveAttribute('href', '/zh-CN')
  })

  it('两个标签都是语言自称（EN / 中文），不随界面语言翻译', () => {
    // 语言名的自称不译：英文界面与中文界面下两个链接的可及名必须一致，
    // 否则读屏用户在中文界面里找不到「EN」这条出口。
    const english = renderAt('en', '/en/shop')
    expect(screen.getByRole('link', { name: 'EN' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '中文' })).toBeInTheDocument()
    english.unmount()

    renderAt('zh-CN', '/zh-CN/shop')
    expect(screen.getByRole('link', { name: 'EN' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '中文' })).toBeInTheDocument()
  })
})

describe('在 AppBar 里的落位（裁决 R39）', () => {
  /** 两个实例：移动实例在 `<details>`（`md:hidden`）里，头部实例 `<md` 隐藏。
   *
   * 这条断言不是在测样式，而是在钉住 R39 的**构造保证**。这里的 class **就是契约本身**
   *（它编码的是不变量：两个实例的可见性并集覆盖整个宽度区间、交集为空，且 `<md` 时头部
   * 增量恒为 0），所以允许对 class 做断言。本仓库没有 headless 浏览器、jsdom 不做布局，
   * 「不溢出」只能由「<md 时头部没有这颗控件」保证，不可能靠尺寸估算。
   *
   * 因此**不要**为了「看起来更干净」把 `hidden md:flex` 删掉，也不要把它改成 `lg:flex`：
   * 后者会让 768–1024px 两个实例都不可见（菜单实例在 `md:hidden` 的菜单里），整段拿掉切换器。
   * 若换成别的写法，请保留同样的不变量并同步更新本断言。 */
  it('渲染两个实例：移动菜单内一个（<md）、右侧操作区一个（≥md）', () => {
    nav.pathname = '/zh-CN/shop'
    render(
      <WishlistProvider>
        <LocaleProvider locale="zh-CN" messages={messages('zh-CN')}>
          <AppBar />
        </LocaleProvider>
      </WishlistProvider>,
    )

    // DOM 顺序：左侧（移动菜单）在前，右侧操作区在后。
    const groups = screen.getAllByRole('group', { name: '切换语言' })
    expect(groups).toHaveLength(2)

    const mobileMenu = groups[0].closest('details')
    expect(mobileMenu).not.toBeNull()
    expect(mobileMenu).toHaveClass('md:hidden')
    expect(groups[0].closest('nav')?.getAttribute('aria-label')).toBe('移动端')

    expect(groups[1].closest('details')).toBeNull()
    expect(groups[1].parentElement).toHaveClass('hidden', 'md:flex')

    // 两个实例指向同一组目标：切语言不丢上下文，且不双重前缀。
    for (const group of groups) {
      expect(within(group).getByRole('link', { name: 'EN' })).toHaveAttribute('href', '/en/shop')
      expect(within(group).getByRole('link', { name: '中文' })).toHaveAttribute(
        'href',
        '/zh-CN/shop',
      )
    }
  })
})
