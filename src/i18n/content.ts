/**
 * 内容可用性的**纯词汇层**：只说「这篇文章在这个语言下有没有译文」。
 *
 * 文件系统 IO 住在 `src/lib/blog.ts`，这里只放纯词汇，让 sitemap/metadata 这些不同层
 * 都能引用而不引入 IO。
 *
 * 因此本模块与 `./locales` 同规矩：不导入 `node:fs` / `node:path`、不导入 React、
 * 不导入 `src/server/**` 或 `src/lib/**`、不读 `process.env`。`LocalizedPost` 用泛型 `T`
 * 而不是直接引用 `BlogPost`——那会让 `src/i18n` 依赖 `src/lib`，破坏本层不变量。
 */
import type { Locale } from './locales'

/** 内容在某语言下的可用性：`translated` 有该语言正文，`fallback` 渲染 `sourceLocale` 的正文。 */
export type ContentStatus = 'translated' | 'fallback'

/**
 * 一条内容 + 它在该语言下的可用性。`post` 可能是目标语言的正文（`translated`），
 * 也可能是回退的 `sourceLocale` 正文（`fallback`）——消费者据 `status` 决定提示与索引资格。
 */
export type LocalizedPost<T> = {
  post: T
  status: ContentStatus
  sourceLocale: Locale
}
