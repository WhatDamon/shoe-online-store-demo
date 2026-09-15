import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPersistentStore, createStore } from './create-store'

const KEY = 'test:store'

/** 数字数组 + 「空数组 = 删除键」语义，覆盖 encode 返回 null 的分支。 */
const makeStore = () =>
  createPersistentStore<number[]>({
    key: KEY,
    serverSnapshot: [],
    decode: (raw) => {
      if (raw == null) return []
      try {
        const parsed: unknown = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === 'number') : []
      } catch {
        return []
      }
    },
    encode: (v) => (v.length ? JSON.stringify(v) : null),
  })

beforeEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('createPersistentStore', () => {
  it('惰性读取：创建时不碰 localStorage，首次 getSnapshot 才读', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem')
    const store = makeStore()
    expect(getItem).not.toHaveBeenCalled()
    store.getSnapshot()
    expect(getItem).toHaveBeenCalledWith(KEY)
  })

  it('读回已存值', () => {
    window.localStorage.setItem(KEY, '[1,2,3]')
    expect(makeStore().getSnapshot()).toEqual([1, 2, 3])
  })

  it('损坏内容回退到 serverSnapshot，不抛错', () => {
    window.localStorage.setItem(KEY, '{not json')
    expect(makeStore().getSnapshot()).toEqual([])
  })

  it('写入即持久化，之后的新 store 实例读得到', () => {
    const store = makeStore()
    store.set([7, 8])
    expect(window.localStorage.getItem(KEY)).toBe('[7,8]')
    expect(makeStore().getSnapshot()).toEqual([7, 8])
  })

  it('encode 返回 null 时删除键（缺省语义）', () => {
    const store = makeStore()
    store.set([7])
    expect(window.localStorage.getItem(KEY)).toBe('[7]')
    store.set([])
    expect(window.localStorage.getItem(KEY)).toBeNull()
    expect(store.getSnapshot()).toEqual([])
  })

  it('值变化才广播；同值不广播', () => {
    const store = makeStore()
    const listener = vi.fn()
    const unsub = store.subscribe(listener)
    store.set([1])
    expect(listener).toHaveBeenCalledTimes(1)
    store.set([1, 2])
    expect(listener).toHaveBeenCalledTimes(2)
    unsub()
    store.set([3])
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('支持函数式更新', () => {
    const store = makeStore()
    store.set([1])
    store.set((prev) => [...prev, 2])
    expect(store.getSnapshot()).toEqual([1, 2])
  })

  it('set 之后不会被存储里的旧值覆盖（写入即最新）', () => {
    window.localStorage.setItem(KEY, '[9]')
    const store = makeStore()
    store.set([1])
    expect(store.getSnapshot()).toEqual([1])
    expect(store.getSnapshot()).toEqual([1])
  })

  it('getServerSnapshot 引用稳定（React 19 缓存契约）', () => {
    const store = makeStore()
    expect(store.getServerSnapshot()).toBe(store.getServerSnapshot())
  })

  it('无 window（SSR）时 getSnapshot 返回 serverSnapshot', () => {
    const store = makeStore()
    vi.stubGlobal('window', undefined)
    try {
      expect(store.getSnapshot()).toEqual([])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('localStorage 抛错时静默（隐私模式）', () => {
    const store = makeStore()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => store.set([1])).not.toThrow()
    expect(store.getSnapshot()).toEqual([1])
  })

  it('localStorage 读取抛错时回退到 serverSnapshot', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(makeStore().getSnapshot()).toEqual([])
  })
})

describe('createStore（无持久化）', () => {
  it('初值为 initial，set 后广播，且不写 localStorage', () => {
    const store = createStore<{ handle: string } | null>({ initial: null, serverSnapshot: null })
    const listener = vi.fn()
    store.subscribe(listener)
    expect(store.getSnapshot()).toBeNull()
    store.set({ handle: 'dc-1001' })
    expect(store.getSnapshot()).toEqual({ handle: 'dc-1001' })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(window.localStorage.length).toBe(0)
  })

  it('getServerSnapshot 返回传入的稳定常量', () => {
    const empty: string[] = []
    const store = createStore<string[]>({ initial: empty, serverSnapshot: empty })
    expect(store.getServerSnapshot()).toBe(empty)
  })
})
