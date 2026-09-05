'use client'

import { useEffect, useRef } from 'react'
import type { CanonicalSize } from '@/server/catalog/types'
import type { ChatMessage } from './use-chat-stream'
import { MarkdownLite } from './markdown-lite'
import { ProductResultCard } from './product-result-card'
import { cn } from 'cn'

export interface MessageListProps {
  messages: ChatMessage[]
  isStreaming: boolean
  /** canonical(EU) → 市场标签（如 "US 9"）；无商品上下文时回退 "EU n"。 */
  sizeLabelFor: (eu: CanonicalSize) => string
  onRetry: () => void
}

function SizeFitBlock({
  recommended,
  alternatives,
  rationale,
  sizeLabelFor,
}: {
  recommended: CanonicalSize
  alternatives: CanonicalSize[]
  rationale: string
  sizeLabelFor: (eu: CanonicalSize) => string
}) {
  const label = sizeLabelFor(recommended)
  const nearby = alternatives.slice(0, 3).map(sizeLabelFor)
  return (
    <div role="status" className="rounded-xl border border-brand/25 bg-brand/5 px-3.5 py-2.5">
      <p className="text-[15px] font-semibold text-brand">Try {label}</p>
      {nearby.length > 0 ? (
        <p className="mt-0.5 text-xs text-neutral-500">Nearby sizes: {nearby.join(' · ')}</p>
      ) : null}
      {rationale ? (
        <p className="mt-1.5 text-[13px] leading-5 text-neutral-700">{rationale}</p>
      ) : null}
    </div>
  )
}

// 会话消息列：用户右侧、助手左侧；流式文本 + 可选结果卡/尺码块；
// 自动贴底滚动，用户上翻时停止跟随。
export function MessageList({ messages, isStreaming, sizeLabelFor, onRetry }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const stickRef = useRef(true)
  const last = messages[messages.length - 1]

  useEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [messages, isStreaming])

  return (
    <div
      ref={scrollRef}
      role="log"
      aria-live="polite"
      aria-label="Conversation"
      onScroll={(e) => {
        const el = e.currentTarget
        stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      }}
      className="h-full overflow-y-auto"
    >
      <ul className="flex flex-col gap-3 px-4 py-4">
        {messages.map((message) => {
          const isUser = message.role === 'user'
          return (
            <li key={message.id} className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'flex max-w-[85%] flex-col gap-2 rounded-2xl px-3.5 py-2.5 text-sm leading-6',
                  isUser
                    ? 'rounded-br-sm bg-ink text-canvas'
                    : 'rounded-bl-sm border border-neutral-200 bg-surface text-neutral-800',
                )}
              >
                {message.sizeFit ? (
                  <SizeFitBlock
                    recommended={message.sizeFit.recommended}
                    alternatives={message.sizeFit.alternatives}
                    rationale={message.sizeFit.rationale}
                    sizeLabelFor={sizeLabelFor}
                  />
                ) : null}
                {message.content ? (
                  <MarkdownLite text={message.content} />
                ) : message.streaming ? (
                  <span aria-hidden="true" className="tracking-widest text-neutral-400">
                    ···
                  </span>
                ) : null}
                {message.cards && message.cards.length > 0 ? (
                  <ul className="flex flex-col gap-1.5">
                    {message.cards.map((card) => (
                      <li key={card.handle}>
                        <ProductResultCard item={card} />
                      </li>
                    ))}
                  </ul>
                ) : null}
                {message.error ? (
                  <p className="text-[13px] leading-5 text-neutral-600">{message.error.message}</p>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
      {last?.error && !isStreaming ? (
        <div className="px-4 pb-3">
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-[13px] font-medium text-neutral-800 transition-colors hover:border-neutral-400 hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
          >
            Try again
          </button>
        </div>
      ) : null}
    </div>
  )
}
