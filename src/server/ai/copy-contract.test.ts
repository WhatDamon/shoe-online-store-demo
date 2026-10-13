// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { Messages } from '@/i18n/messages'
import { messages } from '@/i18n/messages'
import { DEFAULT_LOCALE } from '@/i18n/locales'
import { GUARDRAIL_MESSAGE } from '@/server/guardrails'
import { POLICY_CARE } from '@/lib/store-policy'
import { FALLBACK_ERROR_TEXT } from './chat'
import { NO_MATCH_TEXT } from './handlers'
import { MockProvider, REDIRECT_TEXT } from './mock'
import { MODE_SIGNALS, systemFor } from './prompts'

/**
 * 服务端产出的消费端文案有两条「只允许有一份事实」的契约，任一处各改一半都会**静默**出错：
 *
 * 1. **常量与词典同源**：`REDIRECT_TEXT` / `NO_MATCH_TEXT` / `FALLBACK_ERROR_TEXT` /
 *    `GUARDRAIL_MESSAGE` 都是 `export const`（形态由既有测试钉住，不能改成函数），值是词典
 *    取值。若有人把这些常量改回硬编码字面量，界面上会出现与词典不一致的第二份文案。
 * 2. **mock 分派信号与提示词同构**：`MockProvider` 靠 system 里的特征短语分派确定性行为
 *    （真实模型遵循同一 system 指令，两者同构）。信号与提示词一旦各改一处，mock 会掉进别的
 *    分支——不报错、不抛异常，只是答非所问，没有任何现有断言会红。信号因此是单源常量
 *    `MODE_SIGNALS`，`systemFor` 与 `MockProvider` 读的是同一个值，本文件再把
 *    「信号确实出现在对应 mode 的 system 输出里」钉住。
 *
 * 下面第三个 describe 是**整句**（字面量期望值，不走词典取值）的拼装守卫：mock 的可见回复
 * 由「词典片段 + 空格/连接词」拼成，拆开搬运之后最容易静默走样的是**片段之间的空格与连接**
 * （`and the` / `, and the` / 赠品行前后那个空格）。这些句式此前只有其中三条被断言（其余分支
 * 既无断言也无快照），故在这里把未被钉住的分支补齐。
 */
const t: Messages = messages(DEFAULT_LOCALE)

const reply = async (system: string, user: string): Promise<string> => {
  const chunks: string[] = []
  for await (const chunk of new MockProvider().stream({
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens: 500,
  }))
    chunks.push(chunk)
  return chunks.join('')
}

const DIGEST = '- Urban Bloom (Sneaker): everyday comfort\n- Daily Drift (Sneaker): light'

const SYSTEMS = {
  shopping: systemFor('shopping', { catalogDigest: DIGEST }),
  'find-shoes': systemFor('find-shoes', { catalogDigest: DIGEST }),
  outfit: systemFor('outfit', { product: 'Product: Urban Bloom.' }),
  'size-fit': systemFor('size-fit', { product: 'Product: Urban Bloom.' }),
  support: systemFor('support', {}),
} as const

describe('服务端产出的消费端文案逐字取自词典', () => {
  it.each([
    ['assistant.redirect', REDIRECT_TEXT],
    ['assistant.noMatch', NO_MATCH_TEXT],
    ['assistant.fallbackError', FALLBACK_ERROR_TEXT],
    ['guardrail.cooldown', GUARDRAIL_MESSAGE],
  ] as const)('%s 与常量取值一致', (key, value) => {
    expect(value).toBe(t[key])
  })
})

