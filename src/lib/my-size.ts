// 「我的尺码」存储层：持久化脚长 mm 并接线 store。尺码换算数学在 @/domain/size。
//
// 只存脚长 mm：任何市场体系（US/EU/UK/JP/CN）都可由换算表派生，无需为每个市场存一份码。
import { createPersistentStore } from '@/lib/create-store'

const KEY = 'evoloop:foot-mm'
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
