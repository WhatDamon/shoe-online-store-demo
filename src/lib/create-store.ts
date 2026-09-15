/**
 * 外部 store 的单点实现（provider-less）：任何 client 组件都可以 useSyncExternalStore
 * 直读，不需要 Context，也不需要 useState。
 *
 * 为什么不用 useState + effect：
 * - hydration 安全：服务端必须渲染一个**常量**快照，客户端 hydration 之后再读真实值，
 *   否则 server HTML 与首帧渲染不一致。
 * - lint 规则 `react-hooks/set-state-in-effect` 禁止在 effect 里同步 setState，
 *   所以「在 useEffect 里读 localStorage 再 setState」这条常见写法本来就不可用。
 *
 * 两个非显然约束，改这里之前先读：
 * 1. `getServerSnapshot` 必须返回**引用稳定**的值。每次返回一个新字面量会违反
 *    useSyncExternalStore 的缓存契约，并触发 dev 检查
 *    "The result of getServerSnapshot should be cached to avoid an infinite loop"
 *    （hydration 被中断后 React 走恢复路径会重读它）。所以 `serverSnapshot` 由调用方
 *    传入并原样返回：快照是对象/数组时必须传模块级常量。
 * 2. 读取一律**惰性**：首次 getSnapshot 才碰 localStorage。模块 import 时读取会在
 *    SSR 期抛错，也会让测试无法在 import 后再设置存储内容。
 *
 * 本模块不依赖 React，也不带 'use client' —— 服务端模块（如 ai/chat.ts）会经由
 * lib/my-size 间接引用它。
 */

export interface Store<T> {
  subscribe(listener: () => void): () => void
  getSnapshot(): T
  getServerSnapshot(): T
  set(next: T | ((prev: T) => T)): void
}

interface StoreSpec<T> {
  serverSnapshot: T
  initial: T
  /** 惰性求值：读取真实值。调用方保证不抛错。 */
  load: () => T
  /** 落盘：值变化时调用。调用方保证不抛错。 */
  persist: (value: T) => void
}

function build<T>(spec: StoreSpec<T>): Store<T> {
  let snapshot = spec.initial
  let loaded = false
  const listeners = new Set<() => void>()

  const ensureLoaded = (): T => {
    if (!loaded) {
      snapshot = spec.load()
      loaded = true
    }
    return snapshot
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot() {
      // 服务端没有 window：直接给常量快照，且不置 loaded，保证客户端首次读取仍会真正加载。
      return typeof window === 'undefined' ? spec.serverSnapshot : ensureLoaded()
    },
    getServerSnapshot: () => spec.serverSnapshot,
    set(next) {
      const value = typeof next === 'function' ? (next as (prev: T) => T)(ensureLoaded()) : next
      const changed = !Object.is(snapshot, value)
      snapshot = value
      // 落盘并标记已加载：刚写入的值就是当前值，之后不该再被存储里的旧值覆盖。
      loaded = true
      spec.persist(value)
      // 同值不广播：useSyncExternalStore 对同一快照本来也会 bail，省掉一轮无谓渲染。
      if (changed) for (const listener of listeners) listener()
    },
  }
}

export function createPersistentStore<T>(spec: {
  key: string
  serverSnapshot: T
  /** localStorage 原始值 → 值。损坏/缺失输入必须自己回退，不得抛错。 */
  decode: (raw: string | null) => T
  /** 值 → 待写入文本。返回 null 表示**删除该键**，用于「未设置」这类的缺省语义。 */
  encode: (value: T) => string | null
}): Store<T> {
  return build({
    serverSnapshot: spec.serverSnapshot,
    initial: spec.serverSnapshot,
    load: () => {
      try {
        return spec.decode(window.localStorage.getItem(spec.key))
      } catch {
        return spec.serverSnapshot
      }
    },
    persist: (value) => {
      try {
        const raw = spec.encode(value)
        if (raw === null) window.localStorage.removeItem(spec.key)
        else window.localStorage.setItem(spec.key, raw)
      } catch {
        // localStorage 不可用（隐私模式 / 配额满 / 被策略禁用）时静默：值仅当次会话有效。
      }
    },
  })
}

/** 无持久化的外部 store（纯内存，跨组件共享）。 */
export function createStore<T>(spec: { initial: T; serverSnapshot: T }): Store<T> {
  return build({
    serverSnapshot: spec.serverSnapshot,
    initial: spec.initial,
    load: () => spec.initial,
    persist: () => {},
  })
}
