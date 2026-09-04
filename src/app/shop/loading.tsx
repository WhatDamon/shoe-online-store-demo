import { Skeleton } from '@/components/ui/skeleton'

// /shop 流式加载骨架：外壳（真实固定头部 + Footer）由 shop/layout.tsx 的 SiteShell
// 提供，这里只占内容区，不再画假 header（会与真实头部重叠成双层）。
export default function ShopLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-10">
      <Skeleton className="h-8 w-24" />
      <Skeleton className="mt-3 h-4 w-64 max-w-full" />
      <div className="mt-8 flex flex-wrap gap-2">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-9 w-36" />
        <Skeleton className="h-9 w-36" />
        <Skeleton className="h-9 w-44" />
      </div>
      <Skeleton className="mt-8 h-4 w-20" />
      <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <li key={i}>
            <Skeleton className="aspect-square w-full rounded-2xl" />
          </li>
        ))}
      </ul>
    </div>
  )
}