describe('mock 分派信号与提示词同构', () => {
  it('每个信号都出现在它所属 mode 的 system 里', () => {
    expect(SYSTEMS.support).toContain(MODE_SIGNALS.support)
    expect(SYSTEMS['find-shoes']).toContain(MODE_SIGNALS.findShoes)
    expect(SYSTEMS.outfit).toContain(MODE_SIGNALS.outfit)
  })

  it('信号不串台：其余 mode 的 system 里没有别的信号', () => {
    const signalFree = [SYSTEMS.shopping, SYSTEMS['size-fit']]
    for (const signal of Object.values(MODE_SIGNALS)) {
      expect(SYSTEMS.support.includes(signal)).toBe(signal === MODE_SIGNALS.support)
      expect(SYSTEMS['find-shoes'].includes(signal)).toBe(signal === MODE_SIGNALS.findShoes)
      expect(SYSTEMS.outfit.includes(signal)).toBe(signal === MODE_SIGNALS.outfit)
      for (const system of signalFree) expect(system).not.toContain(signal)
    }
  })

  it('把 systemFor 的输出喂给 MockProvider，三个信号各自走到自己的分支', async () => {
    // 各自的特征回复：support 回注入的护理事实、find-shoes 回匹配数总结、outfit 回三条搭配建议。
    // 信号若从提示词里消失（或改了措辞而没改 mock），这里会落到目录推荐分支而变红。
    expect(await reply(SYSTEMS.support, 'how do I care for my shoes')).toBe(POLICY_CARE)
    expect(await reply(SYSTEMS['find-shoes'], 'sneakers')).toBe(
      `${t['assistant.mock.matchTwoLead']} Urban Bloom ${t['assistant.mock.matchTwoJoin']} Daily Drift.`,
    )
    expect(await reply(SYSTEMS.outfit, 'date night')).toBe(
      `${t['assistant.mock.outfitStyleLead']} Urban Bloom ${t['assistant.mock.outfitStyleTail']} ` +
        `${t['assistant.mock.outfitLayer']} ${t['assistant.mock.outfitDress']}`,
    )
  })
})

describe('mock 的整句拼装（期望值是字面量，不走词典取值）', () => {
  const digest = (...titles: string[]) =>
    titles.map((title) => `- ${title} (Sneaker): a description`).join('\n')

  it('shopping 锚定单商品：推荐句 + 满额赠品行', async () => {
    expect(
      await reply(
        systemFor('shopping', { product: 'Product: Urban Bloom. Code: DC-1001.' }),
        'waterproof?',
      ),
    ).toBe(
      'I would start with the Urban Bloom — it reads as a strong match for what you described. ' +
        'And heads-up: orders over $50 include one free little buddy — a small accessory pressed ' +
        'from leftover upper offcuts — while supplies last.',
    )
  })

  it('shopping 无候选：无匹配句（且不附赠品行）', async () => {
    expect(await reply(systemFor('shopping', { catalogDigest: '' }), 'everyday shoes')).toBe(
      'I could not find a style matching that in the catalog just yet.',
    )
  })

  it('find-shoes：零 / 一 / 三匹配的三种句式（两匹配已在上面的契约里钉住）', async () => {
    expect(await reply(systemFor('find-shoes', { catalogDigest: '' }), 'sneakers')).toBe(
      'No styles matched that search.',
    )
    expect(
      await reply(systemFor('find-shoes', { catalogDigest: digest('Urban Bloom') }), 'sneakers'),
    ).toBe('Here is your match: the Urban Bloom.')
    expect(
      await reply(
        systemFor('find-shoes', {
          catalogDigest: digest('Urban Bloom', 'Daily Drift', 'Easy Coast'),
        }),
        'sneakers',
      ),
    ).toBe('Here are a few matches: the Urban Bloom, the Daily Drift, and the Easy Coast.')
  })

  it('support 无子主题命中：温和兜底句；outfit 锚定商品：三条搭配建议', async () => {
    expect(await reply(systemFor('support', {}), 'hello there')).toBe(
      'Happy to help with shipping, returns and care — what would you like to know?',
    )
    expect(
      await reply(systemFor('outfit', { product: 'Product: Urban Bloom.' }), 'date night'),
    ).toBe(
      'Style the Urban Bloom with relaxed chinos and a plain tee for an easy everyday outfit. ' +
        'Layer a soft crew-neck sweater in a neutral tone over slim jeans on cooler days. ' +
        'Dress them up with tailored trousers and a tucked-in shirt for a smarter casual look.',
    )
  })
})
