import { render, screen } from '@testing-library/react'
import Link from 'next/link'
import { describe, expect, it } from 'vitest'
import { messages } from '@/i18n/messages'
import { LocaleProvider } from './locale-provider'
import { LocaleLink } from './locale-link'

describe('LocaleLink', () => {
  it('给站内相对路径加 locale 前缀', () => {
    render(<LocaleLink href="/shop">Shop</LocaleLink>)
    expect(screen.getByRole('link', { name: 'Shop' })).toHaveAttribute('href', '/en/shop')
  })
  it('保留查询串', () => {
    render(<LocaleLink href="/shop?color=red">Shop</LocaleLink>)
    expect(screen.getByRole('link')).toHaveAttribute('href', '/en/shop?color=red')
  })
  it('外层 Provider 的语言生效', () => {
    render(
      <LocaleProvider locale="en" messages={messages('en')}>
        <LocaleLink href="/cart">Cart</LocaleLink>
      </LocaleProvider>,
    )
    expect(screen.getByRole('link')).toHaveAttribute('href', '/en/cart')
  })
  it('非字符串 href 原样透传给 next/link', () => {
    const href = { pathname: '/shop' }
    render(
      <>
        <LocaleLink href={href}>A</LocaleLink>
        <Link href={href}>B</Link>
      </>,
    )
    // 与裸 `next/link` 的渲染结果对比，而不是硬编码期望值：`next/link` 会怎么把
    // UrlObject 渲染成 href 是它自己的实现细节，不是本组件的行为契约。
    expect(screen.getByRole('link', { name: 'A' })).toHaveAttribute(
      'href',
      screen.getByRole('link', { name: 'B' }).getAttribute('href'),
    )
  })
})
