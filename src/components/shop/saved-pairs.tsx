'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useWishlist } from './wishlist-provider'
import { ProductVisual } from './product-visual'
import type { CatalogSummary } from '@/app/api/catalog/route'

interface LoadedRow extends CatalogSummary {
  saved: boolean
}

const EMPTY_ROWS: LoadedRow[] = []

/**
 * 愿望单清单（client）：读 wishlist 快照 → fetch /api/catalog?handles=… 拉展示摘要。
 * 收藏项增删会同步反映（快照变化重拉）；未知 handle 被服务端静默过滤（过期项不崩页）。
 * 空态由 items.length 派生（无请求、无 effect setState）；加载/错误态各自温和呈现。
 * fetch 的 setState 全部发生在异步 continuation / 事件回调内（react-hooks 规则）。
 */
export function SavedPairs() {
  const { items, toggle } = useWishlist()
  const [rows, setRows] = useState<LoadedRow[] | null>(null) // null = 加载中
  const [failed, setFailed] = useState(false)

  // items 变（增/删/首载）→ 重新拉；空清单不发请求（渲染层直接给空态）。
  // 形态：effect 内 async iife，setState 全在 await 之后的异步 continuation（
  // react-hooks/set-state-in-effect 只拦 effect 同步体的 setState）；alive 守卫丢弃过期响应。
  useEffect(() => {
    if (items.length === 0) return
    let alive = true
    const run = async () => {
      try {
        const res = await fetch(`/api/catalog?handles=${encodeURIComponent(items.join(','))}`, {
          cache: 'no-store',
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data: CatalogSummary[] = await res.json()
        if (!alive) return
        setRows(data.map((row) => ({ ...row, saved: true })))
        setFailed(false)
      } catch {
        if (!alive) return
        setRows(EMPTY_ROWS)
        setFailed(true)
      }
    }
    void run()
    return () => {
      alive = false
    }
  }, [items])

  const empty = items.length === 0 || (rows !== null && rows.length === 0 && !failed)

  if (failed) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-surface px-4 py-10 text-center">
        <p className="text-sm text-neutral-600">
          We couldn&apos;t load your saved pairs — check your connection and try again.
        </p>
      </div>
    )
  }

  if (rows === null && items.length > 0) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-surface px-4 py-10 text-center">
        <p className="text-sm text-neutral-500">Loading your saved pairs…</p>
      </div>
    )
  }

  if (empty) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-surface px-4 py-12 text-center">
        <p className="text-base font-medium text-neutral-900">Nothing saved yet</p>
        <p className="mx-auto mt-1.5 max-w-sm text-sm leading-6 text-neutral-500">
          Tap the heart on any pair — in the shop or on a product page — and it will show up here.
        </p>
        <Link
          href="/shop"
          className="mt-5 inline-flex items-center justify-center rounded-lg bg-ink px-4 py-2 text-sm font-medium text-canvas transition-opacity hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
        >
          Browse the shop
        </Link>
      </div>
    )
  }

  const list = rows ?? EMPTY_ROWS
  return (
    <ul className="flex flex-col gap-3">
      {list.map((row) => (
        <li
          key={row.handle}
          className="relative flex items-center gap-3 rounded-xl border border-neutral-200 bg-surface p-2.5 transition-colors hover:border-neutral-400"
        >
          <Link
            href={`/product/${row.handle}`}
            className="flex min-w-0 flex-1 items-center gap-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
          >
            {/* 照片整图居中白 tile；无图款回落到色卡 SVG（真实色板） */}
            <span className="relative block h-16 w-20 shrink-0 overflow-hidden rounded-lg bg-white">
              {row.image ? (
                <Image src={row.image} alt="" fill sizes="5rem" className="object-contain" />
              ) : (
                <span className="absolute inset-0">
                  <ProductVisual
                    name={row.title}
                    view="side"
                    className="h-full w-full"
                    visual={{
                      palette: ['#111111', '#0f766e'],
                      accent: '#0f766e',
                      views: 3,
                    }}
                  />
                </span>
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-neutral-900">{row.title}</span>
              <span className="mt-0.5 block text-xs text-neutral-500">{row.subtitle}</span>
              <span className="mt-1 block text-[11px] text-neutral-500">
                {row.sizeRange ? row.sizeRange : 'Size to confirm'}
                {row.colorCount > 0
                  ? ` · ${row.colorCount} color${row.colorCount === 1 ? '' : 's'}`
                  : ''}
                {row.storeAvailable ? ' · On the store' : ''}
              </span>
            </span>
          </Link>
          <button
            type="button"
            onClick={() => toggle(row.handle)}
            aria-label={`Remove ${row.title} from saved`}
            className="shrink-0 rounded-full p-2.5 text-neutral-500 transition-colors hover:text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
              <path
                d="M12 20.6 4.9 13.7a4.6 4.6 0 0 1 0-6.5 4.6 4.6 0 0 1 6.5 0l.6.6.6-.6a4.6 4.6 0 0 1 6.5 0 4.6 4.6 0 0 1 0 6.5L12 20.6Z"
                fill="currentColor"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </li>
      ))}
    </ul>
  )
}
