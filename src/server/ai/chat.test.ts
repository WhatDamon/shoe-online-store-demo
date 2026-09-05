// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { chat, NO_MATCH_TEXT, type ChatRequest } from './chat'
import { createDb } from '@/db/client'
import { createRepository } from '@/server/search/repository'
import { createGuardrails, GUARDRAIL_MESSAGE, type Guardrails } from '@/server/guardrails'
import { encodeEvent, parseEvent, type ChatEvent } from './events'
import { REDIRECT_TEXT } from './mock'
import * as retrievalModule from '@/server/search/retrieval'

// 屏蔽真实 embedder（含网络探测）：chat 内部 retrieve 一律走关键词降级。
const { mockEmbed, mockEmbeddingsAvailable } = vi.hoisted(() => ({
  mockEmbed: vi.fn(),
  mockEmbeddingsAvailable: vi.fn(),
}))
vi.mock('@/server/search/embedder', () => ({
  embeddingsAvailable: mockEmbeddingsAvailable,
  embed: mockEmbed,
}))

const collect = async (gen: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> => {
  const out: ChatEvent[] = []
  for await (const e of gen) out.push(e)
  return out
}

const fresh = (now: () => number = Date.now): Guardrails =>
  createGuardrails(createRepository(createDb(':memory:')), { now })

const req = (over: Partial<ChatRequest> = {}): ChatRequest => ({
  sessionKey: 'ses-t',
  ip: 'ip-t',
  mode: 'shopping',
  text: '',
  product: null,
  ...over,
})

const deltasOf = (evs: ChatEvent[]): string =>
  evs
    .filter((e): e is ChatEvent & { type: 'delta' } => e.type === 'delta')
    .map((e) => e.text)
    .join('')

beforeEach(() => {
  mockEmbed.mockReset()
  mockEmbeddingsAvailable.mockReset()
  mockEmbeddingsAvailable.mockResolvedValue(false)
  vi.stubEnv('AI_API_KEY', '') // 强制 Mock provider（无真实调用）
})

describe('events SSE 帧往返', () => {
  it('encodeEvent → parseEvent 对所有事件类型无损往返', () => {
    const cases: ChatEvent[] = [
      { type: 'delta', text: 'hello there' },
      {
        type: 'productCards',
        items: [
          {
            handle: 'daily-drift',
            title: 'Daily Drift',
            subtitle: 'DC-1001',
            image: null,
            imageKind: 'svg',
            photoCount: 0,
            sizeRange: 'EU 35–44',
            colorCount: 5,
            palette: ['#a', '#b'],
          },
        ],
      },
      {
        type: 'sizeFit',
        recommended: 43,
        alternatives: [42, 44],
        rationale: 'r',
      },
      { type: 'done' },
      { type: 'error', code: 'turns', message: GUARDRAIL_MESSAGE },
      {
        type: 'error',
        code: 'provider',
        message: 'Something went wrong — please try again.',
      },
    ]
    for (const e of cases) expect(parseEvent(encodeEvent(e))).toEqual(e)
  })

  it('parseEvent 拒绝垃圾帧', () => {
    expect(parseEvent('data: not-json')).toBeNull()
    expect(parseEvent('event: message\ndata: {"type":"done"}')).toBeNull() // 非 data: 开头
    expect(parseEvent('data: {"type":"nope"}')).toBeNull() // 未知 type
  })
})

describe('chat mock 编排', () => {
  it('find-shoes：检索命中 → productCards（含真实 handle）→ 总结 delta → done', async () => {
    const g = fresh()
    // avocado 仅在 26016-m（Avocado Kick）的标题/描述出现 → 单命中
    const evs = await collect(chat(req({ mode: 'find-shoes', text: 'avocado' }), { guardrails: g }))
    const cards = evs.find((e) => e.type === 'productCards')
    expect(cards?.type).toBe('productCards')
    if (cards?.type === 'productCards') {
      expect(cards.items.length).toBeGreaterThan(0)
      expect(cards.items[0].handle).toBe('26016-m')
      // 真实商品带真实照片 → photo 卡；且事件不带 price（AI 不传播 demo 价段）
      expect(cards.items[0]).toMatchObject({ imageKind: 'photo' })
      expect(cards.items[0]).not.toHaveProperty('price')
    }
    expect(evs[evs.length - 1]).toEqual({ type: 'done' })
    expect(evs.some((e) => e.type === 'error')).toBe(false)
  })

  it('shopping：delta 文本引用检索注入的真实商品名（RAG-lite 接地）', async () => {
    const g = fresh()
    const evs = await collect(chat(req({ mode: 'shopping', text: 'avocado' }), { guardrails: g }))
    expect(deltasOf(evs)).toContain('Avocado Kick')
    expect(evs[evs.length - 1]).toEqual({ type: 'done' })
  })

  it('size-fit：确定性 sizeFit 事件 recommended=43', async () => {
    const g = fresh()
    const evs = await collect(
      chat(
        req({
          mode: 'size-fit',
          text: 'I wear US 9',
          product: { handle: 'dc-1001', title: 'Urban Bloom' }, // 35-44 含 43
        }),
        { guardrails: g },
      ),
    )
    const fit = evs.find((e) => e.type === 'sizeFit')
    expect(fit).toMatchObject({ type: 'sizeFit', recommended: 43 })
    expect(fit?.type === 'sizeFit' && fit.alternatives).toContain(42)
    expect(evs[evs.length - 1]).toEqual({ type: 'done' })
  })

  it('size-fit 缺商品 → error invalid', async () => {
    const g = fresh()
    const evs = await collect(chat(req({ mode: 'size-fit', text: 'US 9' }), { guardrails: g }))
    expect(evs[0]).toMatchObject({ type: 'error', code: 'invalid' })
  })

  it('离题仅一段短 delta（redirect），且无 error', async () => {
    const g = fresh()
    const evs = await collect(
      chat(req({ mode: 'shopping', text: 'can you give me a recipe for bread' }), {
        guardrails: g,
      }),
    )
    const deltas = evs.filter((e) => e.type === 'delta')
    expect(deltas).toHaveLength(1)
    expect((deltas[0] as ChatEvent & { type: 'delta' }).text).toBe(REDIRECT_TEXT)
    expect(evs[evs.length - 1]).toEqual({ type: 'done' })
    expect(evs.some((e) => e.type === 'error')).toBe(false)
  })

  it('语义命中全为余弦≤0 → NO_MATCH（相关性下限闭合嵌入模式零命中分支）', async () => {
    const g = fresh()
    const spy = vi.spyOn(retrievalModule, 'retrieve').mockResolvedValue([
      { handle: 'daily-drift', score: 0 },
      { handle: 'cloudwalk-slip', score: -0.12 },
    ])
    try {
      const evs = await collect(
        chat(req({ mode: 'find-shoes', text: 'zzz nonsense' }), {
          guardrails: g,
        }),
      )
      expect(evs.some((e) => e.type === 'productCards')).toBe(false)
      const deltas = evs.filter((e) => e.type === 'delta')
      expect(deltas).toHaveLength(1)
      expect((deltas[0] as ChatEvent & { type: 'delta' }).text).toBe(NO_MATCH_TEXT)
      expect(evs[evs.length - 1]).toEqual({ type: 'done' })
      expect(evs.some((e) => e.type === 'error')).toBe(false)
    } finally {
      spy.mockRestore()
    }
  })

  it('护栏顺序：turns 超限（假时钟第 21 次）→ error code=turns + 温和文案，非 rate_limited', async () => {
    const clock = { now: 0 }
    const g = fresh(() => clock.now)
    const single = () => chat(req({ mode: 'shopping', text: 'cloudwalk' }), { guardrails: g })
    for (let i = 1; i <= 20; i++) {
      clock.now += 61_000 // 每次间隔 >1 分钟 → rate 桶回满，不触发 rate_limited
      const evs = await collect(single())
      expect(evs[evs.length - 1]).toEqual({ type: 'done' })
    }
    clock.now += 61_000
    const evs = await collect(single())
    expect(evs).toHaveLength(1)
    expect(evs[0]).toEqual({
      type: 'error',
      code: 'turns',
      message: GUARDRAIL_MESSAGE,
    })
  })
})
