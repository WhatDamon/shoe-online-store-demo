import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Geist, Geist_Mono, Newsreader } from 'next/font/google'
import './globals.css'
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

export const metadata: Metadata = {
  title: 'Treadwell — casual shoes, printed to order in your size',
  description:
    'Casual shoes designed around your foot. Printed to order in your size, with free returns.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-canvas text-ink">
        <WishlistProvider>
          <AssistantProvider>{children}</AssistantProvider>
        </WishlistProvider>
      </body>
    </html>
  )
}
