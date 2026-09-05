import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toSpeechText } from '@/lib/speech'

// 语音朗读 UI/行为：本文件通过 FAB 打开面板（无需 useAssistant），每次测试
// resetModules + 动态 import，隔离 speak-preference 模块级 loaded 缓存。
const nav = vi.hoisted(() => ({ pathname: '/shop' }))
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
}))

const enc = new TextEncoder()
const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`

function streamedResponse(frames: string[]) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(enc.encode(f))
      controller.close()
    },
  })
  return { ok: true, body } as unknown as Response
}

/** speak 同步触发 onend → 朗读队列整链走完，spokens 收齐全部块。 */
class FakeUtterance {
  text: string
  lang = ''
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(text: string) {
    this.text = text
  }
}

let spoken: FakeUtterance[]
let cancelCalls: number

function installSpeech() {
  spoken = []
  cancelCalls = 0
  vi.stubGlobal('speechSynthesis', {
    speak(u: FakeUtterance) {
      spoken.push(u)
      u.onend?.() // 完成整条链
    },
    cancel() {
      cancelCalls += 1
    },
  })
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
}

const spokenText = (): string =>
  spoken
    .map((u) => u.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

beforeEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
  vi.resetModules()
})

describe('assistant 语音朗读开关', () => {
  it('浏览器不支持 speechSynthesis 时头部不渲染朗读开关', async () => {
    nav.pathname = '/shop'
    const { AssistantProvider } = await import('./assistant-provider')
    render(
      <AssistantProvider>
        <></>
      </AssistantProvider>,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open shopping assistant' }))
    expect(await screen.findByText(/need a hand finding your pair/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Read replies aloud' })).not.toBeInTheDocument()
  })

  it('开关默认关（aria-pressed=false），点击记忆偏好并二次点击关闭', async () => {
    nav.pathname = '/shop'
    installSpeech()
    const { AssistantProvider } = await import('./assistant-provider')
    render(
      <AssistantProvider>
        <></>
      </AssistantProvider>,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open shopping assistant' }))

    const toggle = await screen.findByRole('button', { name: 'Read replies aloud' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    await user.click(toggle)
    expect(window.localStorage.getItem('evoloop:speak')).toBe('1')

    await user.click(toggle)
    expect(window.localStorage.getItem('evoloop:speak')).toBe('0')
  })

  it('开关开启时回复完成自动整段朗读（正文剥离 markdown 标记）', async () => {
    nav.pathname = '/shop'
    installSpeech()
    const { AssistantProvider } = await import('./assistant-provider')
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        streamedResponse([
          frame({ type: 'delta', text: 'Try the **Daily Drift** in `US 9`.' }),
          frame({ type: 'delta', text: ' It suits everyday wear.' }),
          frame({ type: 'done' }),
        ]),
      )
    vi.stubGlobal('fetch', fetchMock)
    render(
      <AssistantProvider>
        <></>
      </AssistantProvider>,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open shopping assistant' }))

    const toggle = await screen.findByRole('button', { name: 'Read replies aloud' })
    await user.click(toggle)
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'what fits me?')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled())
    await waitFor(() => expect(spoken.length).toBeGreaterThan(0))
    expect(spokenText()).toBe(
      toSpeechText('Try the **Daily Drift** in `US 9`. It suits everyday wear.'),
    )
  })

  it('开关关闭时回复完成不朗读', async () => {
    nav.pathname = '/shop'
    installSpeech()
    const { AssistantProvider } = await import('./assistant-provider')
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          streamedResponse([
            frame({ type: 'delta', text: 'a completed reply to be ignored' }),
            frame({ type: 'done' }),
          ]),
        ),
    )
    render(
      <AssistantProvider>
        <></>
      </AssistantProvider>,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open shopping assistant' }))
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'hello')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled())
    expect(spoken.length).toBe(0)
  })

  it('出错回复（error 帧）不朗读', async () => {
    nav.pathname = '/shop'
    installSpeech()
    const { AssistantProvider } = await import('./assistant-provider')
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          streamedResponse([
            frame({ type: 'delta', text: 'partial text before failure' }),
            frame({ type: 'error', code: 'provider', message: 'Something went wrong.' }),
          ]),
        ),
    )
    render(
      <AssistantProvider>
        <></>
      </AssistantProvider>,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open shopping assistant' }))
    const toggle = await screen.findByRole('button', { name: 'Read replies aloud' })
    await user.click(toggle)
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'hello')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument())
    expect(spoken.length).toBe(0)
  })

  it('关闭开关即打断正在朗读', async () => {
    nav.pathname = '/shop'
    installSpeech()
    const { AssistantProvider } = await import('./assistant-provider')
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        streamedResponse([
          frame({ type: 'delta', text: 'long enough reply. '.repeat(6) }),
          frame({ type: 'done' }),
        ]),
      )
    vi.stubGlobal('fetch', fetchMock)
    render(
      <AssistantProvider>
        <></>
      </AssistantProvider>,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open shopping assistant' }))
    const toggle = await screen.findByRole('button', { name: 'Read replies aloud' })
    await user.click(toggle)
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'hello')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(spoken.length).toBeGreaterThan(0))

    const before = cancelCalls
    await user.click(toggle) // 关 → stopSpeaking → cancel
    await waitFor(() => expect(cancelCalls).toBeGreaterThan(before))
  })

  it('发新消息打断上一回复朗读', async () => {
    nav.pathname = '/shop'
    installSpeech()
    const { AssistantProvider } = await import('./assistant-provider')
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          streamedResponse([
            frame({ type: 'delta', text: 'reply one. '.repeat(6) }),
            frame({ type: 'done' }),
          ]),
        ),
    )
    render(
      <AssistantProvider>
        <></>
      </AssistantProvider>,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open shopping assistant' }))
    const toggle = await screen.findByRole('button', { name: 'Read replies aloud' })
    await user.click(toggle)
    const input = await screen.findByRole('textbox', { name: 'Message' })
    await user.type(input, 'first')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(spoken.length).toBeGreaterThan(0))

    const before = cancelCalls
    await user.type(input, 'second question')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(cancelCalls).toBeGreaterThan(before))
  })

  it('开关在回复完成后才打开 → 历史不补读（只等新回复）', async () => {
    nav.pathname = '/shop'
    installSpeech()
    const { AssistantProvider } = await import('./assistant-provider')
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          streamedResponse([
            frame({ type: 'delta', text: 'old completed reply before enabling' }),
            frame({ type: 'done' }),
          ]),
        ),
    )
    render(
      <AssistantProvider>
        <></>
      </AssistantProvider>,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open shopping assistant' }))
    // 先关着拿一条完成回复
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'first q')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled())

    // 之后打开开关：旧回复不补读
    const toggle = screen.getByRole('button', { name: 'Read replies aloud' })
    await user.click(toggle)
    await waitFor(() => expect(toggle).toHaveAttribute('aria-pressed', 'true'))
    expect(spoken.length).toBe(0)
  })
})
