import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SizeSelector } from './size-selector'

const options = [
  { value: 41, label: 'US 7.5' },
  { value: 42, label: 'US 8.5' },
  { value: 43, label: 'US 9' },
]

describe('SizeSelector', () => {
  it('reports the canonical size when a US label is selected', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SizeSelector sizeOptions={options} selected={null} onChange={onChange} />)

    expect(screen.getByRole('group', { name: 'Select size' })).toBeInTheDocument()

    const radio = screen.getByRole('radio', { name: 'US 9' })
    expect(radio).toHaveAttribute('name', 'sizes')

    await user.click(radio)
    expect(onChange).toHaveBeenCalledWith(43)
  })

  it('reflects the controlled selection', () => {
    render(<SizeSelector sizeOptions={options} selected={42} onChange={() => {}} />)
    expect(screen.getByRole('radio', { name: 'US 8.5' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'US 9' })).not.toBeChecked()
  })

  it('highlights the matching size chip with a Your-size marker + aria', () => {
    render(<SizeSelector sizeOptions={options} selected={null} onChange={() => {}} match={43} />)
    const matched = screen.getByRole('radio', { name: 'US 9 (your size)' })
    expect(matched).toBeInTheDocument()
    expect(matched.closest('label')!.querySelector('[data-your-size="true"]')).not.toBeNull()
    expect(screen.getByText('Your size')).toBeInTheDocument()
    // 其余 chip 不带命中标注
    expect(screen.getByRole('radio', { name: 'US 8.5' })).not.toHaveAccessibleName(
      'US 8.5 (your size)',
    )
  })

  it('no match prop leaves chips unmarked', () => {
    render(<SizeSelector sizeOptions={options} selected={null} onChange={() => {}} />)
    expect(screen.queryByText('Your size')).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'US 9' })).toBeInTheDocument()
  })
})
