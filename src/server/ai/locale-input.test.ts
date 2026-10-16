// 中文**输入解析规则**的行为断言（离题词表、客服关键词、分派顺序）。
//
// 直接对 `MockProvider` 说话而不是穿过 `chat()`：这里要钉的是「哪些用户词命中哪条分支」，
// 编排（护栏、检索、SSE 帧形状）另有 `chat.test.ts` 守着，重复一遍只会得到更慢的同一结论。
//
// 词表与关键词表按**请求语言**取用（`OFF_TOPIC[locale]`）：拉丁词如 `code` / `math` 会出现在
// 中文正常商品提问里（「折扣 code」），所以不能把两种语言的词表合并成一份来查。
import { describe, expect, it } from 'vitest'
import { messages } from '@/i18n/messages'
import { MockProvider } from './mock'
import { systemFor } from './prompts'

const say = async (mode: Parameters<typeof systemFor>[0], text: string, locale: 'en' | 'zh-CN') => {
  const chunks: string[] = []
  for await (const chunk of new MockProvider().stream({
    system: systemFor(mode, { catalogDigest: '- Urban Bloom (Sneaker): everyday comfort' }, locale),
    messages: [{ role: 'user', content: text }],
    locale,
    maxTokens: 500,
  }))
    if (typeof chunk === 'string') chunks.push(chunk)
  return chunks
}

describe('中文离题输入', () => {
  it('「帮我写一首诗」→ 一段离题 redirect，不是商品推荐', async () => {
    const chunks = await say('shopping', '帮我写一首诗', 'zh-CN')
    expect(chunks).toEqual([messages('zh-CN')['assistant.redirect']])
  })

  it('常见离题类别都被拦（食谱 / 天气 / 股票 / 作业 / 球赛）', async () => {
    for (const text of [
      '给我一个蛋糕食谱',
      '今天天气怎么样',
      '这股票会涨吗',
      '帮我写作业',
      '球赛几点开始',
    ]) {
      expect(await say('shopping', text, 'zh-CN'), text).toEqual([
        messages('zh-CN')['assistant.redirect'],
      ])
    }
  })

  it('英文离题词表照旧（同一入口的英文请求不受影响）', async () => {
    expect(await say('shopping', 'write me a poem about rain', 'en')).toEqual([
      messages('en')['assistant.redirect'],
    ])
  })

  it('正常的商品提问不被误拦（含拉丁词 code）', async () => {
    const reply = (await say('shopping', 'DC-1001 这个 code 有货吗', 'zh-CN')).join('')
    expect(reply).not.toBe(messages('zh-CN')['assistant.redirect'])
    expect(reply).toContain('Urban Bloom')
  })

  it('中文界面里的英文离题句不被拦截（R48：**这不是 bug，是有意取舍**）', async () => {
    // 词表按请求语言取，刻意不跨语言回落：合并中英两表会误伤上一条用例（含拉丁词的中文购物
    // 提问而拒答），代价就是这里——中文界面里的英文离题句照旧走正常推荐分支。要改这条断言，先读
    // `mock.ts` 的 `OFF_TOPIC` 注释：正确做法是加语言判定（文本以拉丁词为主时才查英文表），
    // 不是合并两张表。
    const reply = (await say('shopping', 'write me a poem about rain', 'zh-CN')).join('')
    expect(reply).not.toBe(messages('zh-CN')['assistant.redirect'])
    expect(reply).toContain('Urban Bloom')
  })
})

describe('中文客服关键词', () => {
  it('「这双鞋怎么清洗」→ 保养（POLICY_CARE），不掉进 supportFallback', async () => {
    const reply = (await say('support', '这双鞋怎么清洗', 'zh-CN')).join('')
    expect(reply).toContain('Care instructions')
    expect(reply).not.toBe(messages('zh-CN')['assistant.mock.supportFallback'])
  })

  it('退货与配送关键词各自命中对应店务事实', async () => {
    expect((await say('support', '可以退货吗', 'zh-CN')).join('')).toContain("can't be returned")
    expect((await say('support', '多久发货', 'zh-CN')).join('')).toContain('printed to order')
  })

  it('没有命中子主题时仍是温和引导（追问，不编造事实）', async () => {
    expect((await say('support', '你好', 'zh-CN')).join('')).toBe(
      messages('zh-CN')['assistant.mock.supportFallback'],
    )
  })

  it.each([
    ['zh-CN', '这双鞋怎么清洗？顺便说下今天天气'] as const,
    ['en', 'how do I wash these? also a bread recipe'] as const,
  ])('support 判定先于离题判定（%s）：客服问题里夹带离题词仍走店务事实', async (locale, text) => {
    // 顺序守卫（mock.ts 注释里写明的那条）：客服词（return / ship / 清洗）不该被当离题。
    // 两条输入都必含一个离题词，swap 两段判定即各自变红。
    expect((await say('support', text, locale)).join('')).toContain('Care instructions')
  })
})
