'use client'

import { createPersistentStore } from '@/lib/create-store'

/**
 * 朗读开关偏好。SSR 首帧常量 false → hydration 无 mismatch；
 * 写入发生在事件处理器里（非 effect），满足 react-hooks/set-state-in-effect。
 */
export const speak = createPersistentStore<boolean>({
  key: 'evoloop:speak',
  serverSnapshot: false,
  decode: (raw) => raw === '1',
  encode: (enabled) => (enabled ? '1' : '0'),
})
