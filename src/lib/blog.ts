import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import type { LocalizedPost } from '@/i18n/content'
import { DEFAULT_LOCALE, LOCALES, isLocale, type Locale } from '@/i18n/locales'

/**
 * Blog 内容层：content/blog/*.md（YAML frontmatter + Markdown）。
 *
 * 约定：
 * - 文件名即 slug，须匹配 /^[a-z0-9]+(-[a-z0-9]+)*$/，否则跳过并告警；
 * - frontmatter 必填 title(string)、date('YYYY-MM-DD')；可选 description/cover/tags；
 * - 查找只经目录条目比对，slug 从不拼进文件路径 → 无路径穿越面；
 * - 多语言按目录分：默认语言正文在 `<dir>/<slug>.md`，其它语言在 `<dir>/<locale>/<slug>.md`。
 *   查询入口（`availableLocalesFor` / `getLocalizedPost` / `listLocalizedPosts`）**先校验 slug 与
 *   locale** 再决定路径，所以「slug/locale 拼路径」这一面被收在这里，而不是散到调用方；
 * - YAML 语法错误 → 抛错（作者笔误要响亮）；缺必填/坏日期 → 跳过并告警（半成品草稿不拖垮全站）。
 * 全站构建期为 SSG（新增/修改文章需重建，与 seed/产品表同约定）。
 *
 * **本层只产出事实（`date`），不产出展示标签**：曾经的 `BlogPost.dateLabel` 由 `parsePostFile`
 * 在只有日期字符串时算好（那时不知道 locale），渲染层直接取用 → 中文页必然显示英文日期，
 * 且没有任何类型或测试能发现。现在日期标签一律在渲染点用 `formatPostDate(post.date, locale)`
 * 现算（定义在 `src/lib/format.ts`，本文件既不复算也不 re-export）。
 */

export interface BlogPost {
  slug: string
  title: string
  /** ISO 日期 'YYYY-MM-DD'（frontmatter date，UTC 语义）——渲染层按 locale 格式化的输入 */
  date: string
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

/**
 * 某个语言下某篇文章的文件路径。**只在 slug 与 locale 都校验过之后调用**：
 * 这里是全文件唯一把外部输入拼进路径的地方。不校验 locale 时，运行期值（来自 URL）
 * 会把 `..` 之类拼进目录段；不校验 slug 时 `../../x` 会逃出内容目录。
 */
const postPath = (locale: Locale, slug: string, dir: string): string =>
  locale === DEFAULT_LOCALE ? path.join(dir, `${slug}.md`) : path.join(dir, locale, `${slug}.md`)

/** 读取指定语言的正文；不存在返回 null。调用方保证 slug/locale 已校验。 */
function readPost(locale: Locale, slug: string, dir: string): BlogPost | null {
  const file = postPath(locale, slug, dir)
  if (!fs.existsSync(file)) return null
  return parsePostFile(file, slug)
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

/**
 * 某篇文章实际存在的语言集合，按 `LOCALES` 顺序。
 * slug 不合法或文章不存在（连默认语言都没有）→ `[]`。
 *
 * 这是「回退页不进 sitemap、不发 hreflang」的判定输入（阶段 3 接缝在 `alternatesFor`）。
 */
export function availableLocalesFor(slug: string, dir: string = defaultDir()): Locale[] {
  // 外部输入先过 slug：不通过就当不存在，绝不拼路径。
  if (!SLUG_RE.test(slug)) return []
  return LOCALES.filter((locale) => fs.existsSync(postPath(locale, slug, dir)))
}

/**
 * 取某语言下的文章：有该语言正文 → `translated`；否则回退默认语言正文 → `fallback`。
 *
 * 回退优先于缺失（文件头与 `CONTEXT.md`「内容回退状态」）：宁可给英文原文并显式提示，
 * 也不留白。连默认语言都没有 → `null`（调用方 notFound()）。
 */
export function getLocalizedPost(
  slug: string,
  locale: Locale,
  dir: string = defaultDir(),
): LocalizedPost<BlogPost> | null {
  // `Locale` 类型不够：运行期值来自 URL，非法 locale 不得用于拼路径。
  if (!isLocale(locale)) return null
  if (!SLUG_RE.test(slug)) return null
  const available = availableLocalesFor(slug, dir)
  // 目标语言不在可用集合里时回退默认语言；默认语言也没有 → 文章不存在。
  const sourceLocale: Locale = available.includes(locale) ? locale : DEFAULT_LOCALE
  const post = readPost(sourceLocale, slug, dir)
  if (!post) return null
  return { post, status: sourceLocale === locale ? 'translated' : 'fallback', sourceLocale }
}

/**
 * 博客索引用的列表：默认语言的每篇文章都有一条，语言缺失的条目以 `fallback` 标出。
 * 条目顺序与 `listPosts` 一致（日期倒序，同日按 slug）。
 */
export function listLocalizedPosts(
  locale: Locale,
  dir: string = defaultDir(),
): LocalizedPost<BlogPost>[] {
  if (!isLocale(locale)) return []
  return listPosts(dir).map((post) => {
    const translated = locale === DEFAULT_LOCALE ? post : readPost(locale, post.slug, dir)
    return translated
      ? { post: translated, status: 'translated', sourceLocale: locale }
      : { post, status: 'fallback', sourceLocale: DEFAULT_LOCALE }
  })
}
