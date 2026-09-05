import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { ArrowLeft } from 'lucide-react'
import { catalog } from '@/server/catalog/adapter'
import { getProductForMarket, getRelatedProducts } from '@/server/catalog/service'
import { shopifyBuyConfigFor } from '@/server/catalog/shopify-buy'
import { ProductGallery } from '@/components/shop/product-gallery'
import { ProductActions } from '@/components/shop/product-actions'
import { CareInstructionsButton } from '@/components/shop/care-instructions'
import { PrintSpecSheetButton } from '@/components/shop/print-spec-sheet-button'
import { PrintSpecSheet } from '@/components/shop/print-spec-sheet'
import { ProductGrid } from '@/components/shop/product-grid'
import { WishlistButton } from '@/components/shop/wishlist-button'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { formatPrice } from '@/lib/format'
import { pageMetadata } from '@/lib/seo'
import { POLICY_PRODUCTION, POLICY_RETURNS } from '@/lib/store-policy'

export async function generateStaticParams() {
  const products = await catalog.getProducts()
  return products.map((p) => ({ handle: p.handle }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>
}): Promise<Metadata> {
  const { handle } = await params
  const product = await getProductForMarket(handle)
  // 未知 handle：由页面级 notFound() 决定 404，元数据仅回退默认品牌态。
  if (!product) return {}
  return pageMetadata({
    title: product.title,
    description: product.description,
  })
}

// PDP（SSG，规格 §9）：/product/[handle] 由 generateStaticParams 预渲染。
// 未知 handle 在 dynamicParams=true（默认）下走按需渲染 → getProductForMarket null → notFound()，
// 实测返回品牌化 not-found 壳（HTTP 200 + robots noindex）；若将来需要真 404 再设 dynamicParams=false。
export default async function ProductPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params
  const product = await getProductForMarket(handle)
  if (!product) notFound()

  // 商店直购（决策 #15 重启用，2026-09-06 全目录映射）：商店有同 handle 商品且 SHOPIFY_BUY_* env 已配 →
  // 该 PDP 由 Shopify Buy Button 接管变体选择与结算（隐藏 demo 价与选择器）；否则维持 demo 购买条。
  const buyConfig = shopifyBuyConfigFor(product.handle)
  const [buyUrl, related] = await Promise.all([
    catalog.getBuyUrl(product),
    getRelatedProducts(product.handle, 3),
  ])

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:py-8">
      {/* 打印规格说明：可交互主体包 .print-hidden，@media print 只保留 .print-spec-sheet。 */}
      <div className="print-hidden">
        <Link
          href="/shop"
          className="inline-flex items-center gap-1.5 text-sm text-neutral-500 transition-colors hover:text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
        >
          <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
          All shoes
        </Link>

        {/* 网格基础列显式 minmax(0,1fr)：无 lg 双列时若省略列模板，隐式 auto 轨道会按内容
          max-content 撑宽（缩略图条等不可折内容 → 窄屏横向滚动），显式约束让轨道尊重容器宽度。 */}
        <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-14">
          <ProductGallery product={product} />

          <div className="flex flex-col gap-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="font-heading text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
                  {product.title}
                </h1>
                {/* 真实货号：import.py 以 slugify(code) 生成 handle（29/29 code === handle.toUpperCase()），
                  故展示层由 handle 回大写即得供应商货号（如 DC-1001 / 26016-M）。原副标题
                  （"Unisex · 5 colorways"）与描述首句重复且无货号价值，替换为货号行更疏朗。
                  若未来 handle 不再由货号派生（如 Shopify 商品），此推导需改为显式 code 字段。 */}
                <p className="mt-1.5 text-[13px] uppercase tracking-wider text-neutral-500">
                  {product.handle.toUpperCase()}
                </p>
              </div>
              <WishlistButton handle={product.handle} />
            </div>

            {/* 商店直购形态：demo $ 价不显示（价格仅由 Buy Button 以店币呈现，决策：不并存误导） */}
            {buyConfig == null ? (
              <p className="text-2xl font-semibold text-ink">{formatPrice(product.price.amount)}</p>
            ) : null}

            <p className="text-[15px] leading-7 text-neutral-600">{product.description}</p>

            <ProductActions product={product} buyUrl={buyUrl} buyConfig={buyConfig}>
              <div className="flex flex-col gap-3">
                {/* 详情手风琴分区标题：base-ui AccordionHeader 固定渲染 h3，
                  需 h2 祖先承接 h1 → h3 的标题层级（heading-order 修复）。 */}
                <h2 className="sr-only">Product details</h2>
                <Accordion className="border-t border-neutral-200">
                  <AccordionItem value="materials-fit">
                    <AccordionTrigger>Materials &amp; fit</AccordionTrigger>
                    <AccordionContent>
                      <ul className="mb-4 list-disc space-y-1 pl-4 text-neutral-600">
                        {product.features.map((feature) => (
                          <li key={feature}>{feature}</li>
                        ))}
                      </ul>
                      <p className="text-neutral-600">{product.fitNotes}</p>
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="shipping">
                    <AccordionTrigger>Shipping &amp; returns</AccordionTrigger>
                    <AccordionContent>
                      {/* 文案单源（store-policy.ts）：与 AI support 客服注入同一份，禁止在此另写。 */}
                      <p className="mb-3 text-neutral-600">{POLICY_PRODUCTION}</p>
                      <p className="text-neutral-600">{POLICY_RETURNS}</p>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
                {/* 护理说明海报入口（决策 #19）：每 PDP 通用，弹窗查看，不占首屏。 */}
                <CareInstructionsButton />
                {/* 打印规格入口（决策 #25 类：Print / Save as PDF，克制、不占首屏）。 */}
                <PrintSpecSheetButton />
              </div>
            </ProductActions>
          </div>
        </div>

        {related.length > 0 ? (
          <section aria-labelledby="related-heading" className="mt-16 sm:mt-20">
            <h2
              id="related-heading"
              className="font-heading text-2xl font-semibold tracking-tight text-ink"
            >
              You may also like
            </h2>
            <div className="mt-5">
              <ProductGrid products={related} />
            </div>
          </section>
        ) : null}
      </div>

      {/* 打印规格（决策：PDP 内打印区块）：屏幕上隐藏，@media print 只显示此 sheet。 */}
      <PrintSpecSheet product={product} />
    </div>
  )
}
