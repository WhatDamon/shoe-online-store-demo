import { convert } from '@/server/catalog/size-charts'
import { site } from '@/lib/site'
import { POLICY_PRODUCTION, POLICY_RETURNS } from '@/lib/store-policy'
import type { ProductView } from '@/server/catalog/service'
import type { CanonicalSize } from '@/server/catalog/types'

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
 * PDP 详情区同源（store-policy 常量）。尺码为演示换算口径（决策 #20 注）。
 */
export function PrintSpecSheet({ product }: { product: ProductView }) {
  const colors = product.colors ?? []
  return (
    <section aria-label="Print specification" className="print-spec-sheet">
      <header className="print-sheet-header">
        <p className="print-brand">{site.name}</p>
        <p className="print-tagline">{site.tagline}</p>
      </header>

      <h1 className="print-title">{product.title}</h1>
      <p className="print-code">{product.handle.toUpperCase()}</p>

      <p className="print-desc">{product.description}</p>

      {product.features.length > 0 ? (
        <section className="print-block">
          <h2>Details</h2>
          <ul>
            {product.features.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {colors.length > 0 ? (
        <section className="print-block">
          <h2>Colourways</h2>
          <p>{colors.map((c) => c.name).join(', ')}</p>
        </section>
      ) : null}

      {product.sizes.length > 0 ? (
        <section className="print-block">
          <h2>Size conversion</h2>
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
          <p className="print-note">
            Sizes in each system convert from the same mm-anchored reference. The reference table is
            demo data — confirm the current size guide before ordering.
          </p>
        </section>
      ) : null}

      <section className="print-block">
        <h2>Made-to-order &amp; returns</h2>
        <p>{POLICY_PRODUCTION}</p>
        <p>{POLICY_RETURNS}</p>
      </section>
    </section>
  )
}
