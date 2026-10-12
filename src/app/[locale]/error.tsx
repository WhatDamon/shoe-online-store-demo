'use client'

import Link from 'next/link'
import { STATUS_CTA_CLASS, StatusShell } from '@/components/marketing/status-shell'

// 'use client' 以支持 reset()。根 error 边界在根布局下替换整个 children（组布局的壳被绕过）。
export default function Error({ reset }: { reset: () => void }) {
  return (
    <StatusShell
      title="Something went wrong on our end"
      description="Please give it one more try — most hiccups clear right up."
    >
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={() => reset()} className={STATUS_CTA_CLASS}>
          Try again
        </button>
        <Link href="/shop" className={STATUS_CTA_CLASS}>
          Browse the shop
        </Link>
      </div>
    </StatusShell>
  )
}
