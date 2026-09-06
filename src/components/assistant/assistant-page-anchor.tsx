'use client'

import { useEffect } from 'react'
import {
  getPageProductSnapshot,
  registerPageProduct,
  type PageProductRef,
} from '@/lib/page-product'

// PDP 页面锚点：在 product/[handle] 挂载（渲染 null，SSG 安全）。挂载/换款时把当前鞋
// 轻引用写入页面锚点 store；卸载时若仍指向自己则清空。路由 A→B 时锚点自动跟随当前 PDP
// （deps 变更先跑旧 cleanup 再跑新 setup：旧值清空后新值立即写入），离开 PDP 则归 null
// （/shop、/blog 等 FAB 维持通用开场）。effect 写外部 store 非 React setState，
// 符合 react-hooks/set-state-in-effect 规则。
export function AssistantPageAnchor({ handle, title }: PageProductRef) {
  useEffect(() => {
    const ref = { handle, title }
    registerPageProduct(ref)
    return () => {
      const cur = getPageProductSnapshot()
      // 只清自己：不误清并发注册的后到锚点（连续换款时旧实例的 cleanup 先于新注册？No——
      // 组件更新按序执行 cleanup→setup，新 setup 已写入新值；仅当仍指向本鞋才归 null）。
      if (cur?.handle === ref.handle && cur?.title === ref.title) {
        registerPageProduct(null)
      }
    }
  }, [handle, title])
  return null
}
