import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// 用 process.cwd() 而非 import.meta.url：vitest 把 import.meta.url 转成非 file: 协议，
// `new URL(..., import.meta.url)` 会报「The URL must be of scheme file」（同
// src/test/a11y/contrast.test.ts 的处理）。vitest 以仓库根为 cwd。
const SRC = join(process.cwd(), 'src')

/**
 * 「未收口的站内路径」的检测语义（任务 11 的 `check-i18n` 的 raw-path 规则必须与此一致）。
 *
 * 命中条件：`href` / `action` 属性或 `router.push` / `router.replace` / `redirect` 调用的参数里，
 * 存在以 `/` 开头的字面量（字符串或模板字面量：`/` + 小写字母，或裸 `'/'` 这一根路径本身），
 * 且该字面量**未被收口**。
 *
 * 裸 `'/'` 也在检测面内：它是站内最常见的绝对路径，`href="/"` 同样必须走 `localePath`（`/` → `/en`）。
 *
 * 两种收口写法放行（它们是唯一的正确写法，判成命中会让守卫自相矛盾）：
 * 1. 字面量被 `localePath(...)` 包裹 —— 前缀在调用处补上；
 * 2. 字面量是 `LocaleLink` 的属性 —— 前缀由组件补上（`next/link` 不会补）。
 *
 * `#` 锚点、`mailto:` / `tel:`、绝对 URL、`//host` 前缀天然不以 `/` + 小写字母开头，不算命中；
 * `/#collections` 这类「根路径带锚点」的站内路径沿用同一口径也不命中（词法上无法与纯锚点区分）。
 *
 * 已知检测面之外（与简报原正则相同，故不扩大守卫的假承诺）：经变量间接传递的字面量
 * （`const href = '/shop'` 后 `href={href}`）不在此处判定。
 */
const RULE_RAW_PATH = 'raw-path'
const INTERNAL_PATH = /^\/(?:[a-z]|$)/
const LOCALIZED_ELEMENT = 'LocaleLink'
const LOCALE_WRAPPER = 'localePath'

interface Finding {
  rule: string
  line: number
  text: string
}

/** 解析单个文件，返回所有未收口的站内路径。 */
function rawPaths(fileName: string, source: string): Finding[] {
  const scriptKind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind)
  const findings: Finding[] = []

  const record = (node: ts.Node) => {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart(file))
    findings.push({ rule: RULE_RAW_PATH, line: line + 1, text: node.getText(file) })
  }

  /** 收集一段表达式里的裸路径字面量；`localePath(...)` 的实参整棵子树跳过。 */
  const collect = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(file) === LOCALE_WRAPPER) return
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (INTERNAL_PATH.test(node.text)) record(node)
      return
    }
    if (ts.isTemplateExpression(node)) {
      if (INTERNAL_PATH.test(node.head.text)) record(node.head)
      node.templateSpans.forEach((span) => collect(span.expression))
      return
    }
    node.forEachChild(collect)
  }

  /** 走的是命令式跳转：`router.push` / `router.replace` / `redirect`。 */
  const isNavigationCall = (node: ts.CallExpression): boolean => {
    const callee = node.expression
    if (ts.isIdentifier(callee)) return callee.text === 'redirect'
    if (ts.isPropertyAccessExpression(callee)) {
      return (
        callee.expression.getText(file) === 'router' && /^(push|replace)$/.test(callee.name.text)
      )
    }
    return false
  }

  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(file)
      const element = node.parent.parent
      const tagName =
        ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element)
          ? element.tagName.getText(file)
          : null
      if (
        (name === 'href' || name === 'action') &&
        node.initializer !== undefined &&
        tagName !== LOCALIZED_ELEMENT
      ) {
        collect(node.initializer)
      }
      return
    }
    if (ts.isCallExpression(node) && isNavigationCall(node)) {
      node.arguments.forEach(collect)
      return
    }
    node.forEachChild(visit)
  }

  visit(file)
  return findings
}

