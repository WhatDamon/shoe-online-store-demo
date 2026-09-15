// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sizeRows } from '@/domain/size-fixture'
import { seedProducts } from '@/server/catalog/seed'
import type { ChatEvent } from '@/domain/chat-events'
import type { AiContext } from './provider'
import { NO_MATCH_TEXT, modeHandlers } from './handlers'
import type { ChatRequest, TurnContext } from './turn'

// 检索被整体替换：handler 单测不该碰 catalog / DB / 嵌入。这些路径的接线由 chat.test.ts 端到端覆盖。
const { mockRetrieveProducts } = vi.hoisted(() => ({ mockRetrieveProducts: vi.fn() }))
vi.mock('./retrieval-gateway', () => ({ retrieveProducts: mockRetrieveProducts }))

const collect = async (gen: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> => {
  const out: ChatEvent[] = []
  for await (const e of gen) out.push(e)
  return out
}

/** handler 的可见契约只有 stream / record 两个函数 —— 注入假的它们就完全脱离了 provider 与护栏栈。 */
interface Turn {
  ctx: TurnContext
  recorded: { system: string; userText: string; assistantText: string }[]
  sent: AiContext['messages'][]
  systems: string[]
}

function makeTurn(over: Partial<ChatRequest> = {}, reply = 'ok'): Turn {
  const recorded: Turn['recorded'] = []
  const sent: AiContext['messages'][] = []
  const systems: string[] = []
  const req: ChatRequest = {
    sessionKey: 'ses',
    ip: 'ip',
    mode: 'shopping',
    text: '',
    product: null,
    ...over,
  }
  const ctx: TurnContext = {
    req,
    text: req.text,
    history: [],
    async *stream(system, messages) {
      systems.push(system)
      sent.push(messages)
      yield { type: 'delta', text: reply }
      return reply
    },
    async record(system, userText, assistantText) {
      recorded.push({ system, userText, assistantText })
    },
  }
  return { ctx, recorded, sent, systems }
}

const run = (mode: ChatRequest['mode'], turn: Turn) => collect(modeHandlers[mode](turn.ctx))

const PRODUCT = { handle: 'dc-1001', title: 'Urban Bloom' } // 35–44，含 43
const EU43_MM = sizeRows.find((r) => r.systems.EU === 43)!.mm // 期望值取自真实尺码表

beforeEach(() => {
  mockRetrieveProducts.mockReset()
})

describe('商品锚定前置（size-fit / outfit 共用）', () => {
  it('缺商品 → error invalid，无 done，且完全不调 provider', async () => {
    const turn = makeTurn({ mode: 'size-fit', text: 'US 9' })
    const evs = await run('size-fit', turn)
    expect(evs).toEqual([
      {
        type: 'error',
        code: 'invalid',
        message: 'Pick a product first, then I can help with that.',
      },
    ])
    expect(turn.sent).toHaveLength(0)
    expect(turn.recorded).toHaveLength(0)
  })

  it('handle 查不到 → 同一句软拒绝（不区分「没带」与「查不到」）', async () => {
    const turn = makeTurn({ mode: 'outfit', product: { handle: 'no-such-handle', title: 'Ghost' } })
    const evs = await run('outfit', turn)
    expect(evs[0]).toMatchObject({ type: 'error', code: 'invalid' })
    expect(turn.sent).toHaveLength(0)
  })
})

describe('size-fit', () => {
  it('明确尺码 → sizeFit 事件先于 delta，并记账 rationale；全程不调 provider', async () => {
    const turn = makeTurn({ mode: 'size-fit', text: 'I wear US 9', product: PRODUCT })
    const evs = await run('size-fit', turn)

    expect(evs[0]).toMatchObject({ type: 'sizeFit', recommended: 43 })
    expect(evs[1]).toMatchObject({ type: 'delta' })
    expect(evs[evs.length - 1]).toEqual({ type: 'done' })
    expect(turn.sent).toHaveLength(0)
    expect(turn.recorded).toHaveLength(1)
    expect(turn.recorded[0].assistantText).toBe((evs[1] as { text: string }).text)
  })

  it('脚长预填（Find my size）→ 推荐来自 mm 映射，尽管文本没写尺码', async () => {
    const turn = makeTurn({ mode: 'size-fit', text: '', footMm: EU43_MM, product: PRODUCT })
    const evs = await run('size-fit', turn)
    expect(evs[0]).toMatchObject({ type: 'sizeFit', recommended: 43 })
  })

  it('既无文本尺码也无脚长 → 追问：只回文本，不出 sizeFit 事件', async () => {
    const turn = makeTurn({ mode: 'size-fit', text: '', product: PRODUCT })
    const evs = await run('size-fit', turn)
    expect(evs.some((e) => e.type === 'sizeFit')).toBe(false)
    expect(evs.filter((e) => e.type === 'delta')).toHaveLength(1)
    expect(evs[evs.length - 1]).toEqual({ type: 'done' })
    expect(turn.recorded).toHaveLength(1)
  })
})

describe('outfit', () => {
  it('空文本 → 发给模型与记账用的都是默认句', async () => {
    const turn = makeTurn({ mode: 'outfit', text: '', product: PRODUCT })
    const evs = await run('outfit', turn)

    expect(turn.sent[0][0]).toEqual({ role: 'user', content: 'Give me outfit ideas.' })
    expect(turn.recorded[0].userText).toBe('Give me outfit ideas.')
    expect(evs[evs.length - 1]).toEqual({ type: 'done' })
  })

  it('system 注入该鞋事实块，delta 透传，回复文本落账', async () => {
    const turn = makeTurn({ mode: 'outfit', text: 'date night', product: PRODUCT }, 'three ideas')
    const evs = await run('outfit', turn)

    expect(turn.systems[0]).toContain('Code: DC-1001.')
    expect(evs).toContainEqual({ type: 'delta', text: 'three ideas' })
    expect(turn.recorded[0]).toMatchObject({ userText: 'date night', assistantText: 'three ideas' })
  })
})

describe('support', () => {
  it('不做检索、不注入商品，直接流式并回 done', async () => {
    const turn = makeTurn({ mode: 'support', text: 'how do I care for my shoes' })
    const evs = await run('support', turn)

    expect(mockRetrieveProducts).not.toHaveBeenCalled()
    expect(turn.systems[0]).toContain('Care instructions')
    expect(evs[evs.length - 1]).toEqual({ type: 'done' })
    expect(turn.recorded[0].userText).toBe('how do I care for my shoes')
  })
})

describe('find-shoes / shopping（共用检索分支）', () => {
  beforeEach(() => {
    mockRetrieveProducts.mockResolvedValue(seedProducts.slice(0, 2))
  })

  it('find-shoes：结果卡先于 delta 出现，且卡片不带价格', async () => {
    const turn = makeTurn({ mode: 'find-shoes', text: 'running' })
    const evs = await run('find-shoes', turn)

    const cardIdx = evs.findIndex((e) => e.type === 'productCards')
    const deltaIdx = evs.findIndex((e) => e.type === 'delta')
    expect(cardIdx).toBeGreaterThanOrEqual(0)
    expect(cardIdx).toBeLessThan(deltaIdx)
    const cards = evs[cardIdx] as ChatEvent & { type: 'productCards' }
    expect(cards.items).toHaveLength(2)
    expect(Object.keys(cards.items[0])).not.toContain('price')
  })

  it('shopping：不出结果卡，但同样注入目录 digest', async () => {
    const turn = makeTurn({ mode: 'shopping', text: 'running' })
    const evs = await run('shopping', turn)

    expect(evs.some((e) => e.type === 'productCards')).toBe(false)
    expect(turn.systems[0]).toContain(seedProducts[0].title)
    expect(evs[evs.length - 1]).toEqual({ type: 'done' })
  })

  it('零命中 → 单个 NO_MATCH delta + done，并按该 mode 的 system 记账', async () => {
    mockRetrieveProducts.mockResolvedValue([])
    const turn = makeTurn({ mode: 'find-shoes', text: 'zzz' })
    const evs = await run('find-shoes', turn)

    expect(evs).toEqual([{ type: 'delta', text: NO_MATCH_TEXT }, { type: 'done' }])
    expect(turn.sent).toHaveLength(0)
    expect(turn.recorded[0].assistantText).toBe(NO_MATCH_TEXT)
  })

  it('shopping 带有效商品 → system 追加该鞋事实块，仍保留 digest', async () => {
    const turn = makeTurn({ mode: 'shopping', text: 'running', product: PRODUCT })
    await run('shopping', turn)

    expect(turn.systems[0]).toContain('Code: DC-1001.')
    expect(turn.systems[0]).toContain(seedProducts[0].title)
  })

  it('shopping 带未知 handle → 静默回退纯 digest（不报错、无商品块）', async () => {
    const turn = makeTurn({
      mode: 'shopping',
      text: 'running',
      product: { handle: 'no-such-handle', title: 'Ghost' },
    })
    const evs = await run('shopping', turn)

    expect(turn.systems[0]).not.toContain('Code:')
    expect(turn.systems[0]).toContain(seedProducts[0].title)
    expect(evs.some((e) => e.type === 'error')).toBe(false)
  })
})
