import { site } from './site'
import type { Metadata } from 'next'

/**
 * 站点绝对基址（OG 图片等需要）。默认开发回退 localhost:3000；
 * 部署时用 NEXT_PUBLIC_SITE_URL 覆盖（否则线上 OG 图指回本地）。
 * 非法/缺省 env 不抛错：非 http(s) 或不合法一律回退 localhost。
 */
const DEFAULT_BASE = 'http://localhost:3000'
const resolveBaseUrl = (): URL => {
  try {
    const raw = process.env.NEXT_PUBLIC_SITE_URL ?? ''
    if (!raw) return new URL(DEFAULT_BASE)
    const url = new URL(raw)
    if (url.protocol === 'http:' || url.protocol === 'https:') return url
    return new URL(DEFAULT_BASE)
  } catch {
    // 入参来自 env，非编译期常量：解析失败按缺省处理，绝不抛出
    return new URL(DEFAULT_BASE)
  }
}

export const baseMetadata: Metadata = {
  metadataBase: resolveBaseUrl(),
  title: { default: site.name, template: `%s — ${site.name}` },
  description: 'Casual shoes, digitally crafted and printed to order.',
  openGraph: { images: ['/og'], siteName: site.name },
}

export const pageMetadata = (o: Partial<Metadata>): Metadata => ({
  ...baseMetadata,
  ...o,
})
