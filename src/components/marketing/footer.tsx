import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import { site } from '@/lib/site'

export function Footer() {
  return (
    <footer className="bg-[#111111] text-[#fafaf8]">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 pb-8 pt-14 md:flex-row md:items-start md:justify-between">
        <div className="max-w-xs">
          <Link
            href="/"
            className="text-xl font-semibold tracking-tight transition-opacity hover:opacity-80"
          >
            {site.name}
          </Link>
          <p className="mt-3 text-sm leading-6 text-[#fafaf8]/60">
            Casual shoes, printed to order in your size.
          </p>
        </div>
        <nav aria-label="Footer" className="flex flex-col gap-3 text-sm">
          {site.nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-[#fafaf8]/70 transition-colors hover:text-[#fafaf8]"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <p className="text-sm text-[#fafaf8]/50">© 2026 {site.name}</p>
      </div>
      {/* 核心 Slogan：全站页脚收尾，每页可见（规格克制：小号、低对比） */}
      <div className="mx-auto w-full max-w-6xl border-t border-[#fafaf8]/10 px-4 pb-12 pt-6 text-center">
        <p className="text-sm text-[#fafaf8]/50">{site.tagline}</p>
        {/* 项目性质：学生黑客松作品、非商业服务（克制：更小字号、更低对比） */}
        <p className="mx-auto mt-3 max-w-2xl text-xs leading-5 text-[#fafaf8]/60">
          {site.projectNote}
        </p>
        {/* 项目开源仓库：学生作品，公开代码（克制：小字号、低对比、尾行） */}
        <a
          href="https://github.com/WhatDamon/shoe-online-store-demo"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 text-xs text-[#fafaf8]/60 transition-colors hover:text-[#fafaf8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fafaf8]"
        >
          <ExternalLink aria-hidden="true" className="size-3.5" />
          View source on GitHub
        </a>
      </div>
    </footer>
  )
}
