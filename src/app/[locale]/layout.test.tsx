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

// 非法 locale 是生产可达的：带点的单段路径（如 /foo.bar）被 proxy matcher 的 `.*\..*`
// 排除，不会加语言前缀，直接落到 [locale] 段并以 locale='foo.bar' 渲染。把 notFound 换成
// 明确抛出（Next 的 notFound 本身就是抛错控制流），守卫是否真的短路才可断言——没有它就会
// 走到 messages() 返回 undefined 的 500。
const navigation = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))
// 只换掉 notFound，其余导出（usePathname 等，FAB 会用）保持真实实现，
// 以便既有那条用例的渲染路径与改动前一致。
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  notFound: navigation.notFound,
}))

import RootLayout, { generateMetadata } from './layout'
import { site } from '@/lib/site'

describe('root layout', () => {
  it('html lang 等于入参 locale', async () => {
    render(await RootLayout({ children: null, params: Promise.resolve({ locale: 'en' }) } as never))
    expect(document.documentElement.getAttribute('lang')).toBe('en')
  })

  it('非法 locale 调用 notFound()，不渲染出页面', async () => {
    // 断言钉住两点：受守卫保护的渲染以 notFound() 结束（被调用且抛出），因此不会产出任何
    // 页面；非法语言也不会被写进 <html lang>。
    await expect(
      RootLayout({ children: null, params: Promise.resolve({ locale: 'foo.bar' }) } as never),
    ).rejects.toThrow('NEXT_NOT_FOUND')
    expect(navigation.notFound).toHaveBeenCalledTimes(1)
    expect(document.documentElement.getAttribute('lang')).not.toBe('foo.bar')
  })
})

// 根 metadata 按 URL 段语言产出（`/zh-CN` 的中文 description）。`generateMetadata` 与
// layout 是两条执行路径：拿不到可信语言段时它必须回落到默认语言，而不是抛出。
describe('root layout metadata', () => {
  it('/zh-CN 的 description 是中文，且与 en 不同', async () => {
    const zh = await generateMetadata({ params: Promise.resolve({ locale: 'zh-CN' }) })
    const en = await generateMetadata({ params: Promise.resolve({ locale: 'en' }) })
    expect(String(zh.description)).toMatch(/[\u4e00-\u9fff]/)
    expect(zh.description).not.toBe(en.description)
    expect(zh.openGraph?.locale).toBe('zh_CN')
  })

  it('title 默认值与模板不随语言改变（品牌名不本地化）', async () => {
    const zh = await generateMetadata({ params: Promise.resolve({ locale: 'zh-CN' }) })
    expect(zh.title).toMatchObject({ default: site.name, template: `%s — ${site.name}` })
  })

  it('非法 locale 回落到默认语言的 metadata，不抛错', async () => {
    const invalid = await generateMetadata({ params: Promise.resolve({ locale: 'xx' }) })
    const en = await generateMetadata({ params: Promise.resolve({ locale: 'en' }) })
    expect(invalid.description).toBe(en.description)
    expect(invalid.openGraph?.locale).toBe('en_US')
  })
})
