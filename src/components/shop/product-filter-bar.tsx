'use client'

import { useEffect, useRef, useSyncExternalStore, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { parseShopParams, serializeShopParams } from '@/lib/shop-search-params'
import type { ShopFilter } from '@/lib/shop-search-params'
import type { CanonicalSize } from '@/domain/product'
import { footMmToEU } from '@/domain/size'
import { mySize } from '@/lib/my-size'
import { useLocale, useMessages } from '@/components/i18n/locale-provider'
import { localePath } from '@/i18n/locales'
import type { Messages } from '@/i18n/messages'

export interface FilterOption {
  value: string
  label: string
}

// 排序选项存**键**而非文案（与 `src/lib/site.ts` 的 nav 同款）：`value` 是 URL 参数契约，
// 文案在词典里，渲染处解引用。
const SORT_OPTIONS = [
  { value: 'featured', labelKey: 'shop.filter.sortFeatured' },
  { value: 'price-asc', labelKey: 'shop.filter.sortPriceAsc' },
  { value: 'price-desc', labelKey: 'shop.filter.sortPriceDesc' },
  { value: 'newest', labelKey: 'shop.filter.sortNewest' },
] as const satisfies readonly { value: ShopFilter['sort']; labelKey: keyof Messages }[]

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
  'h-9 rounded-lg border border-neutral-200 bg-surface px-3 text-sm text-neutral-900 focus:border-neutral-400 focus:outline-none'

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
  const t = useMessages()
  // 筛选改的是「当前语言下的 /shop」：裸 `/shop` 会先被 proxy 308 到 /en/shop，
  // 每次改筛选多一次往返。
  const locale = useLocale()
  const selectedSizes = new Set(initial.sizeLabels ?? [])
  const showClear = hasActiveFilters(initial)
  // 「我的尺码」命中：保存后所在码 chip 显示圆点 + aria（有码款即使未筛选也可辨识）。
  const myCanonical = useSyncExternalStore(
    mySize.subscribe,
    mySize.getSnapshot,
    mySize.getServerSnapshot,
  )
  const myEU = myCanonical != null ? footMmToEU(myCanonical) : null

  // 受控 replace 下 `initial` 在提交前是过期快照：以 baseRef 累积「最后一次已发出」的查询串
  // 作组合基底，使一次 RSC 往返内的连续变更（快速连勾两个尺码）在本地合成而不互相丢弃。
  // 提交状态 ≠ 在途意图时（Back / 外部改 URL）基底回退到已提交值，避免复活已放弃的参数。
  const committedQs = serializeShopParams(initial)
  const baseRef = useRef(committedQs)

  useEffect(() => {
    if (committedQs !== baseRef.current) {
      baseRef.current = committedQs
    }
  })

  /** 当前组合基底：最近一次发出的筛选；若已提交状态取代了在途意图则由上面的效果回退。 */
  const effectiveBase = (): ShopFilter => parseShopParams(new URLSearchParams(baseRef.current))

  const update = (patch: Partial<ShopFilter>) => {
    const qs = serializeShopParams({ ...effectiveBase(), ...patch })
    baseRef.current = qs
    router.replace(localePath(locale, qs ? `/shop?${qs}` : '/shop'))
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
    <section aria-label={t['shop.filter.label']} className="border-y border-neutral-200 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <form
          role="search"
          aria-label={t['shop.filter.searchLabel']}
          onSubmit={handleSearch}
          className="flex min-w-0 flex-1 basis-64 items-center gap-2"
        >
          <input
            name="q"
            type="search"
            aria-label={t['shop.filter.search']}
            key={initial.q ?? ''}
            defaultValue={initial.q ?? ''}
            placeholder={t['shop.filter.searchPlaceholder']}
            className="h-9 w-full min-w-0 flex-1 rounded-lg border border-neutral-200 bg-surface px-3 text-sm text-neutral-900 placeholder:text-neutral-500 focus:border-neutral-400 focus:outline-none"
          />
          <button
            type="submit"
            className="h-9 shrink-0 rounded-lg border border-neutral-200 bg-surface px-3 text-sm text-neutral-700 transition-colors hover:bg-neutral-50"
          >
            {t['shop.filter.search']}
          </button>
        </form>
        <select
          aria-label={t['shop.filter.collection']}
          value={initial.collection ?? ''}
          onChange={(e) => update({ collection: e.target.value || undefined })}
          className={selectClass}
        >
          <option value="">{t['shop.allStyles']}</option>
          {collectionOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          aria-label={t['shop.filter.price']}
          value={currentPriceBand(initial)}
          onChange={(e) => update(applyPriceRange(e.target.value))}
          className={selectClass}
        >
          <option value="">{t['shop.filter.anyPrice']}</option>
          <option value="u100">{t['shop.filter.priceUnder100']}</option>
          <option value="100-150">{t['shop.filter.price100To150']}</option>
          <option value="o150">{t['shop.filter.priceOver150']}</option>
        </select>
        <select
          aria-label={t['shop.filter.sort']}
          value={initial.sort ?? 'featured'}
          onChange={(e) => update({ sort: e.target.value as ShopFilter['sort'] })}
          className={selectClass}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {t[o.labelKey]}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="mt-3">
        <legend className="sr-only">{t['shop.filter.sizeLegend']}</legend>
        <div className="flex flex-wrap gap-1.5">
          {sizeOptions.map(({ label, canonical }) => {
            const checked = selectedSizes.has(label)
            const isMySize = myEU != null && canonical === myEU
            return (
              <label key={label} className="cursor-pointer">
                <input
                  type="checkbox"
                  name="size"
                  value={label}
                  checked={checked}
                  aria-label={isMySize ? `${label} ${t['shop.filter.yourSize']}` : label}
                  onChange={(e) => toggleSize(label, e.target.checked)}
                  className="peer sr-only"
                />
                <span
                  data-your-size={isMySize ? 'true' : undefined}
                  className="relative inline-flex items-center rounded-full border border-neutral-200 px-3 py-1 text-xs text-neutral-700 transition-colors peer-checked:border-neutral-900 peer-checked:bg-neutral-900 peer-checked:text-white"
                >
                  {label}
                  {isMySize ? (
                    <span
                      aria-hidden="true"
                      className="ml-1.5 inline-block size-1.5 rounded-full bg-brand"
                    />
                  ) : null}
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
          {t['shop.filter.clearAll']}
        </button>
      ) : null}
    </section>
  )
}
