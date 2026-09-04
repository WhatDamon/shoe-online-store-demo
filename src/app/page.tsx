import { AppBar } from '@/components/marketing/app-bar'
import { Hero } from '@/components/marketing/hero'
import { PromiseStrip } from '@/components/marketing/promise-strip'
import { CollectionCards } from '@/components/marketing/collection-cards'
import { FeaturedGrid } from '@/components/marketing/featured-grid'
import { StorySection } from '@/components/marketing/story-section'
import { Footer } from '@/components/marketing/footer'
import { pageMetadata } from '@/lib/seo'
import { site } from '@/lib/site'

// 根页只有 [root layout, page] 两项，Next 的 accumulateMetadata 不会把 title
// template 应用到叶子 page，故此处显式携带品牌后缀，保持与嵌套页标题一致。
export const metadata = pageMetadata({
  title: `Casual shoes, printed to order in your size — ${site.name}`,
})

// Landing（规格 §9 顺序）：AppBar / Hero / PromiseStrip / CollectionCards /
// FeaturedGrid / StorySection / Footer。整页零 AI 痕迹（P1：助手入口不在此页）。
export default function HomePage() {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-ink">
      <AppBar />
      <main className="flex-1">
        <Hero />
        <PromiseStrip />
        <CollectionCards />
        <FeaturedGrid />
        <StorySection />
      </main>
      <Footer />
    </div>
  )
}
