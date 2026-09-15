'use client'

import { useEffect } from 'react'
import {
  getPageProductSnapshot,
  registerPageProduct,
  type PageProductRef,
} from '@/lib/page-product'

// PDP 页面锚点：在 product/[handle] 挂载（渲染 null，SSG 安全），把当前鞋的轻引用写入页面锚点
// store；离开 PDP 时归 null（/shop、/blog 等 FAB 维持通用开场），路由 A→B 时自动跟随当前 PDP。
// effect 写外部 store 而非 React setState，符合 react-hooks/set-state-in-effect 规则。
export function AssistantPageAnchor({ handle, title }: PageProductRef) {
  useEffect(() => {
    const ref = { handle, title }
    registerPageProduct(ref)
    return () => {
      const cur = getPageProductSnapshot()
      // 只清自己：组件更新按序执行 cleanup→setup，新 setup 已写入新值，故仅当锚点仍指向本鞋才清。
      if (cur?.handle === ref.handle && cur?.title === ref.title) {
        registerPageProduct(null)
      }
    }
  }, [handle, title])
  return null
}
