import { describe, expect, it } from 'vitest'
import type { SizeSystem } from '@/domain/product'
import { availableSizesForSystem, convert, nearestCanonical, parseSizeHint } from '@/domain/size'
import { sizeRows } from '@/domain/size-fixture'

describe('convert', () => {
  it('converts EU 42 to US 8.5 (unisex basis)', () => expect(convert(42, 'US')).toBe(8.5))
  it('converts EU 42 to UK 7.5', () => expect(convert(42, 'UK')).toBe(7.5))
  it('round-trips EU via mm anchor', () => expect(convert(convert(42, 'US'), 'EU')).toBe(42))
})
describe('nearestCanonical', () => {
  it('picks closest in-stock EU size', () => {
    expect(nearestCanonical(41.5, [40, 42, 43])).toBe(42)
    expect(nearestCanonical(40, [40, 42])).toBe(40)
  })
  it('clamps when out of range', () => expect(nearestCanonical(50, [40, 42])).toBe(42))
})
describe('availableSizesForSystem', () => {
  it('lists every fixture row with a market label and its canonical EU', () => {
    const opts = availableSizesForSystem('US')
    expect(opts).toHaveLength(sizeRows.length)
    expect(opts[0]).toEqual({ label: 'US 4.5', canonical: 35 })
    expect(opts.find((o) => o.label === 'US 5')).toEqual({ label: 'US 5', canonical: 36 })
    expect(opts[opts.length - 1]).toEqual({ label: 'US 12.5', canonical: 48 })
    expect(opts.find((o) => o.label === 'US 9')).toEqual({
      label: 'US 9',
      canonical: 43,
    })
    opts.forEach((o, i) => expect(o.canonical).toBe(sizeRows[i].systems.EU))
  })
})
// 期望值从 fixture 反查（CONTEXT.md：不得手写 mm↔EU 对照，那只会验证测试自己编的数字）。
const fixtureEU = (system: SizeSystem, value: number): number | undefined =>
  sizeRows.find((r) => r.systems[system] === value)?.systems.EU

describe('parseSizeHint', () => {
  it('parses US label', () => expect(parseSizeHint('I usually wear US 9')).toBe(43)) // EU 43
  it('parses EU label', () => expect(parseSizeHint('size 42')).toBe(42))
  it('parses foot length cm', () => expect(parseSizeHint('my foot is 27 cm')).toBe(43))
  it('returns null when no size found', () => expect(parseSizeHint('comfortable')).toBeNull())

  it('解析中文脚长（厘米/公分）：仍走 cm → EU 换算', () => {
    expect(parseSizeHint('我脚长 25.5 厘米')).toBe(41) // euFromCm = floor((25.5+2)×1.5) = 41
    expect(parseSizeHint('脚长 27 公分')).toBe(43) // 与英文 '27 cm' 同值
  })

  it('解析中文只管数字的「脚长」（多数中文用户不带单位）', () => {
    expect(parseSizeHint('我脚长 25.5')).toBe(41)
  })

  it('中文「N 码」按 EU 解释（中文语境默认欧码）', () => {
    expect(parseSizeHint('我要 41 码')).toBe(41)
  })

  it('解析中文体系前缀：美码 / 欧码 / 日码', () => {
    expect(parseSizeHint('美码 8.5')).toBe(fixtureEU('US', 8.5))
    expect(parseSizeHint('欧码 41')).toBe(fixtureEU('EU', 41))
    expect(parseSizeHint('日码 25.5')).toBe(fixtureEU('JP', 25.5))
  })

  it('顺序：更明确的「美码」不被更宽松的「N 码」抢走', () => {
    // 同一句里同时出现两种写法时，体系前缀必须赢（它是有单位的那一个）。
    expect(parseSizeHint('我平时穿 42 码，这次想要美码 8.5')).toBe(fixtureEU('US', 8.5))
  })

  it('中文模式不误伤英文输入（结果与改动前一致）', () => {
    expect(parseSizeHint('I usually wear US 8.5')).toBe(fixtureEU('US', 8.5))
    expect(parseSizeHint('EU 41')).toBe(41)
    expect(parseSizeHint('my foot is 25 cm')).toBe(40) // euFromCm = floor((25+2)×1.5) = 40（改动前后同值）
  })

  it('不可解析的输入仍返回 null（含毫米口径：不按两位数字误读）', () => {
    expect(parseSizeHint('这双鞋好看吗')).toBeNull()
    expect(parseSizeHint('脚长 255')).toBeNull()
  })
})
