import { JsonLd } from './json-ld'
import type { Locale } from '@/i18n/locales'
import { organizationSchema, websiteSchema } from '@/lib/structured-data'

/**
 * 站点级 JSON-LD，由 root layout（`[locale]/layout.tsx`）渲染。
 *
 * `locale` 由 layout 的**已校验** `params` 传入，而不是在这里写死 `DEFAULT_LOCALE`：
 * WebSite 是逐语言的节点（`url` / `inLanguage` / 搜索入口都随语言变化），
 * 写死默认语言会让 `/zh-CN` 页面声明一个 /en 的 WebSite（阶段 2 就能观察到）。
 * Organization 与语言无关，故不需要 locale（见 structured-data.ts 的 `@id` 政策）。
 */
export function SiteJsonLd({ locale }: { locale: Locale }) {
  return (
    <>
      <JsonLd data={organizationSchema()} />
      <JsonLd data={websiteSchema(locale)} />
    </>
  )
}
