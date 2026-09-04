import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { parseShopParams } from '@/lib/shop-search-params'

const { replaceMock } = vi.hoisted(() => ({ replaceMock: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
}))

import { ProductFilterBar } from './product-filter-bar'

const options = {
  collectionOptions: [
    { value: 'everyday', label: 'Everyday' },
    { value: 'travel', label: 'Travel' },
  ],
  sizeOptions: [
    { label: 'US 8.5', canonical: 42 },
    { label: 'US 9', canonical: 43 },
  ],
}

const emptyFilter = () => parseShopParams(new URLSearchParams(''))

function renderBar(initial = emptyFilter()) {
  return render(<ProductFilterBar initial={initial} {...options} />)
}

describe('ProductFilterBar', () => {
  beforeEach(() => replaceMock.mockReset())
  afterEach(() => cleanup())

  it('pushes sort=price-asc to the URL when sorting changes', () => {
    renderBar()
    fireEvent.change(screen.getByLabelText('Sort'), {
      target: { value: 'price-asc' },
    })
    expect(replaceMock).toHaveBeenCalledWith('/shop?sort=price-asc')
  })

  it('sets the collection param when a collection is chosen', () => {
    renderBar()
    fireEvent.change(screen.getByLabelText('Collection'), {
      target: { value: 'travel' },
    })
    expect(replaceMock).toHaveBeenCalledWith('/shop?collection=travel')
  })

  it('keeps existing params when applying a new filter', () => {
    renderBar(parseShopParams(new URLSearchParams('collection=travel')))
    fireEvent.change(screen.getByLabelText('Sort'), {
      target: { value: 'newest' },
    })
    expect(replaceMock).toHaveBeenCalledWith('/shop?collection=travel&sort=newest')
  })

  it('maps a price band to minPrice/maxPrice params', () => {
    renderBar()
    fireEvent.change(screen.getByLabelText('Price'), {
      target: { value: '100-150' },
    })
    expect(replaceMock).toHaveBeenCalledWith('/shop?minPrice=100&maxPrice=150')
  })

  it('toggles a size label in and out of the URL', () => {
    renderBar(parseShopParams(new URLSearchParams('size=US+9')))
    const size9 = screen.getByLabelText('US 9') as HTMLInputElement
    expect(size9.checked).toBe(true)
    fireEvent.click(size9)
    expect(replaceMock).toHaveBeenCalledWith('/shop')
  })

  it('submits the keyword search as q', () => {
    renderBar()
    fireEvent.change(screen.getByLabelText('Search'), {
      target: { value: 'slip-on' },
    })
    fireEvent.submit(screen.getByRole('search'))
    expect(replaceMock).toHaveBeenCalledWith('/shop?q=slip-on')
  })

  it('clears all active filters', () => {
    renderBar(parseShopParams(new URLSearchParams('collection=travel&sort=price-desc')))
    fireEvent.click(screen.getByRole('button', { name: /clear all/i }))
    expect(replaceMock).toHaveBeenCalledWith('/shop')
  })

  it('composes two rapid changes without dropping the earlier param', () => {
    // router mock 不回传新 props —— 模拟一次 RSC 往返内连续两次变更（竞态窗口）。
    renderBar()
    fireEvent.change(screen.getByLabelText('Sort'), {
      target: { value: 'price-asc' },
    })
    fireEvent.change(screen.getByLabelText('Collection'), {
      target: { value: 'travel' },
    })
    expect(replaceMock).toHaveBeenLastCalledWith('/shop?collection=travel&sort=price-asc')
  })

  it('accumulates two size chips toggled before the server commits', () => {
    renderBar()
    fireEvent.click(screen.getByLabelText('US 9'))
    fireEvent.click(screen.getByLabelText('US 8.5'))
    expect(replaceMock).toHaveBeenLastCalledWith('/shop?size=US+9&size=US+8.5')
  })

  it('rebases onto the restored committed URL after Back cancels an in-flight clear-all', () => {
    // 挂载 /shop?collection=travel 后点 Clear all 发出在途 /shop（router mock 不回传，
    // 无中间提交渲染）；随后路由器提交 Back 后的状态：URL 回到 /shop?collection=travel
    // （committed 与挂载时同值，baseRef 却仍停留在被取消的在途 /shop 上）。
    const travel = parseShopParams(new URLSearchParams('collection=travel'))
    const { rerender } = render(<ProductFilterBar initial={travel} {...options} />)
    fireEvent.click(screen.getByRole('button', { name: /clear all/i }))
    expect(replaceMock).toHaveBeenLastCalledWith('/shop')
    rerender(<ProductFilterBar initial={travel} {...options} />)
    // 后续变更应基于已提交的 collection=travel 合成，而不是被 Back 放弃的 /shop。
    fireEvent.change(screen.getByLabelText('Sort'), {
      target: { value: 'newest' },
    })
    expect(replaceMock).toHaveBeenLastCalledWith('/shop?collection=travel&sort=newest')
  })

  it('does not resurrect a sort that Back abandoned before it committed', () => {
    // 挂载 /shop（空）后发出 sort=price-asc；路由器随后提交 Back 回 /shop（空）。
    // committed 与挂载时同值，baseRef 却仍停在在途 sort 上——选择 collection 时不应复活它。
    const empty = emptyFilter()
    const { rerender } = render(<ProductFilterBar initial={empty} {...options} />)
    fireEvent.change(screen.getByLabelText('Sort'), {
      target: { value: 'price-asc' },
    })
    expect(replaceMock).toHaveBeenLastCalledWith('/shop?sort=price-asc')
    rerender(<ProductFilterBar initial={empty} {...options} />)
    fireEvent.change(screen.getByLabelText('Collection'), {
      target: { value: 'travel' },
    })
    expect(replaceMock).toHaveBeenLastCalledWith('/shop?collection=travel')
  })
})
