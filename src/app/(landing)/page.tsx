import { Hero } from '@/components/marketing/hero'
import { PromiseStrip } from '@/components/marketing/promise-strip'
import { CollectionCards } from '@/components/marketing/collection-cards'
import { FeaturedGrid } from '@/components/marketing/featured-grid'
import { StorySection } from '@/components/marketing/story-section'
import { pageMetadata } from '@/lib/seo'
import { site } from '@/lib/site'

// 根页只有 [root layout, (landing) layout, page] —— title template 不会被应用到叶子
// page，故此处显式携带品牌后缀，保持与嵌套页标题一致。
export const metadata = pageMetadata({
  title: `Casual shoes, printed to order in your size — ${site.name}`,
})

// Landing 内容（规格 §9 顺序）：Hero / PromiseStrip / CollectionCards / FeaturedGrid /
// StorySection。外壳（AppBar 透明遮罩 + Footer）由 (landing)/layout.tsx 提供。
// 整页零 AI 痕迹（P1：助手入口不在此页）。
export default function HomePage() {
  return (
    <>
      <Hero />
      <PromiseStrip />
      <CollectionCards />
      <FeaturedGrid />
      <StorySection />
    </>
  )
}
