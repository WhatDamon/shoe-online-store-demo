import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  availableLocalesFor,
  getLocalizedPost,
  getPost,
  listLocalizedPosts,
  listPosts,
} from './blog'
import { formatPostDate } from './format'
import type { Locale } from '@/i18n/locales'

// Blog 内容层测试：真实 content/blog/ 单篇示例 + tmpdir 夹具验证容错分支。
describe('blog content layer', () => {
  it('lists the committed example post with parsed metadata', () => {
    const posts = listPosts()
    expect(posts.length).toBeGreaterThanOrEqual(1)
    const post = posts[0]
    expect(post.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    expect(post.title.length).toBeGreaterThan(0)
    expect(post.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // 日期标签不再由内容层预算（`BlogPost.dateLabel` 已删）：在渲染点按 locale 现算。
    expect(formatPostDate(post.date, 'en')).toMatch(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/)
    // Markdown 正文原样保留（含标题与表格等演示结构）
    expect(post.content).toContain('#')
  })

  it('sorts posts newest first', () => {
    const posts = listPosts()
    for (let i = 1; i < posts.length; i++) {
      expect(posts[i - 1].date >= posts[i].date).toBe(true)
    }
  })

  it('gets a post by slug and null for unknown or unsafe slugs', () => {
    const posts = listPosts()
    const found = getPost(posts[0].slug)
    expect(found?.title).toBe(posts[0].title)
    expect(getPost('no-such-post-xyz')).toBeNull()
    // 穿越尝试：slug 从不参与路径拼接，非法 slug 一律 null
    expect(getPost('../../package.json')).toBeNull()
    expect(getPost('..')).toBeNull()
    expect(getPost('UPPER')).toBeNull()
  })

  it('skips invalid metadata, tolerates rolled YAML dates, throws on broken YAML', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-test-'))
    // 半成品：缺 title → 跳过不炸
    fs.writeFileSync(path.join(dir, 'draft.md'), '---\ndate: 2026-09-01\n---\nDraft body\n')
    // 坏日期（作者加了引号 → 字符串分支严格拒绝）→ 跳过不炸
    fs.writeFileSync(
      path.join(dir, 'bad-date.md'),
      "---\ntitle: Bad\ndate: '2026-13-99'\n---\nBody\n",
    )
    // 宽松回卷容忍（js-yaml Date 形态，已文档化）：2026-02-31 → 2026-03-03
    fs.writeFileSync(
      path.join(dir, 'rolled.md'),
      '---\ntitle: Rolled\ndate: 2026-02-31\n---\nBody\n',
    )
    const listed = listPosts(dir)
    expect(listed).toHaveLength(1)
    expect(listed[0].slug).toBe('rolled')
    expect(listed[0].date).toBe('2026-03-03')

    // 坏 YAML → 抛错（作者笔误要响亮）
    fs.writeFileSync(path.join(dir, 'broken.md'), '---\ntitle: [unclosed\n---\nBody\n')
    expect(() => listPosts(dir)).toThrow(/frontmatter parse error/)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('formats dates as en-US labels', () => {
    expect(formatPostDate('2026-09-07', 'en')).toBe('Sep 7, 2026')
    expect(formatPostDate('2026-01-03', 'en')).toBe('Jan 3, 2026')
  })

  it('同一篇文章在 en 与 zh-CN 下得到不同的日期标签（locale 必填，不是摆设）', () => {
    const post = listPosts().find((p) => p.slug === 'finding-your-evoloop-size')
    if (!post) throw new Error('fixture post finding-your-evoloop-size is missing')
    expect(formatPostDate(post.date, 'en')).toBe('Sep 6, 2026')
    expect(formatPostDate(post.date, 'zh-CN')).toBe('2026年9月6日')
  })

  // ── 内容可用性与回退（阶段 2 任务 5）─────────────────────────────────────────

  it('未译文章在 zh-CN 下回退英文原文，并标出正文来源语言', () => {
    const slug = 'finding-your-evoloop-size'
    const english = getPost(slug)
    if (!english) throw new Error(`fixture post ${slug} is missing`)
    const localized = getLocalizedPost(slug, 'zh-CN')
    expect(localized?.status).toBe('fallback')
    expect(localized?.sourceLocale).toBe('en')
    // 回退真的拿到了英文内容（标题 + 正文），不是空壳也不是空字符串
    expect(localized?.post.title).toBe(english.title)
    expect(localized?.post.content).toBe(english.content)
    // 译文出现前，该文章的可用语言只有默认语言
    expect(availableLocalesFor(slug)).toEqual(['en'])
  })

  it('默认语言下必然是 translated', () => {
    const localized = getLocalizedPost('finding-your-evoloop-size', 'en')
    expect(localized?.status).toBe('translated')
    expect(localized?.sourceLocale).toBe('en')
  })

  it('索引列表的状态与 availableLocalesFor 一致（en/zh-CN 均用真实内容复核）', () => {
    const english = listPosts()
    for (const locale of ['en', 'zh-CN'] as const) {
      const localized = listLocalizedPosts(locale)
      expect(localized.map((item) => item.post.slug)).toEqual(english.map((p) => p.slug))
      for (const item of localized) {
        const expected = availableLocalesFor(item.post.slug).includes(locale)
          ? 'translated'
          : 'fallback'
        expect(item.status, `${locale}:${item.post.slug}`).toBe(expected)
        expect(item.sourceLocale).toBe(expected === 'translated' ? locale : 'en')
      }
    }
  })

  it('机制随译文出现而翻转（临时目录夹具，不依赖真实译文）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-i18n-'))
    try {
      const slug = 'fixture-post'
      fs.writeFileSync(
        path.join(dir, `${slug}.md`),
        '---\ntitle: English original\ndate: 2026-09-07\n---\nEnglish body\n',
      )
      // 没有译文：回退英文
      expect(availableLocalesFor(slug, dir)).toEqual(['en'])
      expect(getLocalizedPost(slug, 'zh-CN', dir)).toMatchObject({
        status: 'fallback',
        sourceLocale: 'en',
      })
      expect(getLocalizedPost(slug, 'zh-CN', dir)?.post.title).toBe('English original')

      // 造出译文 → 可用语言与状态必须跟着翻（证明机制真的跟着文件走）
      fs.mkdirSync(path.join(dir, 'zh-CN'))
      fs.writeFileSync(
        path.join(dir, 'zh-CN', `${slug}.md`),
        '---\ntitle: 中文译文\ndate: 2026-09-07\n---\n中文正文\n',
      )
      expect(availableLocalesFor(slug, dir)).toEqual(['en', 'zh-CN'])
      const translated = getLocalizedPost(slug, 'zh-CN', dir)
      expect(translated?.status).toBe('translated')
      expect(translated?.sourceLocale).toBe('zh-CN')
      expect(translated?.post.title).toBe('中文译文')
      expect(translated?.post.content).toContain('中文正文')
      expect(listLocalizedPosts('zh-CN', dir).map((item) => item.status)).toEqual(['translated'])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('恶意或非法 slug 绝不被拼进路径：返回空结果', () => {
    const unsafeSlugs = [
      '../../etc/passwd',
      // 2 层向上就是仓库根的 `README.md`：不校验 slug 时它会真被拼出路径并读到（下面还有
      // 临时目录夹具把这一条证明得更死，不靠仓库里碰巧存在的文件）。
      '../../README',
      '..%2f..%2fetc',
      '/etc/passwd',
      'a\u0000b',
      '..',
      'UPPER',
      'a/b',
      'a\\b',
      'a b',
    ]
    for (const slug of unsafeSlugs) {
      const where = `slug=${JSON.stringify(slug)}`
      expect(availableLocalesFor(slug), where).toEqual([])
      expect(getLocalizedPost(slug, 'zh-CN'), where).toBeNull()
      expect(getLocalizedPost(slug, 'en'), where).toBeNull()
    }
    // 合法但不存在的 slug
    expect(availableLocalesFor('no-such-post')).toEqual([])
    expect(getLocalizedPost('no-such-post', 'en')).toBeNull()
  })

  it('被拒绝的 slug 即便能逃出内容目录也读不到文件（临时目录夹具）', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-escape-'))
    try {
      const dir = path.join(base, 'content', 'blog')
      fs.mkdirSync(dir, { recursive: true })
      // 内容目录之外放一个真实文件：slug 一旦参与拼路径，`../../secret` 就会碰到它。
      fs.writeFileSync(
        path.join(base, 'secret.md'),
        '---\ntitle: Secret\ndate: 2026-09-07\n---\nSecret body\n',
      )
      expect(availableLocalesFor('../../secret', dir)).toEqual([])
      expect(getLocalizedPost('../../secret', 'en', dir)).toBeNull()
      expect(getLocalizedPost('../../secret', 'zh-CN', dir)).toBeNull()
    } finally {
      fs.rmSync(base, { recursive: true, force: true })
    }
  })

  it('非法 locale（运行期值来自 URL）不参与拼路径', () => {
    const slug = 'finding-your-evoloop-size'
    expect(getLocalizedPost(slug, '../en' as Locale)).toBeNull()
    expect(listLocalizedPosts('../../' as Locale)).toEqual([])
  })
})
