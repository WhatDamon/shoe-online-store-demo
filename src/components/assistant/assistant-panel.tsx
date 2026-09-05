'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'
import { SendIcon, Volume2Icon, XIcon } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Mode } from '@/server/ai/events'
import type { CanonicalSize } from '@/server/catalog/types'
import type { ProductView } from '@/server/catalog/service'
import { convert } from '@/server/catalog/size-charts'
import { market } from '@/lib/market'
import { isSpeechSupported } from '@/lib/speech'
import { cn } from 'cn'
import type { ChatMessage } from './use-chat-stream'
import { MessageList } from './message-list'
import {
  CONTEXT_SUGGESTIONS,
  GENERAL_SUGGESTIONS,
  SuggestionChips,
  SUGGESTIONS,
} from './suggestion-chips'

export interface AssistantPanelProps {
  isOpen: boolean
  onClose: () => void
  product: ProductView | null
  onRemoveProduct: () => void
  /** 发送当前模式下的用户文本（provider 已带 mode/product 上下文）。 */
  onSend: (text: string) => void
  onPick: (mode: Mode, label: string) => void
  onRetry: () => void
  messages: ChatMessage[]
  isStreaming: boolean
  /** 朗读开关（记住偏好）：开 → 每条完成的 AI 回复自动整段朗读。 */
  speakOn: boolean
  onToggleSpeak: (next: boolean) => void
}

// 导购浮层面板（克制呈现 P1：头部/开场/chips 全为消费端措辞，不出现 "AI"）。
export function AssistantPanel({
  isOpen,
  onClose,
  product,
  onRemoveProduct,
  onSend,
  onPick,
  onRetry,
  messages,
  isStreaming,
  speakOn,
  onToggleSpeak,
}: AssistantPanelProps) {
  const [draft, setDraft] = useState('')
  const trimmed = draft.trim()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (isStreaming || !trimmed) return
    onSend(draft)
    setDraft('')
  }

  // 决策 #20：码段/附近尺码一律走市场标签（同 Select size chips）；
  // 无商品上下文时也无 sizeOptions，回退同口径市场标签（默认 US，经换算表）。
  const sizeLabelFor = (eu: CanonicalSize): string =>
    product?.sizeOptions.find((o) => o.value === eu)?.label ??
    (() => {
      const v = convert(eu, market.sizeSystem)
      return v == null ? `EU ${eu}` : `${market.sizeSystem} ${v}`
    })()

  const showWelcome = messages.length === 0 && !isStreaming

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <SheetContent side="right" className="flex h-full flex-col gap-0 p-0">
        <SheetHeader className="shrink-0 border-b border-neutral-200 pr-12">
          <div className="flex items-center justify-between gap-2">
            <SheetTitle>Need a hand?</SheetTitle>
            {isSpeechSupported() ? (
              <button
                type="button"
                onClick={() => onToggleSpeak(!speakOn)}
                aria-pressed={speakOn}
                aria-label="Read replies aloud"
                title={speakOn ? 'Stop reading replies aloud' : 'Read replies aloud'}
                className={cn(
                  'inline-flex size-9 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400 hover:bg-neutral-100',
                  speakOn && 'bg-neutral-100',
                )}
              >
                <Volume2Icon
                  className={cn('size-4', speakOn ? 'text-brand' : 'text-neutral-500')}
                  aria-hidden="true"
                />
                <span className="sr-only">{speakOn ? 'On' : 'Off'}</span>
              </button>
            ) : null}
          </div>
          <p className="text-xs text-neutral-500">
            Ask about sizing, styles, shipping &amp; returns, or what&rsquo;s in the shop.
          </p>
        </SheetHeader>

        {product ? (
          <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-4 py-2">
            <span className="min-w-0 flex-1 truncate text-[13px] text-neutral-700">
              Looking at: <span className="font-medium">{product.title}</span>
            </span>
            <button
              type="button"
              onClick={onRemoveProduct}
              aria-label={`Remove ${product.title}`}
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-200 hover:text-neutral-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
        ) : null}

        {/* 商品会话中常驻上下文 chips：welcome 只在无消息时出现，
            PDP "Find my size" 自动开场使消息非空 → welcome 永不与商品共存，
            若 context chips 仅放 welcome，outfit/size-fit 在 UI 内将永远不可达。 */}
        {product && !showWelcome && !isStreaming ? (
          <div className="flex shrink-0 flex-wrap gap-2 border-b border-neutral-100 px-4 py-2.5">
            <SuggestionChips onPick={onPick} items={CONTEXT_SUGGESTIONS} />
          </div>
        ) : null}

        <div className="min-h-0 flex-1">
          {showWelcome ? (
            <div className="flex h-full flex-col gap-4 overflow-y-auto px-4 py-4">
              <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-neutral-200 bg-surface px-3.5 py-2.5 text-sm leading-6 text-neutral-800">
                Hi — need a hand finding your pair?
              </div>
              {/* size-fit/outfit 需商品上下文；无商品时不渲染死路入口（服务端会回
                  "Pick a product first"）。welcome 与商品共存不可达，防御性取全量。 */}
              <SuggestionChips
                onPick={onPick}
                items={product ? SUGGESTIONS : GENERAL_SUGGESTIONS}
              />
            </div>
          ) : (
            <MessageList
              messages={messages}
              isStreaming={isStreaming}
              sizeLabelFor={sizeLabelFor}
              onRetry={onRetry}
            />
          )}
        </div>

        <form
          onSubmit={submit}
          aria-busy={isStreaming}
          className="flex shrink-0 items-center gap-2 border-t border-neutral-200 p-3"
        >
          <Input
            aria-label="Message"
            aria-busy={isStreaming}
            placeholder="Ask about a shoe, size, or style…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="h-10 flex-1"
            autoComplete="off"
          />
          <Button
            type="submit"
            size="icon"
            aria-label="Send"
            disabled={isStreaming || !trimmed}
            className="size-10 shrink-0"
          >
            <SendIcon />
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  )
}
