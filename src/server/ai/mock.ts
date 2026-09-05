// 确定性 Mock 导购（P2：无 key 默认演示；与真实模型同构——同入参 system+messages，只回文本 delta）。
// 行为按 system 内短语分派（真实模型遵循同一 system 指令，Mock 模拟"照做的模型"）：
//   离题（用户词命中 OFF_TOPIC）→ 一段短 redirect（chat 测试断言其"仅一段"形状）；
//   find-shoes 短语 → 一句总结；outfit 短语 → 固定 3 条搭配建议；否则 → 引用 digest 商品的简短推荐。
// 文案一律引用注入 digest 里的真实商品名，绝不臆造价格/库存（规格 P1/P3）。
import type { AiContext, AiProvider } from './provider'

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

export const REDIRECT_TEXT =
  "I'm here to help with shoes and finding your next pair — want to tell me what you're looking for?"

const wordList = (s: string) => s.trim().split(/\s+/).filter(Boolean)

// 模拟流式：整段文案按 ~8 词切成一串 delta；离题 redirect 不切分（单 delta）。
function* toDeltas(text: string, step = 8): Generator<string> {
  const ws = wordList(text)
  for (let i = 0; i < ws.length; i += step) yield ws.slice(i, i + step).join(' ')
}

// 从 system 的 digest/商品上下文抽取可引用标题：匹配 "- Title ($…" 行。
const digestTitles = (system: string): string[] =>
  [...system.matchAll(/^- ([^($]+) \(\$/gm)].map((m) => m[1].trim())

// 从 outfit 上下文行 "Product: Title." 抽标题。
const productTitle = (system: string): string | null =>
  system.match(/Product:\s*([^.\n]+)/)?.[1]?.trim() ?? null

export class MockProvider implements AiProvider {
  async *stream(ctx: AiContext & { system: string; maxTokens: number }): AsyncGenerator<string> {
    const lastUser = [...ctx.messages].reverse().find((m) => m.role === 'user')?.content ?? ''
    if (OFF_TOPIC.some((k) => lastUser.toLowerCase().includes(k))) {
      yield REDIRECT_TEXT
      return
    }
    const titles = digestTitles(ctx.system)
    if (ctx.system.includes('summarizing the matching styles')) {
      const [a, b, c] = titles
      const summary =
        titles.length === 0
          ? 'No styles matched that search.'
          : titles.length === 1
            ? `Here is your match: the ${a}.`
            : titles.length === 2
              ? `Here are two matches: the ${a} and the ${b}.`
              : `Here are a few matches: the ${a}, the ${b}, and the ${c}.`
      yield* toDeltas(summary)
      return
    }
    if (ctx.system.includes('suggest three pairings')) {
      const title = productTitle(ctx.system) ?? 'these shoes'
      yield* toDeltas(
        `Style the ${title} with relaxed chinos and a plain tee for an easy everyday outfit. ` +
          `Layer a soft crew-neck sweater in a neutral tone over slim jeans on cooler days. ` +
          `Dress them up with tailored trousers and a tucked-in shirt for a smarter casual look.`,
      )
      return
    }
    const [a, b] = titles
    const recommendation =
      titles.length === 0
        ? 'I could not find a style matching that in the catalog just yet.'
        : titles.length === 1
          ? `I would start with the ${a} — it reads as a strong match for what you described.`
          : `I would start with the ${a} and the ${b} — both read as strong matches for what you described.`
    // 满 $50 赠一行（与 prompts 购物 mode 的 GIFT_OFFER_FACT 同源，只回一次）。
    const offer =
      ' And heads-up: orders over $50 include one free little buddy — a small accessory pressed from leftover upper offcuts — while supplies last.'
    yield* toDeltas(recommendation + (titles.length > 0 ? offer : ''))
  }
}
