import { describe, expect, it } from 'vitest'
import type { ContentStatus, LocalizedPost } from './content'

// 纯词汇层测试：只钉住「两种状态都能被类型表达」这一个事实。
// 机制（谁在什么条件下产出哪种状态）由 `src/lib/blog.test.ts` 覆盖——这里不重复。
describe('content availability vocabulary', () => {
  it('表达 translated 与 fallback 两种状态，并带上正文来源语言', () => {
    const translated: LocalizedPost<{ title: string }> = {
      post: { title: '如何选择你的尺码' },
      status: 'translated',
      sourceLocale: 'zh-CN',
    }
    const fallback: LocalizedPost<{ title: string }> = {
      post: { title: 'How to pick your size' },
      status: 'fallback',
      sourceLocale: 'en',
    }
    const statuses: ContentStatus[] = [translated.status, fallback.status]
    expect(statuses).toEqual(['translated', 'fallback'])
    expect(fallback.post.title).toBe('How to pick your size')
    expect(fallback.sourceLocale).toBe('en')
  })
})
