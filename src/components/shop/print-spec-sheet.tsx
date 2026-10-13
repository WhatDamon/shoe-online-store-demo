import { convert } from '@/domain/size'
import { site } from '@/lib/site'
import { POLICY_PRODUCTION, POLICY_RETURNS } from '@/lib/store-policy'
import type { ProductView } from '@/domain/product'
import type { CanonicalSize } from '@/domain/product'
import { DEFAULT_LOCALE, type Locale } from '@/i18n/locales'
import { messages } from '@/i18n/messages'

const SYSTEMS = ['US', 'EU', 'UK', 'JP', 'CN'] as const

function systemRow(eu: CanonicalSize): { label: string; value: string }[] {
  return SYSTEMS.map((s) => {
    const v = convert(eu, s)
    return { label: s, value: v == null ? '—' : String(v) }
  })
}

/**
 * PDP 打印规格区块（决策：Print / Save as PDF）。服务端由真实数据渲染：
 * 品牌名 + 商品真实信息（货号/标题/描述/特性/护理说明/尺码换算对照）。
 * 屏幕上默认隐藏（CSS），仅 @media print 显示；非打印区块由全局打印样式隐藏。
 *
 * 真实数据原则：只印实有字段——货号、真实色数、尺码换算行（表内换算）；不印 demo
 * 价格（§AI 不带价原则延伸：价格只在店铺实时呈现），不印虚构工艺词。护理内容与
 * PDP 详情区同源（store-policy 常量）。尺码为演示换算口径。
 *
 * `locale` 可选并缺省默认语言（与 `promise-strip.tsx` 同一策略，裁定 R4）：本组件是服务端组件
 * （拿不到 Provider），而 `print-spec-sheet.test.tsx` 直接合成渲染 `<PrintSpecSheet product={…} />`
 * ——必填会让那个既有用例无法渲染。生产里的渲染点（PDP）总是显式传入 URL 语言。
 */
export function PrintSpecSheet({
  product,
  locale = DEFAULT_LOCALE,
}: {
  product: ProductView
  locale?: Locale
}) {
  const t = messages(locale)
  const colors = product.colors ?? []
  return (
    <section aria-label={t['pdp.print.sheetLabel']} className="print-spec-sheet">
      <header className="print-sheet-header">
        <p className="print-brand">{site.name}</p>
        <p className="print-tagline">{site.tagline}</p>
      </header>

      <h1 className="print-title">{product.title}</h1>
      <p className="print-code">{product.handle.toUpperCase()}</p>

      <p className="print-desc">{product.description}</p>

      {product.features.length > 0 ? (
        <section className="print-block">
          <h2>{t['pdp.print.details']}</h2>
          <ul>
            {product.features.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {colors.length > 0 ? (
        <section className="print-block">
          <h2>{t['pdp.print.colourways']}</h2>
          <p>{colors.map((c) => c.name).join(', ')}</p>
        </section>
      ) : null}

      {product.sizes.length > 0 ? (
        <section className="print-block">
          <h2>{t['pdp.print.sizeConversion']}</h2>
          <table className="print-table">
            <thead>
              <tr>
                {SYSTEMS.map((s) => (
                  <th key={s}>{s}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {product.sizes.map((eu) => (
                <tr key={eu}>
                  {systemRow(eu).map((c) => (
                    <td key={c.label}>{c.value}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="print-note">{t['pdp.print.note']}</p>
        </section>
      ) : null}

      <section className="print-block">
        <h2>{t['pdp.print.policy']}</h2>
        <p>{POLICY_PRODUCTION}</p>
        <p>{POLICY_RETURNS}</p>
      </section>
    </section>
  )
}
