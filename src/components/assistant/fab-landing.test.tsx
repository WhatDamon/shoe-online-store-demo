import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DEFAULT_LOCALE, localePath } from '@/i18n/locales'

// FAB 用 usePathname 判定落地页自隐；这里直接控制 pathname，避免真实 router 依赖
// （与 assistant.test.tsx 同一手法，本文件是新增回归防线，不改动既有测试）。
const nav = vi.hoisted(() => ({ pathname: '' }))
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }))

import { AssistantFabSlot } from './fab'

// 期望路径从 localePath 推导，不手写 '/en'：locale 是 URL 的一段，阶段 2 加语言后
// 这条规则的语义（「当前语言的落地页」）不变，字面量会腐烂。
const LANDING = localePath(DEFAULT_LOCALE, '/')
const OFF_LANDING = localePath(DEFAULT_LOCALE, '/shop')

const handle = { open: () => {}, close: () => {} }

// 回归背景：应用路由下移到 [locale] 后，这里若仍与字面量 '/' 比较，落地页（真实
// pathname 为 /en）会重新长出导购入口，破坏「Landing 零导购痕迹」（P1 产品规则）。
describe('FAB 落地页自隐（P1：Landing 零导购痕迹）', () => {
  it(`当前语言的落地页（${LANDING}）不渲染 FAB`, () => {
    nav.pathname = LANDING
    render(<AssistantFabSlot assistant={handle} />)
    expect(
      screen.queryByRole('button', { name: 'Open shopping assistant' }),
    ).not.toBeInTheDocument()
  })

  it(`非落地页（${OFF_LANDING}）渲染 FAB`, () => {
    nav.pathname = OFF_LANDING
    render(<AssistantFabSlot assistant={handle} />)
    expect(screen.getByRole('button', { name: 'Open shopping assistant' })).toBeInTheDocument()
  })
})
