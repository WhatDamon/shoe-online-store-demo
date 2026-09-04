import Link from 'next/link'
import { site } from '@/lib/site'

export function Footer() {
  return (
    <footer className="bg-ink text-canvas">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 pb-8 pt-14 md:flex-row md:items-start md:justify-between">
        <div className="max-w-xs">
          <Link
            href="/"
            className="font-heading text-xl font-semibold tracking-tight transition-opacity hover:opacity-80"
          >
            {site.name}
          </Link>
          <p className="mt-3 text-sm leading-6 text-canvas/60">
            Casual shoes, printed to order in your size.
          </p>
        </div>
        <nav aria-label="Footer" className="flex flex-col gap-3 text-sm">
          {site.nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-canvas/70 transition-colors hover:text-canvas"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <p className="text-sm text-canvas/50">© 2026 {site.name}</p>
      </div>
      {/* 核心 Slogan：全站页脚收尾，每页可见（规格克制：小号、低对比） */}
      <p className="mx-auto w-full max-w-6xl border-t border-canvas/10 px-4 pb-12 pt-6 text-center text-sm text-canvas/50">
        {site.tagline}
      </p>
    </footer>
  )
}
