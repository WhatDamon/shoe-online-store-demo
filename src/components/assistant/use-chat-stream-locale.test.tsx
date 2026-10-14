import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { LocaleProvider } from '@/components/i18n/locale-provider'
import { messages } from '@/i18n/messages'
import type { Locale } from '@/i18n/locales'
import { useChatStream } from './use-chat-stream'

/**
 * `/api/ai/chat` 被 `src/proxy.ts` 排除（`/api` 早返回），Route Handler 拿不到 URL 段语言，
 * 只能用请求体里的 `locale`，缺失时回落到 `Accept-Language`。因此**客户端必须把页面语言
 * 放进请求体**：否则 `/zh-CN` 上的助手语言取决于浏览器语言，中文界面 + 英文浏览器 ⇒ 英文回复。
 * 这个断言钉住的是那条通道本身（逐字的值），不是「body 里有个 locale 字段」。
 */

const enc = new TextEncoder()

/** 一个立即 done 的最小 SSE 响应：只要请求真的发出并被读干，hook 就会离开 streaming。 */
function doneResponse(): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`))
      controller.close()
    },
  })
  return { ok: true, body } as Response
}

afterEach(() => vi.unstubAllGlobals())

/** 在 `locale` 的 LocaleProvider 下发送一次，返回 hook 实际发出的请求体（已解析）。 */
async function requestBodySentUnder(locale: Locale): Promise<Record<string, unknown>> {
  const fetchMock = vi.fn().mockResolvedValue(doneResponse())
  vi.stubGlobal('fetch', fetchMock)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <LocaleProvider locale={locale} messages={messages(locale)}>
      {children}
    </LocaleProvider>
  )
  const { result } = renderHook(() => useChatStream(), { wrapper })
  act(() => result.current.send('shopping', 'hello'))
  await waitFor(() => expect(result.current.isStreaming).toBe(false))
  expect(fetchMock).toHaveBeenCalledOnce()
  return JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, unknown>
}

describe('useChatStream 把页面语言放进请求体', () => {
  it('zh-CN 页面发出的 body.locale 是字面量 "zh-CN"', async () => {
    const body = await requestBodySentUnder('zh-CN')
    expect(body.locale).toBe('zh-CN')
  })

  it('en 页面发出的 body.locale 是字面量 "en"', async () => {
    const body = await requestBodySentUnder('en')
    expect(body.locale).toBe('en')
  })

  it('locale 与既有字段同级，不吞掉 text/product 语义', async () => {
    const body = await requestBodySentUnder('zh-CN')
    expect(body).toMatchObject({ mode: 'shopping', text: 'hello', product: null, locale: 'zh-CN' })
  })

  it('不挂 Provider（默认语言）时回落到 "en"，与受保护测试的既有断言一致', async () => {
    const fetchMock = vi.fn().mockResolvedValue(doneResponse())
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useChatStream())
    act(() => result.current.send('shopping', 'hello'))
    await waitFor(() => expect(result.current.isStreaming).toBe(false))
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, unknown>
    expect(body.locale).toBe('en')
  })
})
