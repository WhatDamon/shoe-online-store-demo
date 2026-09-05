import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'

/**
 * Blog 内容层：content/blog/*.md（YAML frontmatter + Markdown）。
 *
 * 约定：
 * - 文件名即 slug，须匹配 /^[a-z0-9]+(-[a-z0-9]+)*$/，否则跳过并告警；
 * - frontmatter 必填 title(string)、date('YYYY-MM-DD')；可选 description/cover/tags；
 * - 查找只经目录条目比对，slug 从不拼进文件路径 → 无路径穿越面；
 * - YAML 语法错误 → 抛错（作者笔误要响亮）；缺必填/坏日期 → 跳过并告警（半成品草稿不拖垮全站）。
 * 全站构建期为 SSG（新增/修改文章需重建，与 seed/产品表同约定）。
 */

export interface BlogPost {
  slug: string
  title: string
  /** ISO 日期 'YYYY-MM-DD'（frontmatter date，UTC 语义） */
  date: string
  /** 展示用，如 'Sep 7, 2026'（与日期解析同源，避免双份格式逻辑） */
  dateLabel: string
  description: string | null
  /** 封面（可选）：public 根相对路径，如 '/blog/covers/x.webp'；无封面时索引页用品牌渐变替图 */
  cover: string | null
  tags: string[]
  /** Markdown 正文（渲染层负责转 React 元素，不经 innerHTML） */
  content: string
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
// 严格 ISO 日期：月 01-12、日随月天数；配合 UTC 往返比对防引擎宽松回卷（如 2026-13-99 / 02-31）
const ISO_DATE_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

const isValidISODate = (s: string): boolean => {
  const m = ISO_DATE_RE.exec(s)
  if (!m) return false
  const y = Number(m[1])
  const mo = Number(m[2]) - 1
  const d = Number(m[3])
  return new Date(Date.UTC(y, mo, d)).toISOString().slice(0, 10) === s
}

const defaultDir = (): string => path.join(process.cwd(), 'content', 'blog')

export function formatPostDate(dateISO: string): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${dateISO}T00:00:00Z`))
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : []

/** 解析单个文件。语法错误抛错；元数据不合法返回 null（调用方跳过/404）。 */
function parsePostFile(filePath: string, slug: string): BlogPost | null {
  let parsed: { data: Record<string, unknown>; content: string }
  try {
    const m = matter(fs.readFileSync(filePath, 'utf8'))
    parsed = { data: m.data as Record<string, unknown>, content: m.content }
  } catch (e) {
    throw new Error(`Blog frontmatter parse error in ${filePath}: ${(e as Error).message}`)
  }

  const title = str(parsed.data.title)
  // js-yaml 会把未加引号的 ISO 日期解析成 Date（宽松时间戳：坏日期会被回卷成邻近合法日，
  // 如 2026-02-31 → 2026-03-03）。两种形态都收：字符串走严格正则；Date 转 UTC ISO。
  // 作者想严格校验就在 frontmatter 里给 date 加引号（走字符串分支）。
  const rawDate = parsed.data.date
  let date: string | null = null
  if (rawDate instanceof Date && !Number.isNaN(rawDate.getTime())) {
    const iso = rawDate.toISOString().slice(0, 10)
    if (isValidISODate(iso) && iso >= '1970-01-01' && iso <= '2199-12-31') date = iso
  } else {
    date = str(rawDate)
  }
  if (!title || !date || !isValidISODate(date)) {
    console.warn(`[blog] skipped ${filePath}: need string title + valid 'YYYY-MM-DD' date`)
    return null
  }
  const cover = str(parsed.data.cover)
  return {
    slug,
    title,
    date,
    dateLabel: formatPostDate(date),
    description: str(parsed.data.description),
    cover: cover && cover.startsWith('/') ? cover : null,
    tags: strList(parsed.data.tags),
    content: parsed.content,
  }
}

/** 列出全部文章（日期倒序，同日按 slug）。dir 参数仅测试注入用。 */
export function listPosts(dir: string = defaultDir()): BlogPost[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    console.warn(`[blog] content dir missing: ${dir}`)
    return []
  }
  const posts: BlogPost[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const slug = entry.name.slice(0, -3)
    if (!SLUG_RE.test(slug)) {
      console.warn(`[blog] skipped file name (invalid slug): ${entry.name}`)
      continue
    }
    const post = parsePostFile(path.join(dir, entry.name), slug)
    if (post) posts.push(post)
  }
  posts.sort((a, b) =>
    a.date === b.date ? a.slug.localeCompare(b.slug) : b.date.localeCompare(a.date),
  )
  return posts
}

/** 单篇查询；slug 不合法或不存在 → null（调用方 notFound()）。 */
export function getPost(slug: string): BlogPost | null {
  if (!SLUG_RE.test(slug)) return null
  return listPosts().find((p) => p.slug === slug) ?? null
}
