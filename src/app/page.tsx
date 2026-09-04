import { AppBar } from '@/components/marketing/app-bar'
import { Hero } from '@/components/marketing/hero'
import { PromiseStrip } from '@/components/marketing/promise-strip'
import { CollectionCards } from '@/components/marketing/collection-cards'
import { FeaturedGrid } from '@/components/marketing/featured-grid'
import { StorySection } from '@/components/marketing/story-section'
import { Footer } from '@/components/marketing/footer'

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
