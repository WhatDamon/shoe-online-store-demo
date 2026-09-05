// “我的尺码”外部 store：以脚长 mm 为单一事实源（§6 mm 锚模型），wishlist 同款
// 本地存储模式（try/catch 安全读 + 模块级缓存 + subscribe + SSR 常量快照）。
//
// 只存脚长 mm：任何市场体系（US/EU/UK/JP/CN）都可由现有换算表派生，无需为每个
// 市场存一份码。范围外（< 227mm / > 313mm，即低于/高于本店 adult 档）不强制映射，
// 由 UI 给出诚实提示，而不是捏造一个不在表内的码。
import { sizeRows } from '@/server/catalog/size-fixture'
import type { CanonicalSize, SizeSystem } from '@/server/catalog/types'

const KEY = 'evoloop:foot-mm'
export const MY_SIZE_MIN_MM = 227 // 表内最小脚长（EU 35）
export const MY_SIZE_MAX_MM = 313 // 表内最大脚长（EU 48）
export const MY_SIZE_UI_MIN_MM = 200 // 滑杆下界（仍允许录入，但表外 → 无码提示）
export const MY_SIZE_UI_MAX_MM = 330 // 滑杆上界

/** 损坏 / 非数值 / 表外取值统一回退 null（崩溃安全）。 */
export const loadMySize = (): number | null => {
  if (typeof window === 'undefined') return null
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? 'null')
    if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

export const saveMySize = (mm: number) => {
  if (!Number.isFinite(mm)) return
  window.localStorage.setItem(KEY, JSON.stringify(Math.round(mm)))
}

export const clearMySize = () => {
  window.localStorage.removeItem(KEY)
}

/** 最近的一行：|footMm - row.mm| 最小；表外（过小/过大）返回 null。 */
export const footMmRow = (mm: number): (typeof sizeRows)[number] | null => {
  if (!Number.isFinite(mm) || mm < MY_SIZE_MIN_MM || mm > MY_SIZE_MAX_MM) return null
  let best: (typeof sizeRows)[number] = sizeRows[0]
  let bestDist = Infinity
  for (const row of sizeRows) {
    const dist = Math.abs(row.mm - mm)
    if (dist < bestDist) {
      best = row
      bestDist = dist
    }
  }
  return best
}

/** 脚长 mm → canonical EU（表内就近取档；表外 null）。 */
export const footMmToEU = (mm: number): CanonicalSize | null => footMmRow(mm)?.systems.EU ?? null

/** 脚长 mm → 指定体系的数值（表内就近换算；表外 null）。 */
export const footMmToSystem = (mm: number, system: SizeSystem): number | null => {
  const row = footMmRow(mm)
  if (!row) return null
  return row.systems[system as 'US' | 'EU' | 'UK' | 'JP' | 'CN'] as number
}

// ---- 外部 store（provider-less：任何 client 组件可 useSyncExternalStore 直读）----
let snapshot: number | null = null
let loaded = false
const listeners = new Set<() => void>()
const EMPTY: number | null = null // SSR 首帧常量（React 19 缓存契约）

const ensureLoaded = (): number | null => {
  if (!loaded) {
    snapshot = loadMySize()
    loaded = true
  }
  return snapshot
}

export const subscribeMySize = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const getMySizeSnapshot = (): number | null => ensureLoaded()

export const getMySizeServerSnapshot = (): number | null => EMPTY

/** 组件内写入口：更新模块级缓存 + 持久化 + 广播。 */
export const setMySize = (mm: number | null) => {
  const next = mm != null && Number.isFinite(mm) ? Math.round(mm) : null
  if (next == null) clearMySize()
  else saveMySize(next)
  snapshot = next
  loaded = true
  for (const listener of listeners) listener()
}
