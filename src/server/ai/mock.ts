// 确定性 Mock 导购（P2：无 key 默认演示；与真实模型同构——同入参 system+messages，只回文本 delta）。
// 行为按 system 内短语分派（真实模型遵循同一 system 指令，Mock 模拟"照做的模型"）：
//   离题（用户词命中 OFF_TOPIC）→ 一段短 redirect（chat 测试断言其"仅一段"形状）；
//   find-shoes 短语 → 一句总结；outfit 短语 → 固定 3 条搭配建议；否则 → 引用 digest 商品的简短推荐。
// 分派读的短语是 `prompts.ts` 的 `MODE_SIGNALS`（与提示词同一个常量，不是两份拷贝；
// 守卫见 `copy-contract.test.ts`），因此改提示词不会静默改变这里的分派。
// 文案一律引用注入 digest 里的真实商品名，绝不臆造价格/库存（规格 P1/P3）。
import type { AiContext, AiProvider } from './provider'
import { DEFAULT_LOCALE } from '@/i18n/locales'
import { messages } from '@/i18n/messages'
import { GIFT_OFFER } from '@/lib/gift-offer'
import { POLICY_CARE, POLICY_PRODUCTION, POLICY_RETURNS } from '@/lib/store-policy'
import { MODE_SIGNALS } from './prompts'

// 消费端文案按**请求语言**取用（`ctx.locale`，由 `/api/ai/chat` 经 `isLocale` 校验后传下来），
// 每次 stream 现取一份词典，不再有模块级的默认语言快照。

const OFF_TOPIC = [
  'recipe',
  'bake',
  'cook',
  'dinner',
  'weather',
  'politics',
  'election',
  'stock market',
  'movie',
  'song',
  'playlist',
  'math',
  'homework',
  'essay',
  'translate',
  'python',
  'code',
  'poem',
  'football game',
]

/** 离题重定向文案：既有测试钉住的 `export const`（默认语言取值）。运行期按 `ctx.locale` 现取。 */
export const REDIRECT_TEXT = messages(DEFAULT_LOCALE)['assistant.redirect']

// 模拟流式：整段文案按 ~8 词切成一串 delta；离题 redirect 不切分（单 delta）。
function* toDeltas(text: string, step = 8): Generator<string> {
  const words = text.match(/\S+\s*/g) ?? []
  for (let offset = 0; offset < words.length; offset += step) {
    yield words.slice(offset, offset + step).join('')
  }
}

// 从 system 的 digest/商品上下文抽取可引用标题：匹配 "- Title (Type):" 行。
// 注意 digest 不含价格（AI 不带价），标题在括号前。
const digestTitles = (system: string): string[] =>
  [...system.matchAll(/^- ([^(]+) \(/gm)].map((m) => m[1].trim())

// 从 outfit 上下文行 "Product: Title." 抽标题。
const productTitle = (system: string): string | null =>
  system.match(/Product:\s*([^.\n]+)/)?.[1]?.trim() ?? null

export class MockProvider implements AiProvider {
  async *stream(ctx: AiContext & { system: string; maxTokens: number }): AsyncGenerator<string> {
    // 直接构造 ctx 的调用点（测试 / 探针）不传 locale → 默认语言，与既有断言逐字一致。
    const t = messages(ctx.locale ?? DEFAULT_LOCALE)
    const lastUser = [...ctx.messages].reverse().find((m) => m.role === 'user')?.content ?? ''
    // 店务客服（support）：确定性回复注入的真实店务事实。先于 OFF_TOPIC 判断——
    // 客服词（return/ship）不应被当离题 redirect；无命中子主题时给温和引导。
    if (ctx.system.includes(MODE_SIGNALS.support)) {
      const q = lastUser.toLowerCase()
      if (/care|wash|clean|maintain/.test(q)) {
        yield POLICY_CARE
      } else if (/return|refund|exchange|replace/.test(q)) {
        yield POLICY_RETURNS
      } else if (/shipping|ship|deliver|arrive|production|print/.test(q)) {
        yield* toDeltas(POLICY_PRODUCTION)
      } else {
        yield* toDeltas(t['assistant.mock.supportFallback'])
      }
      return
    }
    if (OFF_TOPIC.some((k) => lastUser.toLowerCase().includes(k))) {
      yield t['assistant.redirect']
      return
    }
    const titles = digestTitles(ctx.system)
    if (ctx.system.includes(MODE_SIGNALS.findShoes)) {
      const [a, b, c] = titles
      const summary =
        titles.length === 0
          ? t['assistant.mock.noStyles']
          : titles.length === 1
            ? `${t['assistant.mock.matchOneLead']} ${a}.`
            : titles.length === 2
              ? `${t['assistant.mock.matchTwoLead']} ${a} ${t['assistant.mock.matchTwoJoin']} ${b}.`
              : `${t['assistant.mock.matchManyLead']} ${a}${t['assistant.mock.matchManyJoin']} ${b}${t['assistant.mock.matchManyLastJoin']} ${c}.`
      yield* toDeltas(summary)
      return
    }
    if (ctx.system.includes(MODE_SIGNALS.outfit)) {
      const title = productTitle(ctx.system) ?? t['assistant.mock.theseShoes']
      yield* toDeltas(
        `${t['assistant.mock.outfitStyleLead']} ${title} ${t['assistant.mock.outfitStyleTail']} ` +
          `${t['assistant.mock.outfitLayer']} ${t['assistant.mock.outfitDress']}`,
      )
      return
    }
    const anchored = productTitle(ctx.system)
    const candidates = anchored ? [anchored] : titles
    const [a, b] = candidates
    const recommendation =
      candidates.length === 0
        ? t['assistant.mock.noCatalogMatch']
        : candidates.length === 1
          ? `${t['assistant.mock.startLead']} ${a} ${t['assistant.mock.startOneTail']}`
          : `${t['assistant.mock.startLead']} ${a} ${t['assistant.mock.startTwoJoin']} ${b} ${t['assistant.mock.startTwoTail']}`
    // 满 $50 赠一行：事实来自 lib/gift-offer 单源，与 prompts 的 GIFT_OFFER_FACT 同源，只回一次。
    const offer = ` ${t['assistant.mock.giftLead']}${GIFT_OFFER.thresholdUsd} ${t['assistant.mock.giftMid']} ${GIFT_OFFER.name} — ${GIFT_OFFER.composition} — ${GIFT_OFFER.availability}.`
    yield* toDeltas(recommendation + (candidates.length > 0 ? offer : ''))
  }
}
