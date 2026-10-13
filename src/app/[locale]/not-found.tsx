'use client'

import { LocaleLink } from '@/components/i18n/locale-link'
import { useMessages } from '@/components/i18n/locale-provider'
import { STATUS_CTA_CLASS, StatusShell } from '@/components/marketing/status-shell'

// 消费者语气（克制，无技术措辞）：未知页面 / 未知商品 handle → 404。
// 未知路径在根布局下渲染（无组布局），故 StatusShell 自带全局壳保证导航/Footer 一致。
//
// 'use client' 只为读词典：404 组件拿不到 params（官方文档：not-found 组件不接受任何 props），
// 文案由根布局的 Provider 下发；无 Provider 时 useMessages 回退默认语言，与改造前硬编码英文等价。
export default function NotFound() {
  const t = useMessages()
  return (
    <StatusShell title={t['notFound.title']} description={t['notFound.description']}>
      <LocaleLink href="/shop" className={`mt-8 ${STATUS_CTA_CLASS}`}>
        {t['notFound.cta']}
      </LocaleLink>
    </StatusShell>
  )
}
