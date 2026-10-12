import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

// `next/font/google` 由 Next 的构建期字体加载器替换，发包里的 index.js 是 0 字节：
// 不 mock 的话 `Geist(...)` 在 vitest 下根本不是函数。字体不是本用例的断言对象
// （这里断言的是 <html lang>），因此用最小替身隔离掉这个构建期专有模块。
vi.mock('next/font/google', () => ({
  Geist: () => ({ variable: 'font-geist-sans' }),
  Geist_Mono: () => ({ variable: 'font-geist-mono' }),
  Newsreader: () => ({ variable: 'font-newsreader' }),
}))

import RootLayout from './layout'

describe('root layout', () => {
  it('html lang 等于入参 locale', async () => {
    render(await RootLayout({ children: null, params: Promise.resolve({ locale: 'en' }) } as never))
    expect(document.documentElement.getAttribute('lang')).toBe('en')
  })
})
