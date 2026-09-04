'use client'

import { useRef, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { parseShopParams, serializeShopParams } from '@/lib/shop-search-params'
import type { ShopFilter } from '@/lib/shop-search-params'
import type { CanonicalSize } from '@/server/catalog/types'

export interface FilterOption {
  value: string
  label: string
}

const SORT_OPTIONS: { value: ShopFilter['sort']; label: string }[] = [
  { value: 'featured', label: 'Featured' },
  { value: 'price-asc', label: 'Price: Low to High' },
  { value: 'price-desc', label: 'Price: High to Low' },
  { value: 'newest', label: 'Newest' },
]

// 价格分档 → min/max 区间；边界 100/150 与 seed 价格带无重合，整数即可无歧义表达。
function applyPriceRange(value: string): Partial<ShopFilter> {
  if (value === 'u100') return { minPrice: undefined, maxPrice: 100 }
  if (value === '100-150') return { minPrice: 100, maxPrice: 150 }
  if (value === 'o150') return { minPrice: 150, maxPrice: undefined }
  return { minPrice: undefined, maxPrice: undefined }
}

function currentPriceBand(f: ShopFilter): string {
  const { minPrice, maxPrice } = f
  if (minPrice == null && maxPrice == null) return ''
  if (minPrice == null && maxPrice === 100) return 'u100'
  if (minPrice === 100 && maxPrice === 150) return '100-150'
  if (minPrice === 150 && maxPrice == null) return 'o150'
  return ''
}

function hasActiveFilters(f: ShopFilter): boolean {
  return Boolean(
    f.collection ||
      (f.sizeLabels?.length ?? 0) > 0 ||
      currentPriceBand(f) !== '' ||
      (f.sort != null && f.sort !== 'featured') ||
      f.q,
  )
}

const selectClass =
  'h-9 rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-900 focus:border-neutral-400 focus:outline-none'

export function ProductFilterBar({
  initial,
  collectionOptions,
  sizeOptions,
}: {
  initial: ShopFilter
  collectionOptions: FilterOption[]
  sizeOptions: { label: string; canonical: CanonicalSize }[]
}) {
  const router = useRouter()
  const selectedSizes = new Set(initial.sizeLabels ?? [])
  const showClear = hasActiveFilters(initial)

  // 受控 replace 模式下，服务端尚未提交新一轮筛选前 `initial` 是过期的：若每次变更
  // 都以 `initial` 为基底重新合并，一次 RSC 往返内连续变更（如快速连勾两个尺码）会
  // 丢弃前一次的参数。因此以 baseRef 累积「最后一次已发出」的筛选状态作为组合基底，
  // 仅当服务端提交了本地尚未见过的状态（初次进入/浏览器 Back/外部改 URL）时回退到
  // 已提交的 initial——连续变更在本地合成，导航最终收敛。
  const committedQs = serializeShopParams(initial)
  const baseRef = useRef(committedQs)
  const lastCommittedRef = useRef(committedQs)

  /** 当前组合基底：最近一次发出的筛选；若 `initial` 已变为未见过的新状态则回退到它。 */
  const effectiveBase = (): ShopFilter => {
    if (committedQs !== lastCommittedRef.current) {
      lastCommittedRef.current = committedQs
      baseRef.current = committedQs
    }
    return parseShopParams(new URLSearchParams(baseRef.current))
  }

  const update = (patch: Partial<ShopFilter>) => {
    const qs = serializeShopParams({ ...effectiveBase(), ...patch })
    baseRef.current = qs
    router.replace(qs ? `/shop?${qs}` : '/shop')
  }

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const raw = new FormData(event.currentTarget).get('q')
    const q = typeof raw === 'string' ? raw.trim() : ''
    update({ q: q || undefined })
  }

  const toggleSize = (label: string, checked: boolean) => {
    const next = new Set(effectiveBase().sizeLabels ?? [])
    if (checked) next.add(label)
    else next.delete(label)
    update({ sizeLabels: next.size ? [...next] : undefined })
  }

  const clearAll = () =>
    update({
      collection: undefined,
      sizeLabels: undefined,
      minPrice: undefined,
      maxPrice: undefined,
      sort: 'featured',
      q: undefined,
    })

  return (
    <section aria-label="Shop filters" className="border-y border-neutral-200 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <form
          role="search"
          onSubmit={handleSearch}
          className="flex min-w-0 flex-1 basis-64 items-center gap-2"
        >
          <input
            name="q"
            type="search"
            aria-label="Search"
            key={initial.q ?? ''}
            defaultValue={initial.q ?? ''}
            placeholder="Search styles"
            className="h-9 w-full min-w-0 flex-1 rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none"
          />
          <button
            type="submit"
            className="h-9 shrink-0 rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-700 transition-colors hover:bg-neutral-50"
          >
            Search
          </button>
        </form>
        <select
          aria-label="Collection"
          value={initial.collection ?? ''}
          onChange={e => update({ collection: e.target.value || undefined })}
          className={selectClass}
        >
          <option value="">All styles</option>
          {collectionOptions.map(o => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Price"
          value={currentPriceBand(initial)}
          onChange={e => update(applyPriceRange(e.target.value))}
          className={selectClass}
        >
          <option value="">Any price</option>
          <option value="u100">Under $100</option>
          <option value="100-150">$100 – $150</option>
          <option value="o150">Over $150</option>
        </select>
        <select
          aria-label="Sort"
          value={initial.sort ?? 'featured'}
          onChange={e => update({ sort: e.target.value as ShopFilter['sort'] })}
          className={selectClass}
        >
          {SORT_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="mt-3">
        <legend className="sr-only">Filter by size</legend>
        <div className="flex flex-wrap gap-1.5">
          {sizeOptions.map(({ label }) => {
            const checked = selectedSizes.has(label)
            return (
              <label key={label} className="cursor-pointer">
                <input
                  type="checkbox"
                  name="size"
                  value={label}
                  checked={checked}
                  onChange={e => toggleSize(label, e.target.checked)}
                  className="peer sr-only"
                />
                <span className="inline-flex items-center rounded-full border border-neutral-200 px-3 py-1 text-xs text-neutral-700 transition-colors peer-checked:border-neutral-900 peer-checked:bg-neutral-900 peer-checked:text-white">
                  {label}
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      {showClear ? (
        <button
          type="button"
          onClick={clearAll}
          className="mt-3 text-xs font-medium text-neutral-500 underline-offset-2 hover:text-neutral-900 hover:underline"
        >
          Clear all
        </button>
      ) : null}
    </section>
  )
}
