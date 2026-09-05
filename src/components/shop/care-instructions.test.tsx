import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CareInstructionsButton } from './care-instructions'

describe('CareInstructionsButton (decision #19: universal PDP care poster)', () => {
  it('renders a subtle trigger, no dialog until opened', () => {
    render(<CareInstructionsButton />)
    const trigger = screen.getByRole('button', { name: 'Care instructions' })
    expect(trigger).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens a fullscreen dialog with the poster image and closes via X', () => {
    render(<CareInstructionsButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Care instructions' }))

    const dialog = screen.getByRole('dialog', { name: 'Care instructions' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByAltText('How to care for your shoes')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close care instructions' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes on Escape and on backdrop click', () => {
    render(<CareInstructionsButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Care instructions' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    // Escape
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // Backdrop click (stopPropagation keeps inner panel clicks from closing)
    fireEvent.click(screen.getByRole('button', { name: 'Care instructions' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(dialog)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
