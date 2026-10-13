import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LocaleProvider } from '@/components/i18n/locale-provider'
import { messages } from '@/i18n/messages'
import { AssistantPanel } from './assistant-panel'

/**
 * 助手浮层关闭按钮的**可及名**（`sheet.tsx` 的 sr-only 文案）是用户可听的文案，
 * 不是样式噪声：`assistant-panel.tsx` 通过 `SheetContent` 的 `closeLabel` 入参
 * 传词典取值 `assistant.panel.close`，读屏用户会念到它。
 *
 * 这里用**新文件**而不是改 `assistant.test.tsx`：后者在阶段 1 的「受保护测试零改动」
 * 清单内（R18），断言一律写**字面量**（不走词典取值），词典被改一个字这里就红。
 */

const noop = () => {}

const props = {
  isOpen: true,
  onClose: noop,
  product: null,
  onRemoveProduct: noop,
  onSend: noop,
  onPick: noop,
  onRetry: noop,
  messages: [],
  isStreaming: false,
  speakOn: false,
  onToggleSpeak: noop,
}

describe('助手浮层关闭按钮的可及名', () => {
  it('无 Provider（默认语言）时是 Close', () => {
    render(<AssistantPanel {...props} />)
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('由面板消费词典取值：换掉 assistant.panel.close，可及名随之改变', () => {
    render(
      <LocaleProvider
        locale="en"
        messages={{ ...messages('en'), 'assistant.panel.close': 'Dismiss' }}
      >
        <AssistantPanel {...props} />
      </LocaleProvider>,
    )
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
  })
})
