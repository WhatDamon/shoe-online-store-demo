import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { messages } from '@/i18n/messages'
import { LocaleProvider, useLocale, useMessages } from './locale-provider'

function Probe() {
  return (
    <span>
      {useLocale()}:{useMessages()['nav.shop']}
    </span>
  )
}

describe('LocaleProvider', () => {
  it('向下游提供 locale 与词典', () => {
    render(
      <LocaleProvider locale="en" messages={messages('en')}>
        <Probe />
      </LocaleProvider>,
    )
    expect(screen.getByText('en:Shop')).toBeInTheDocument()
  })
  it('无 Provider 时回退默认语言而不是抛错', () => {
    // 裁决 R4
    render(<Probe />)
    expect(screen.getByText('en:Shop')).toBeInTheDocument()
  })
})
