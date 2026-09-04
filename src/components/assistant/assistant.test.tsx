import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AssistantProvider, useAssistant } from './assistant-provider'
import type { ProductView } from '@/server/catalog/service'

// FAB 用 usePathname 判断落地页隐藏；测试可控 pathname，并避免真实 router 依赖。
const nav = vi.hoisted(() => ({ pathname: '/' }))
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
}))

const product: ProductView = {
  id: 'p01',
  handle: 'daily-drift',
  title: 'Daily Drift',
  subtitle: 'Everyday knit-lattice sneaker',
  description: 'x',
  price: { amount: 128, currencyCode: 'USD' },
  productType: 'Sneaker',
  tags: [],
  collections: ['everyday'],
  sizes: [42, 43],
  features: [],
  fitNotes: '',
  construction: { pattern: 'lattice', density: 0.75, printedUpper: true },
  visual: { palette: ['#e8e6e0', '#d8d4cb'], accent: '#b87333', views: 3 },
  createdAt: '2026-08-01T00:00:00Z',
  sizeOptions: [
    { value: 42, label: 'US 8.5' },
    { value: 43, label: 'US 9' },
  ],
}

const enc = new TextEncoder()
const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`

/** 立即推送全部帧后关闭（普通流式回复）。 */
function streamedResponse(frames: string[]) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(enc.encode(f))
      controller.close()
    },
  })
  return { ok: true, body } as unknown as Response
}

/** 手动控制推送时机：测试发送中禁发用。 */
function heldResponse() {
  let push!: (f: string) => void
  let end!: () => void
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      push = (f: string) => controller.enqueue(enc.encode(f))
      end = () => controller.close()
    },
  })
  return { response: { ok: true, body } as unknown as Response, push, end }
}

function OpenShopping() {
  const assistant = useAssistant()
  return (
    <button type="button" onClick={() => assistant?.open('shopping', null)}>
      open shopping panel
    </button>
  )
}

function OpenSizeFit() {
  const assistant = useAssistant()
  return (
    <button type="button" onClick={() => assistant?.open('size-fit', product)}>
      find my size on PDP
    </button>
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('assistant FAB + panel', () => {
  it('shows the FAB off the landing page and opens the welcome panel with consumer chips', async () => {
    nav.pathname = '/shop'
    render(
      <AssistantProvider>
        <></>
      </AssistantProvider>,
    )
    const user = userEvent.setup()

    const fab = screen.getByRole('button', { name: 'Open shopping assistant' })
    await user.click(fab)

    expect(await screen.findByText(/need a hand finding your pair/i)).toBeInTheDocument()
    for (const label of [
      'Find my size',
      'Style it with',
      'Help me pick',
      'Everyday sneakers under $150',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('renders streamed product result cards linking to the detail page', async () => {
    nav.pathname = '/'
    const fetchMock = vi.fn().mockResolvedValue(
      streamedResponse([
        frame({
          type: 'productCards',
          items: [
            {
              handle: 'daily-drift',
              title: 'Daily Drift',
              price: 128,
              imageKind: 'local',
              palette: ['#e8e6e0', '#d8d4cb'],
            },
          ],
        }),
        frame({ type: 'delta', text: 'Here is your match: the Daily Drift.' }),
        frame({ type: 'done' }),
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(
      <AssistantProvider>
        <OpenShopping />
      </AssistantProvider>,
    )
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'open shopping panel' }))
    await user.click(
      screen.getByRole('button', { name: 'Everyday sneakers under $150' }),
    )

    const link = await screen.findByRole('link', { name: /Daily Drift/i })
    expect(link).toHaveAttribute('href', '/product/daily-drift')
    expect(within(link).getByText('$128.00')).toBeInTheDocument()
    expect(await screen.findByText(/Here is your match/i)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ai/chat',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('disables the send button while streaming and re-enables after done', async () => {
    nav.pathname = '/'
    const held = heldResponse()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(held.response))
    render(
      <AssistantProvider>
        <OpenShopping />
      </AssistantProvider>,
    )
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'open shopping panel' }))
    const input = await screen.findByRole('textbox', { name: 'Message' })
    const send = screen.getByRole('button', { name: 'Send' })
    expect(send).toBeDisabled() // 空输入不发

    await user.type(input, 'comfortable everyday sneakers')
    expect(send).toBeEnabled()
    await user.click(send)
    await user.clear(input)

    await waitFor(() => expect(send).toBeDisabled())
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveAttribute(
      'aria-busy',
      'true',
    )

    held.push(frame({ type: 'done' }))
    held.end()
    await user.type(input, 'one more question')
    await waitFor(() => expect(send).toBeEnabled())
  })

  it('shows the gentle error copy with retry and recovers on the next request', async () => {
    nav.pathname = '/'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        streamedResponse([
          frame({
            type: 'error',
            code: 'rate_limited',
            message: 'The assistant is taking a short break — try again in a moment.',
          }),
        ]),
      )
      .mockResolvedValueOnce(
        streamedResponse([
          frame({ type: 'delta', text: 'Here is your match: the Daily Drift.' }),
          frame({ type: 'done' }),
        ]),
      )
    vi.stubGlobal('fetch', fetchMock)
    render(
      <AssistantProvider>
        <OpenShopping />
      </AssistantProvider>,
    )
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'open shopping panel' }))
    const input = await screen.findByRole('textbox', { name: 'Message' })
    await user.type(input, 'comfortable everyday sneakers')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(
      await screen.findByText(/taking a short break/i),
    ).toBeInTheDocument()
    const retry = screen.getByRole('button', { name: 'Try again' })
    await user.click(retry)

    expect(await screen.findByText(/Here is your match/i)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('opens size-fit context from a product page, asks for the size, and shows the recommendation', async () => {
    nav.pathname = '/'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        streamedResponse([
          frame({
            type: 'delta',
            text: 'Can you tell me the size you usually wear, or your foot length in cm?',
          }),
          frame({ type: 'done' }),
        ]),
      )
      .mockResolvedValueOnce(
        streamedResponse([
          frame({
            type: 'sizeFit',
            recommended: 43,
            alternatives: [42],
            rationale: 'Daily Drift runs true to size. Based on your usual size, 43 (EU) should fit best.',
          }),
          frame({
            type: 'delta',
            text: 'Daily Drift runs true to size. Based on your usual size, 43 (EU) should fit best.',
          }),
          frame({ type: 'done' }),
        ]),
      )
    vi.stubGlobal('fetch', fetchMock)
    render(
      <AssistantProvider>
        <OpenSizeFit />
      </AssistantProvider>,
    )
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'find my size on PDP' }))

    // 预置商品上下文 chip
    expect(await screen.findByText(/Daily Drift/i)).toBeInTheDocument()
    const remove = screen.getByRole('button', { name: 'Remove Daily Drift' })

    // 助手先问尺码
    expect(
      await screen.findByText(/size you usually wear/i),
    ).toBeInTheDocument()

    // 用户回复尺码 → 结构化推荐
    const input = screen.getByRole('textbox', { name: 'Message' })
    await user.type(input, 'I usually wear US 9')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByText('Try US 9')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // 移除上下文 chip
    await user.click(remove)
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Remove Daily Drift' })).not.toBeInTheDocument(),
    )
  })
})
