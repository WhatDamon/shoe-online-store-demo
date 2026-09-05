// PrintSpecSheetButton：点击触发 window.print()（浏览器打印/存 PDF）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PrintSpecSheetButton } from './print-spec-sheet-button'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PrintSpecSheetButton', () => {
  it('renders with the restrained consumer label', () => {
    render(<PrintSpecSheetButton />)
    expect(screen.getByRole('button', { name: 'Print / Save as PDF' })).toBeInTheDocument()
  })

  it('calls window.print on click', () => {
    const spy = vi.fn()
    vi.stubGlobal('print', spy)
    render(<PrintSpecSheetButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Print / Save as PDF' }))
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
