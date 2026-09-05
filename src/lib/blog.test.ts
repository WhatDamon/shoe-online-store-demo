import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { formatPostDate, getPost, listPosts } from './blog'

// Blog 内容层测试：真实 content/blog/ 单篇示例 + tmpdir 夹具验证容错分支。
describe('blog content layer', () => {
  it('lists the committed example post with parsed metadata', () => {
    const posts = listPosts()
    expect(posts.length).toBeGreaterThanOrEqual(1)
    const post = posts[0]
    expect(post.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    expect(post.title.length).toBeGreaterThan(0)
    expect(post.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(post.dateLabel).toMatch(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/)
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
    expect(formatPostDate('2026-09-07')).toBe('Sep 7, 2026')
    expect(formatPostDate('2026-01-03')).toBe('Jan 3, 2026')
  })
})
