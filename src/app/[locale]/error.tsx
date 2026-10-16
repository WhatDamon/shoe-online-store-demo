'use client'

import { LocaleLink } from '@/components/i18n/locale-link'
import { useMessages } from '@/components/i18n/locale-provider'
import { STATUS_CTA_CLASS, StatusShell } from '@/components/marketing/status-shell'

// 'use client' 以支持 reset()。根 error 边界在根布局下替换整个 children（组布局的壳被绕过）。
// 文案走 `useMessages()` 而不是 `messages(locale)`：错误边界拿不到 params，词典由根布局的
// Provider 下发（同 404；无 Provider 时回退默认语言，与既有测试环境一致）。
export default function Error({ reset }: { reset: () => void }) {
  const t = useMessages()
  return (
    <StatusShell title={t['error.title']} description={t['error.description']}>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={() => reset()} className={STATUS_CTA_CLASS}>
          {t['error.retry']}
        </button>
        <LocaleLink href="/shop" className={STATUS_CTA_CLASS}>
          {t['error.cta']}
        </LocaleLink>
      </div>
    </StatusShell>
  )
}