/** 递归收集源码文件（排除测试文件：测试里的 URL 期望值不是站内链接未收口）。 */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full)) out.push(full)
  }
  return out
}

const probe = (source: string) => rawPaths('probe.tsx', source).map((finding) => finding.rule)

describe('站内路径已收口', () => {
  // 零命中断言只在检测面本身有效时才有意义：先钉住「该命中的命中、该放行的放行」。
  it('检测面覆盖字面量与 JSX 表达式字面量', () => {
    expect(probe('<Link href="/shop">x</Link>')).toEqual([RULE_RAW_PATH])
    expect(probe("<Link href='/shop'>x</Link>")).toEqual([RULE_RAW_PATH])
    expect(probe('<Link href={"/shop"}>x</Link>')).toEqual([RULE_RAW_PATH])
    expect(probe("<Link href={'/shop'}>x</Link>")).toEqual([RULE_RAW_PATH])
    expect(probe('<Link href={`/blog/${post.slug}`}>x</Link>')).toEqual([RULE_RAW_PATH])
    expect(probe('<a href="/shop">x</a>')).toEqual([RULE_RAW_PATH])
    expect(probe('<Link href="/">x</Link>')).toEqual([RULE_RAW_PATH])
    expect(probe('<form action="/shop" />')).toEqual([RULE_RAW_PATH])
    expect(probe('<form action={"/shop"} />')).toEqual([RULE_RAW_PATH])
    expect(probe("router.replace('/shop')")).toEqual([RULE_RAW_PATH])
    expect(probe('router.push(`/shop?q=1`)')).toEqual([RULE_RAW_PATH])
    expect(probe("redirect('/shop')")).toEqual([RULE_RAW_PATH])
    // 同一文件里多处命中都要报，不能只报第一处
    expect(probe('<a href="/a">1</a><a href="/b">2</a>')).toEqual([RULE_RAW_PATH, RULE_RAW_PATH])
  })

  it('放行 LocaleLink 属性与 localePath 包裹，以及站外链接与纯锚点', () => {
    expect(probe('<LocaleLink href="/shop">x</LocaleLink>')).toEqual([])
    expect(probe('<LocaleLink href={"/shop"}>x</LocaleLink>')).toEqual([])
    expect(probe('<LocaleLink href={`/product/${row.handle}`}>x</LocaleLink>')).toEqual([])
    expect(probe('<LocaleLink action="/shop">x</LocaleLink>')).toEqual([])
    expect(probe("<Link href={localePath(locale, '/shop')}>x</Link>")).toEqual([])
    expect(probe('<Link href={localePath(locale, `/blog/${post.slug}`)}>x</Link>')).toEqual([])
    expect(probe("router.replace(localePath(locale, qs ? `/shop?${qs}` : '/shop'))")).toEqual([])
    expect(probe("redirect(localePath(locale, '/shop'))")).toEqual([])
    expect(probe('<Link href={href}>x</Link>')).toEqual([])
    expect(probe('<LocaleLink href="/">Home</LocaleLink>')).toEqual([])
    expect(probe("<Link href={localePath(locale, '/')}>Home</Link>")).toEqual([])
    expect(probe('<a href="#main">Skip</a>')).toEqual([])
    expect(probe('<a href="mailto:hello@evoloop.site">Mail</a>')).toEqual([])
    expect(
      probe('<a href="https://github.com/WhatDamon/shoe-online-store-demo">Source</a>'),
    ).toEqual([])
  })

  it('组件与页面里没有裸的字面量站内路径', () => {
    const offenders = walk(join(SRC, 'components'))
      .concat(walk(join(SRC, 'app')))
      .flatMap((file) => {
        const hits = rawPaths(file, readFileSync(file, 'utf8'))
        return hits.map((hit) => `${relative(SRC, file)}:${hit.line} ${hit.text}`)
      })
    expect(offenders).toEqual([])
  })
})
