import Link from 'next/link'

export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-300 bg-white/60 px-6 py-16 text-center">
      <h2 className="text-lg font-medium text-neutral-900">No styles match</h2>
      <p className="mt-1 max-w-sm text-sm text-neutral-500">
        Try removing a filter or two — every style is printed to order, so your size is usually available.
      </p>
      <Link
        href="/shop"
        className="mt-4 text-sm font-medium text-neutral-900 underline underline-offset-4 transition-colors hover:text-neutral-600"
      >
        Shop all styles
      </Link>
    </div>
  )
}
