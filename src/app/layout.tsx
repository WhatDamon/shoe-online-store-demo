import type { ReactNode } from 'react'
import { baseMetadata } from '@/lib/seo'
import { Geist, Geist_Mono, Newsreader } from 'next/font/google'
import './globals.css'
import { DiagBeacon } from '@/components/diag-beacon'
import { WishlistProvider } from '@/components/shop/wishlist-provider'
import { AssistantProvider } from '@/components/assistant/assistant-provider'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

const newsreader = Newsreader({
  variable: '--font-newsreader',
  subsets: ['latin'],
})

// SEO 基座集中在 src/lib/seo.ts（brand 模板 / metadataBase / OG），单点维护。
export const metadata = baseMetadata

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-canvas text-ink">
        <WishlistProvider>
          <AssistantProvider>
            <DiagBeacon />
            {children}
          </AssistantProvider>
        </WishlistProvider>
      </body>
    </html>
  )
}
