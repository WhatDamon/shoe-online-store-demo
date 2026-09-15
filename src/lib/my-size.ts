// 「我的尺码」：以脚长 mm 为单一事实源（§6 mm 锚模型）。
//
// 只存脚长 mm：任何市场体系（US/EU/UK/JP/CN）都可由现有换算表派生，无需为每个市场存一份码。
// 范围外（< 227mm / > 313mm，即低于/高于本店 adult 档）不强制映射，由 UI 给出诚实提示，
// 而不是捏造一个不在表内的码。
import { createPersistentStore } from '@/lib/create-store'
import { sizeRows } from '@/server/catalog/size-fixture'
import type { CanonicalSize, SizeSystem } from '@/server/catalog/types'

const KEY = 'evoloop:foot-mm'
export const MY_SIZE_MIN_MM = 227 // 表内最小脚长（EU 35）
export const MY_SIZE_MAX_MM = 313 // 表内最大脚长（EU 48）
export const MY_SIZE_UI_MIN_MM = 200 // 滑杆下界（仍允许录入，但表外 → 无码提示）
export const MY_SIZE_UI_MAX_MM = 330 // 滑杆上界

/** 非数值输入统一归为「未设置」；数值取整到毫米。 */
const normalizeFootMm = (mm: number | null): number | null =>
  mm != null && Number.isFinite(mm) ? Math.round(mm) : null

export const mySize = createPersistentStore<number | null>({
  key: KEY,
  serverSnapshot: null,
  /** 损坏 / 非数值 / 表外取值统一回退 null（崩溃安全）。 */
  decode: (raw) => {
    try {
      const parsed: unknown = JSON.parse(raw ?? 'null')
      return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null
    } catch {
      return null
    }
  },
  // null 走「删除该键」而不是存字符串 'null'：语义是「没有设置尺码」。
  encode: (mm) => (mm == null ? null : JSON.stringify(mm)),
})

/** 组件内写入口：归一化后交给 store（持久化 + 广播 + 快照都由 store 负责）。 */
export const setMySize = (mm: number | null): void => mySize.set(normalizeFootMm(mm))

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
