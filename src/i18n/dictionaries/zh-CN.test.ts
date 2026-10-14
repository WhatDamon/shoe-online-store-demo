import { describe, expect, it } from 'vitest'
import en from './en'
import zh from './zh-CN'

/**
 * zh-CN 词典的**内容**守卫。键集与形状的守卫在 `src/i18n/messages.test.ts`（遍历 `LOCALES`），
 * 这里只管两件类型系统看不见的事：这份词典是不是真的被翻译了，以及中文文案有没有偷偷改市场事实。
 */
describe('zh-CN 词典', () => {
  it('绝大多数条目真的被翻译了（防止整份复制英文）', () => {
    const en0 = en as Record<string, string>
    const keys = Object.keys(en0)
    const identical = keys.filter((key) => (zh as Record<string, string>)[key] === en0[key])
    // 尺码值、品牌名、专有名词、纯符号等少量条目允许与英文相同
    expect(identical.length / keys.length).toBeLessThan(0.15)
  })

  it('没有留下占位符或未译标记', () => {
    for (const [key, value] of Object.entries(zh)) {
      expect(value, key).not.toMatch(/TODO|FIXME|待翻译|未译|XXX/)
    }
  })

  it('词典不改写货币（语言与市场解耦：中文界面仍显示 $）', () => {
    // ADR 0008 决策 6：价格由 `SITE_MARKET` / `formatPrice` 决定，语言只决定文案。
    expect(Object.values(zh).join('\n')).not.toMatch(/人民币|CNY|￥/)
  })
})
