// PrintSpecSheet（打印规格区块）：服务端渲染真实数据；屏上 display:none（打印才可见）。
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PrintSpecSheet } from './print-spec-sheet'
import type { ProductView } from '@/server/catalog/service'
import { POLICY_RETURNS } from '@/lib/store-policy'

const p: ProductView = {
  id: 'p01',
  handle: 'dc-1001',
  title: 'Urban Bloom',
  subtitle: 'x',
  description: 'A soft everyday sneaker.',
  price: { amount: 128, currencyCode: 'USD' },
  productType: 'Sneaker',
  tags: [],
  collections: ['everyday'],
  sizes: [42, 43],
  features: ['Made to order', 'Fits true to size'],
  fitNotes: 'Roomy toe box',
  construction: { pattern: 'lattice', density: 0.75, printedUpper: true },
  visual: { palette: ['#111111', '#0f766e'], accent: '#0f766e', views: 3 },
  createdAt: '2026-08-01T00:00:00Z',
  colors: [{ name: 'Ivory', hex: '#f4f1ea' }],
  sizeOptions: [
    { value: 42, label: 'US 8.5' },
    { value: 43, label: 'US 9' },
  ],
}

describe('PrintSpecSheet', () => {
  it('renders real product facts (code/title/desc/features/colours/policy)', () => {
    render(<PrintSpecSheet product={p} />)
    expect(screen.getByText('Urban Bloom')).toBeInTheDocument()
    expect(screen.getByText('DC-1001')).toBeInTheDocument()
    expect(screen.getByText('A soft everyday sneaker.')).toBeInTheDocument()
    expect(screen.getByText('Made to order')).toBeInTheDocument()
    expect(screen.getByText('Ivory')).toBeInTheDocument()
    // 尺码换算行（42/43 canonical → US 8.5 / US 9）
    expect(screen.getByText('8.5')).toBeInTheDocument()
    expect(screen.getByText('9')).toBeInTheDocument()
  })

  it('never prints a demo price (prices only live on the shop/store)', () => {
    render(<PrintSpecSheet product={p} />)
    expect(screen.queryByText(/\$128/)).not.toBeInTheDocument()
    expect(screen.queryByText(/\$[0-9]/)).not.toBeInTheDocument()
  })

  it('is screen-hidden via the print-spec-sheet class (CSS shows it only under @media print)', () => {
    const { container } = render(<PrintSpecSheet product={p} />)
    const sheet = container.querySelector('.print-spec-sheet')
    expect(sheet).not.toBeNull()
    // jsdom 不计算样式；类即契约——display 开关由 globals.css 的 @media print 规则负责。
    expect(sheet!.className).toContain('print-spec-sheet')
  })

  it('renders the made-to-order returns policy (store-policy source)', () => {
    render(<PrintSpecSheet product={p} />)
    // POLICY_RETURNS 以完整句子渲染在 policy 区块内
    expect(screen.getAllByText(POLICY_RETURNS).length).toBeGreaterThan(0)
  })
})
