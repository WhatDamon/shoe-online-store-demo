import { render, screen } from '@testing-library/react'
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
})
