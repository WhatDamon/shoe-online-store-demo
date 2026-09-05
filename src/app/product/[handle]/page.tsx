import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { ArrowLeft } from 'lucide-react'
import { catalog } from '@/server/catalog/adapter'
import { getProductForMarket, getRelatedProducts } from '@/server/catalog/service'
import { ProductGallery } from '@/components/shop/product-gallery'
import { ProductActions } from '@/components/shop/product-actions'
import { CareInstructionsButton } from '@/components/shop/care-instructions'
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

  // 决策 #19：Buy Button 测试款已整体回退，全 PDP 均为 demo 购买条（getBuyUrl 未配 → null）。
  const [buyUrl, related] = await Promise.all([
    catalog.getBuyUrl(product),
    getRelatedProducts(product.handle, 3),
  ])

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:py-8">
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

          <p className="text-2xl font-semibold text-ink">{formatPrice(product.price.amount)}</p>

          <p className="text-[15px] leading-7 text-neutral-600">{product.description}</p>

          <ProductActions product={product} buyUrl={buyUrl}>
            <div className="flex flex-col gap-3">
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
                    <p className="mb-3 text-neutral-600">
                      Every pair is printed to order in our studio, so nothing sits in a warehouse —
                      we only print what you buy.
                    </p>
                    <p className="text-neutral-600">
                      Because each pair is made to your order, custom-printed items can&apos;t be
                      returned or refunded. If your pair arrives faulty or the fit is not as
                      promised, message us within 30 days and we&apos;ll sort it out.
                    </p>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
              {/* 护理说明海报入口（决策 #19）：每 PDP 通用，弹窗查看，不占首屏。 */}
              <CareInstructionsButton />
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
  )
}
