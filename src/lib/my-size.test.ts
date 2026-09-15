import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  footMmRow,
  footMmToEU,
  footMmToSystem,
  MY_SIZE_MAX_MM,
  MY_SIZE_MIN_MM,
} from '@/lib/my-size'

const KEY = 'evoloop:foot-mm'

/**
 * store 是模块级缓存：首次读取后就不再回头看 localStorage。所以每个持久化用例都要
 * resetModules 后重新 import，才能观察到「存储里已经有值」的初始状态。
 */
async function freshMySize() {
  vi.resetModules()
  return await import('@/lib/my-size')
}

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('my-size 持久化（createPersistentStore，崩溃安全）', () => {
  it('未设置时读作 null', async () => {
    const { mySize } = await freshMySize()
    expect(typeof window).toBe('object')
    expect(mySize.getSnapshot()).toBeNull()
  })

  it('写入后读回，并按数值 JSON 落盘', async () => {
    const { mySize, setMySize } = await freshMySize()
    setMySize(265)
    expect(mySize.getSnapshot()).toBe(265)
    expect(window.localStorage.getItem(KEY)).toBe('265')
  })

  it('setMySize(null) 删除键，而不是写入字符串 "null"', async () => {
    const { mySize, setMySize } = await freshMySize()
    setMySize(265)
    setMySize(null)
    expect(window.localStorage.getItem(KEY)).toBeNull()
    expect(mySize.getSnapshot()).toBeNull()
  })

  it('损坏 JSON 回退 null，不抛错', async () => {
    window.localStorage.setItem(KEY, '{not json')
    const { mySize } = await freshMySize()
    expect(mySize.getSnapshot()).toBeNull()
  })

  it('非数值 / null / 对象 / 数组 落盘值一律回退 null', async () => {
    for (const raw of ['"265"', 'null', '{}', '[265]']) {
      window.localStorage.setItem(KEY, raw)
      const { mySize } = await freshMySize()
      expect(mySize.getSnapshot()).toBeNull()
    }
  })

  it('非有限数值按「未设置」处理：清空而不是留下旧值', async () => {
    const { mySize, setMySize } = await freshMySize()
    setMySize(265)
    setMySize(Number.NaN)
    expect(mySize.getSnapshot()).toBeNull()
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })
})

describe('footMm → row mapping (就近映射)', () => {
  it('exact anchor mm resolves to its row (280 → EU 43)', () => {
    const row = footMmRow(280)
    expect(row?.systems.EU).toBe(43)
    expect(footMmToEU(280)).toBe(43)
    expect(footMmToSystem(280, 'US')).toBe(9)
    expect(footMmToSystem(280, 'UK')).toBe(8)
    expect(footMmToSystem(280, 'JP')).toBe(27)
    expect(footMmToSystem(280, 'CN')).toBe(43)
  })

  it('between anchors picks the nearest row', () => {
    expect(footMmToEU(275)).toBe(42) // 275-273=2 < 280-275=5 → EU 42
    expect(footMmToEU(278)).toBe(43) // 280-278=2 < 278-273=5 → EU 43
    expect(footMmToEU(276.5)).toBe(42) // 等距（3.5/3.5）取表中先见行 273 → EU 42
  })

  it('out-of-table values return null (honest no-size, never fabricated)', () => {
    expect(footMmToEU(MY_SIZE_MIN_MM - 1)).toBeNull()
    expect(footMmToEU(MY_SIZE_MAX_MM + 1)).toBeNull()
    expect(footMmToEU(Number.NaN)).toBeNull()
    expect(footMmRow(100)).toBeNull()
    expect(footMmToSystem(400, 'US')).toBeNull()
  })

  it('boundary anchors map to the smallest / largest EU rows', () => {
    expect(footMmToEU(MY_SIZE_MIN_MM)).toBe(35)
    expect(footMmToEU(MY_SIZE_MAX_MM)).toBe(48)
  })
})

describe('external store snapshot/subscribe', () => {
  it('server snapshot 是稳定的 null 常量', async () => {
    const { mySize } = await freshMySize()
    expect(mySize.getServerSnapshot()).toBeNull()
    expect(mySize.getServerSnapshot()).toBe(mySize.getServerSnapshot())
  })

  it('setMySize 更新快照并广播订阅者；退订后不再广播', async () => {
    const { mySize, setMySize } = await freshMySize()
    const listener = vi.fn()
    const unsub = mySize.subscribe(listener)
    expect(mySize.getSnapshot()).toBeNull()
    setMySize(280)
    expect(mySize.getSnapshot()).toBe(280)
    expect(listener).toHaveBeenCalledTimes(1)
    setMySize(null)
    expect(mySize.getSnapshot()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(2)
    unsub()
    setMySize(266)
    expect(listener).toHaveBeenCalledTimes(2) // 已退订不再广播
    expect(mySize.getSnapshot()).toBe(266)
  })

  it('小数值输入取整到毫米', async () => {
    const { mySize, setMySize } = await freshMySize()
    setMySize(265.6)
    expect(mySize.getSnapshot()).toBe(266)
  })
})
