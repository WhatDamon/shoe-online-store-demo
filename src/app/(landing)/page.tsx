import { Hero } from '@/components/marketing/hero'
import { PromiseStrip } from '@/components/marketing/promise-strip'
import { CollectionCards } from '@/components/marketing/collection-cards'
import { FeaturedGrid } from '@/components/marketing/featured-grid'
import { StorySection } from '@/components/marketing/story-section'
import { pageMetadata } from '@/lib/seo'

// 标题语义（框架回归点）：root layout（含 title.template '%s — Evoloop'）处于
// 3 段路由 [root, (landing) layout, page] 中“最后两段之外”，模板会应用到叶子 title，
// 因此这里只给裸文案，品牌后缀由 root 模板统一追加。
// 警告：若未来移除 (landing) 组布局（回到 [root, page] 两段），Next 会跳过模板 ——
// 届时必须改回显式后缀（“… — ${site.name}”）并同步 /shop、PDP 的标题测试。
export const metadata = pageMetadata({
  title: 'Casual shoes, printed to order in your size',
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
