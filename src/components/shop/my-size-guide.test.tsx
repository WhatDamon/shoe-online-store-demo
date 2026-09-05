// MySizeGuide 行为测试：details 展开 → 滑杆改 draft → 换算行 → 保存/清除 →
// 快照广播。my-size 外部 store 为模块级缓存，测试间须清 localStorage + 重置模块。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

beforeEach(() => {
  window.localStorage.clear()
  vi.resetModules()
})

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

// 注意：MySizeGuide 自身 useSyncExternalStore 读取的是导入期快照，跨测试需重置；
// 由 beforeEach resetModules 保证每例重新 import 模块级缓存。

describe('MySizeGuide', () => {
  it('shows collapsed trigger with "My size" when nothing saved', async () => {
    const { MySizeGuide: Guide } = await import('./my-size-guide')
    render(<Guide />)
    expect(screen.getByText('My size')).toBeInTheDocument()
    // 注：jsdom 不应用 UA 样式表，闭合 details 的内容仍可见，无法断言收起态隐藏；
    // 仅验证 trigger 文案与默认草稿换算值存在。
    expect(screen.getByText('Foot length')).toBeInTheDocument()
  })

  it('shows slider + five-system conversion row', async () => {
    const { MySizeGuide: Guide } = await import('./my-size-guide')
    render(<Guide />)
    expect(screen.getByText('Foot length')).toBeInTheDocument()
    expect(screen.getByText('US')).toBeInTheDocument()
    expect(screen.getByText('EU')).toBeInTheDocument()
  })

  it('saves and reflects the saved value in the trigger + aria', async () => {
    const { MySizeGuide: Guide } = await import('./my-size-guide')
    render(<Guide />)
    // 默认 265mm → EU 41（就近 266）→ US 8
    fireEvent.click(screen.getByRole('button', { name: 'Save my size' }))
    expect(window.localStorage.getItem('evoloop:foot-mm')).toBe('265')
    // 触发行变 saved：默认市场 US → "My size: 8 US"
    expect(screen.getByText(/My size:/)).toBeInTheDocument()
    expect(screen.getByText('Remove')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save my size' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Update my size' })).toBeInTheDocument()
  })

  it('remove clears the stored size', async () => {
    window.localStorage.setItem('evoloop:foot-mm', '280')
    const { MySizeGuide: Guide } = await import('./my-size-guide')
    render(<Guide />)
    expect(window.localStorage.getItem('evoloop:foot-mm')).toBe('280')
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(window.localStorage.getItem('evoloop:foot-mm')).toBeNull()
  })

  it('out-of-table mm shows honest note and no conversions', async () => {
    const { MySizeGuide: Guide } = await import('./my-size-guide')
    render(<Guide />)
    // 滑杆设 220（<227 表外）
    const slider = screen.getByRole('slider', { name: /foot length/i })
    fireEvent.change(slider, { target: { value: '220' } })
    expect(screen.getByText(/outside adult sizes/)).toBeInTheDocument()
    expect(screen.getByText(/outside our current size range/)).toBeInTheDocument()
  })
})
