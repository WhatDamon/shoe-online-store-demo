import { Skeleton } from '@/components/ui/skeleton'

// 根 loading 骨架：应用于无自有 loading 的路段（/shop 有更贴近的嵌套骨架）。
export default function RootLoading() {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="border-b border-neutral-100 bg-canvas/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4">
          <Skeleton className="h-6 w-28" />
          <div className="hidden gap-6 sm:flex">
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-16" />
          </div>
          <Skeleton className="h-4 w-20" />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
        <Skeleton className="h-10 w-2/3 max-w-xl" />
        <Skeleton className="mt-4 h-6 w-1/2 max-w-md" />
        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="space-y-3">
              <Skeleton className="aspect-square w-full rounded-2xl" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
