'use client'

/**
 * 朗读开关偏好（localStorage-backed external store）。
 * 与 wishlist 同一模式：模块级快照 + useSyncExternalStore，
 * SSR 首帧常量 false → hydration 无 mismatch；写入经事件处理器（非 effect）。
 */

const KEY = 'evoloop:speak'
const FALSE_SNAPSHOT = false

const parse = (raw: string | null): boolean => {
  if (raw === '1') return true
  if (raw === '0') return false
  return false
}

export const loadSpeakPreference = (): boolean => {
  if (typeof window === 'undefined') return false
  try {
    return parse(window.localStorage.getItem(KEY))
  } catch {
    return false
  }
}

export const saveSpeakPreference = (enabled: boolean): void => {
  try {
    window.localStorage.setItem(KEY, enabled ? '1' : '0')
  } catch {
    // localStorage 不可用（隐私模式/存储满）时静默：偏好仅当次会话有效
  }
}

let snapshot = false
let loaded = false
const listeners = new Set<() => void>()

const ensureLoaded = (): boolean => {
  if (!loaded) {
    snapshot = loadSpeakPreference()
    loaded = true
  }
  return snapshot
}

export const subscribeSpeakPreference = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const getSpeakSnapshot = (): boolean => ensureLoaded()

export const getSpeakServerSnapshot = (): boolean => FALSE_SNAPSHOT

export const setSpeakPreference = (enabled: boolean): void => {
  ensureLoaded()
  if (snapshot === enabled) return
  snapshot = enabled
  saveSpeakPreference(enabled)
  for (const listener of listeners) listener()
}
