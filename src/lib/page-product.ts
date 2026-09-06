// PDP 页面锚点（客户端 external store，provider 无关；与 my-size 同款无 React state）。
// 目的：FAB 打开时把「当前正在看的鞋」带给助手——此前 FAB 固定 open('shopping', null)，
// 商品上下文只存在于点了页内 Find my size 之后（设计要求的页面锚定一直未实现）。
// 轻引用 {handle,title} 即可：完整 ProductView 在 RSC 侧不可下传，服务端按 handle 回取全量事实。
export interface PageProductRef {
  handle: string
  title: string
}

let current: PageProductRef | null = null

/** PDP 挂载/换款时写入；卸载（离开 PDP）时由组件清回 null。换款后旧值被新值覆盖。 */
export function registerPageProduct(ref: PageProductRef | null): void {
  if (current?.handle === ref?.handle && current?.title === ref?.title) {
    return
  }
  current = ref
}

/** FAB 在点击时读取（事件时机，无需订阅/useSyncExternalStore）。 */
export function getPageProductSnapshot(): PageProductRef | null {
  return current
}
