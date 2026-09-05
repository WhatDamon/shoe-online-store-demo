import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearMySize,
  footMmRow,
  footMmToEU,
  footMmToSystem,
  getMySizeServerSnapshot,
  getMySizeSnapshot,
  loadMySize,
  MY_SIZE_MAX_MM,
  MY_SIZE_MIN_MM,
  saveMySize,
  setMySize,
  subscribeMySize,
} from '@/lib/my-size'

const KEY = 'evoloop:foot-mm'

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('my-size storage (localStorage 安全读写)', () => {
  it('loads null when nothing stored (also SSR path)', () => {
    expect(typeof window).toBe('object')
    expect(loadMySize()).toBeNull()
  })

  it('round-trips a saved foot length in mm', () => {
    saveMySize(265)
    expect(loadMySize()).toBe(265)
  })

  it('clear removes the key', () => {
    saveMySize(265)
    clearMySize()
    expect(loadMySize()).toBeNull()
  })

  it('corrupt JSON falls back to null', () => {
    window.localStorage.setItem(KEY, '{not json')
    expect(loadMySize()).toBeNull()
  })

  it('non-number / non-finite stored values fall back to null', () => {
    window.localStorage.setItem(KEY, '"265"')
    expect(loadMySize()).toBeNull()
    window.localStorage.setItem(KEY, 'null')
    expect(loadMySize()).toBeNull()
  })

  it('saveMySize ignores non-finite input', () => {
    saveMySize(Number.NaN)
    expect(loadMySize()).toBeNull()
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
  it('server snapshot is a stable null constant', () => {
    expect(getMySizeServerSnapshot()).toBeNull()
    expect(getMySizeServerSnapshot()).toBe(getMySizeServerSnapshot())
  })

  it('setMySize updates snapshot and notifies subscribers', () => {
    const listener = vi.fn()
    const unsub = subscribeMySize(listener)
    expect(getMySizeSnapshot()).toBeNull()
    setMySize(280)
    expect(getMySizeSnapshot()).toBe(280)
    expect(listener).toHaveBeenCalledTimes(1)
    setMySize(null)
    expect(getMySizeSnapshot()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(2)
    unsub()
    setMySize(266)
    expect(listener).toHaveBeenCalledTimes(2) // 已退订不再广播
    expect(getMySizeSnapshot()).toBe(266)
    setMySize(null)
  })

  it('rounds fractional mm input', () => {
    setMySize(265.6)
    expect(getMySizeSnapshot()).toBe(266)
    setMySize(null)
  })
})
