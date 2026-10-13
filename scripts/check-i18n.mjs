#!/usr/bin/env node
/**
 * i18n 抽取门禁（TypeScript 侧）：防止阶段 1 抽走的文案以字面量形态回退，并锁住两条人工契约。
 *
 * 用法：
 *   npm run check:i18n     # 人读输出，有阻塞项时退出码 1
 *
 * 四条判据（都是机械可判定的；语义判据不在本工具职责内）：
 * 1. `prose-*` —— `src/app/**` 与 `src/components/**` 里的散文类字面量：JSX 文本、文案属性、
 *    字符串与无插值模板字面量。启发式与 `docs/i18n-string-inventory-2026-10-13.md` 的采集方法同款
 *    （去空白长度 ≥3、含字母、不是纯路径形状、且含词间空格或长度 ≥12），便于与清单快照对照。
 * 2. `raw-path` —— 未收口的站内字面量绝对路径。语义与 `src/components/i18n/locale-path-coverage.test.ts`
 *    **逐条一致**（HIT/PASS 规则、AST 走法、豁免清单全部照搬）。那个测试是这套语义的真值来源，
 *    这里是它在门禁里的副本（`.mjs` 不能 import `.ts` 里的实现，只能复制）——**两处要同步变更**。
 * 3. `error-code` —— `backend/app/application/errors.py` 的码字面量与 Route Handler 的 `code`
 *    字面量，必须出现在前端的码联合里，否则要显式进白名单。任务 8 遗留 P2-1：前端的码联合是手写的，
 *    与 Python 常量表没有机械绑定，新增一个后端码不会让 `tsc` 报错，会静默落到 `errors.unknown`。
 * 4. `stale-allowlist` —— 白名单条目自身不许腐烂：路径要在、`text` 要在、登记的码还要在。
 *
 * 判据抓什么、不抓什么（如实登记，不要指望它覆盖更多）：
 * - 抓：JSX 文本节点；文案属性（aria-label / title / placeholder / alt / label / aria-description /
 *   aria-placeholder）；字符串与无插值模板字面量里的散文；`href` / `action` / `router.push|replace` /
 *   `redirect` 上的字面量站内路径。
 * - 不抓（已知检测边界）：`href={var}` / `action={var}` 这类经变量传递的路径（由
 *   `locale-path-coverage.test.ts` 自己的探针兜底）；带插值的模板字符串里的静态文案
 *   （`` `Wishlist, ${n} items` ``，清单快照同样不识别）；不含空格且短于 12 字符的文案（`'Search'`）；
 *   `src/app` 与 `src/components` 之外的文件（`src/lib`、`src/server`、`src/db`、`src/domain`
 *   只做白名单登记与腐烂校验，不做扫描）；后端 `f"{resource}_not_found"` 这类动态拼出的码
 *   （无法静态绑定：`errors.py` 的 `OwnershipDenied` 子类今天会产出 `item_not_found`）。
 * - 特判放过（本就不是文案）：`'use client'` / `'use server'` 指令序言；JSX 的 `className` / `style`
 *   属性；SVG 几何属性（d / points / viewBox / transform / strokeDasharray）；Tailwind/cva 样式串
 *   与内联样式值（全小写、逐 token 是工具类或尺寸值的串）。这些按判据放过，**不占白名单**。
 *
 * 判定逻辑集中在可测的纯函数（scanSource / unlistedErrorCodes / unreadableAllowlistEntries），
 * CLI 只是薄壳。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

// typescript 从本文件所在包解析（而非调用时的 cwd），与 scripts/check-slop.mjs 同款：零新增依赖。
const requireFromHere = createRequire(import.meta.url)
const ts = requireFromHere('typescript')

/**
 * 仓库根用 `process.cwd()`，**不要**用 `new URL(...)` / `import.meta.url`：vitest 把 import.meta.url
 * 转成非 `file:` 协议，`new URL(...)` 会抛「The URL must be of scheme file」
 * （先例：`src/components/i18n/locale-path-coverage.test.ts`）。node 与 vitest 都以仓库根为 cwd。
 */
export const REPO_ROOT = process.cwd()

const SCAN_ROOTS = ['src/app', 'src/components']
const HANDLER_ROOTS = ['src/app/api']
const ALLOWLIST_FILE = 'scripts/i18n-allowlist.json'
const BACKEND_ERRORS_FILE = 'backend/app/application/errors.py'
/** 前端「能不能给这个码专门文案」的码面：两处手写的字面量联合。 */
const FRONTEND_CODE_UNIONS = [
  { file: 'src/lib/commerce-client.ts', type: 'ErrorCode' },
  { file: 'src/domain/chat-events.ts', type: 'ChatErrorCode' },
]
const SKIP_DIR = /^(node_modules|\.next|\.worktrees|\.git|coverage|dist)$/
const SOURCE_FILE = /\.tsx?$/
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/

/**
 * 白名单：`{ path, rule, reason }` 起底，另可按规则给 `text` / `count` / `code`。
 * 逐条必须写 `reason`；散文抑制项必须给 `text`（不许按文件整体放行）。
 *
 * @type {Array<{ path?: string, rule: string, text?: string, count?: number, code?: string, reason: string }>}
 */
export const ALLOWLIST = JSON.parse(readFileSync(path.join(REPO_ROOT, ALLOWLIST_FILE), 'utf8'))

// ---------------------------------------------------------------------------
// 散文判据
// ---------------------------------------------------------------------------

/** 纯路径/URL 形状的串（清单快照同款排除项）。 */
const PURE_PATH_SHAPE = /^[\w./@:%#?&=+~^{}-]+$/
/** React/Next 指令序言，不是文案。 */
const DIRECTIVES = new Set(['use client', 'use server'])
/** 文案属性（清单快照同款清单）。 */
const COPY_ATTRS = new Set([
  'aria-label',
  'title',
  'placeholder',
  'alt',
  'label',
  'aria-description',
  'aria-placeholder',
])
/** SVG 几何属性，不是文案。 */
const SVG_GEOMETRY_ATTRS = new Set(['d', 'points', 'viewBox', 'transform', 'strokeDasharray'])
/** 样式属性，不是文案。 */
const STYLE_ATTRS = new Set(['className', 'style'])
/** 尺寸值 token（`84px`、`96px`、`150%`）：整串都是尺寸值时按内联样式放过。 */
const DIMENSION_TOKEN = /^\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw|fr|deg|s|ms)?$/
/** Tailwind/cva 工具类 token 允许的字符集（含任意值语法里的 `_`、`[]()` 与变体分隔符）。 */
const UTILITY_TOKEN = /^[a-z0-9_\[\](){}#%,;:/'"!*+=~^$.@<>&-]+$/

/**
 * 清单快照同款散文启发式。假阴性是它的固有属性（见文件头「不抓」一节），
 * 不要为了「多抓一点」把它放宽成会误报的形状。
 */
function isProse(text) {
  const trimmed = text.trim()
  return (
    trimmed.length >= 3 &&
    /[A-Za-z]/.test(trimmed) &&
    !PURE_PATH_SHAPE.test(trimmed) &&
    (/\s/.test(trimmed) || trimmed.length >= 12)
  )
}

/**
 * Tailwind/cva 样式串与内联样式值：全小写，且逐 token 是工具类或尺寸值。
 * 这一条替任务 10 点名的 55 条样式串（className 属性、cva 变体表、`*_CLASS` 常量）挡掉命中，
 * 而不是把它们塞进白名单——样式串改语言不改它，白名单条目应当留给「本可能是文案」的串。
 * 已知假阴性：全小写、含连字符或变体冒号的类工具类词串（如 `out-of-stock`）会被这里放过。
 * 末一条判据要求串里至少有一个 token 带 `-` 或 `:`：纯小写单词序列（`while supplies last`）与
 * 单位片段（`/ pair`）都不满足它，仍然会被报出来。
 */
function isStyleTokenString(text) {
  const trimmed = text.trim()
  if (trimmed === '' || /[A-Z]/.test(trimmed)) return false
  const tokens = trimmed.split(/\s+/)
  if (tokens.every((token) => DIMENSION_TOKEN.test(token))) return true
  if (!tokens.every((token) => UTILITY_TOKEN.test(token))) return false
  return tokens.some((token) => token.includes('-') || token.includes(':'))
}

/** 这个字面量是否算「可能是用户文案」（同时满足散文启发式、又不是样式串）。 */
function isCopyText(text) {
  return isProse(text) && !isStyleTokenString(text)
}

// ---------------------------------------------------------------------------
// 裸路径判据：与 src/components/i18n/locale-path-coverage.test.ts 同一套语义（照搬）
// ---------------------------------------------------------------------------

const RULE_RAW_PATH = 'raw-path'
const INTERNAL_PATH = /^\/(?:[a-z]|$)/
const LOCALIZED_ELEMENT = 'LocaleLink'
const LOCALE_WRAPPER = 'localePath'

/**
 * 「未收口的站内路径」的检测语义（与 `locale-path-coverage.test.ts` 逐条一致）：
 * 命中 `href` / `action` 属性或 `router.push|replace` / `redirect` 调用里以 `/` + 小写字母
 * （或裸 `'/'`）开头的字面量，且未被 `localePath(...)` 包裹、也不是 `LocaleLink` 的属性。
 * `#` 锚点、`mailto:` / `tel:`、绝对 URL 天然不命中。JSX 属性的初始化表达式会被下探
 * （`onClick={() => router.push('/shop')}` 属命中）。经变量传递的字面量不判定。
 *
 * @param {string} fileName
 * @param {string} source
 * @returns {Array<{ rule: string, line: number, text: string }>}
 */
function rawPaths(fileName, source) {
  const scriptKind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind)
  const findings = []

  const record = (node) => {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart(file))
    findings.push({ rule: RULE_RAW_PATH, line: line + 1, text: node.getText(file) })
  }

  /** 收集一段表达式里的裸路径字面量；`localePath(...)` 的实参整棵子树跳过。 */
  const collect = (node) => {
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
  const isNavigationCall = (node) => {
    const callee = node.expression
    if (ts.isIdentifier(callee)) return callee.text === 'redirect'
    if (ts.isPropertyAccessExpression(callee)) {
      return (
        callee.expression.getText(file) === 'router' && /^(push|replace)$/.test(callee.name.text)
      )
    }
    return false
  }

  const visit = (node) => {
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
        return
      }
      node.forEachChild(visit)
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

// ---------------------------------------------------------------------------
// 单文件扫描：散文 + 裸路径
// ---------------------------------------------------------------------------

const MODULE_SPECIFIER_PARENTS = new Set([
  'ImportDeclaration',
  'ExportDeclaration',
  'ImportSpecifier',
  'ExportSpecifier',
  'ImportTypeNode',
  'ExternalModuleReference',
])

/**
 * 单文件扫描。纯函数：不读磁盘、不看其它文件，便于用假源码做回归测试。
 *
 * @param {string} source 文件内容
 * @param {string} fileName 文件名（只用于选 TSX/TS ScriptKind 与指令序言判定）
 * @returns {Array<{ rule: string, line: number, text: string }>} 按行号、规则名排序的命中
 */
export function scanSource(source, fileName) {
  const scriptKind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.ESNext, true, scriptKind)
  const findings = []
  const lineOf = (node) => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1
  const report = (rule, node, text) => findings.push({ rule, line: lineOf(node), text })

  /** 指令序言（只能是文件的第一条语句，`'use client'` / `'use server'`）。 */
  const isDirective = (node) =>
    DIRECTIVES.has(node.text) &&
    ts.isExpressionStatement(node.parent) &&
    file.statements[0] === node.parent

  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const text = node.text.replace(/\s+/g, ' ').trim()
      if (text && isCopyText(text)) report('prose-jsx-text', node, text)
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(file)
      if (STYLE_ATTRS.has(name) || SVG_GEOMETRY_ATTRS.has(name)) return
      const initializer = node.initializer
      if (
        initializer !== undefined &&
        ts.isStringLiteral(initializer) &&
        COPY_ATTRS.has(name) &&
        isCopyText(initializer.text)
      ) {
        report('prose-attr', node, initializer.text)
        return
      }
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const direct = ts.isJsxAttribute(node.parent)
      const specifier = MODULE_SPECIFIER_PARENTS.has(node.parent.kind)
      if (!direct && !specifier && !isDirective(node) && isCopyText(node.text)) {
        report('prose-literal', node, node.text)
      }
    }
    node.forEachChild(visit)
  }
  visit(file)

  return findings
    .concat(rawPaths(fileName, source))
    .sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule))
}

// ---------------------------------------------------------------------------
// 错误码判据：后端 / Route Handler 的码 ↔ 前端码联合
// ---------------------------------------------------------------------------

/**
 * `CommerceError.__init__(code, status_code, message)` 的第一个实参就是码，故要求码后面紧跟
 * HTTP 状态码：这样 `OwnershipDenied("item")` 这类把 resource 传给父类构造器的调用不会被当成码。
 * `f"{resource}_not_found"` 动态码不匹配（见文件头的边界说明）。
 */
const BACKEND_CODE_LITERAL = /super\(\)\.__init__\(\s*["']([a-z][a-z0-9_]*)["']\s*,\s*\d+/g
const CODE_LITERAL = /^[a-z][a-z0-9_]*$/

/**
 * 契约侧（后端 + Route Handler）的码字面量。
 *
 * @param {string} root 仓库根
 * @returns {{ backend: string[], handlers: string[] }}
 */
export function readContractErrorCodes(root) {
  const errorsPy = readFileSync(path.join(root, BACKEND_ERRORS_FILE), 'utf8')
  const backend = [...errorsPy.matchAll(BACKEND_CODE_LITERAL)].map((match) => match[1])
  const handlers = []
  for (const file of collectSources(root, HANDLER_ROOTS)) {
    for (const code of handlerCodes(readFileSync(path.join(root, file), 'utf8'), file)) {
      handlers.push(code)
    }
  }
  return { backend: uniqueSorted(backend), handlers: uniqueSorted(handlers) }
}

/** Route Handler 响应体里的 `code: '<字面量>'`（含 SSE 帧里的 `code`）。 */
function handlerCodes(source, fileName) {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)
  const codes = []
  const visit = (node) => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'code' &&
      ts.isStringLiteral(node.initializer) &&
      CODE_LITERAL.test(node.initializer.text)
    ) {
      codes.push(node.initializer.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return codes
}

/**
 * 前端码面：两处手写字面量联合里的码。
 *
 * @param {string} root 仓库根
 * @returns {string[]}
 */
export function readFrontendErrorCodes(root) {
  const codes = []
  for (const { file, type } of FRONTEND_CODE_UNIONS) {
    const source = readFileSync(path.join(root, file), 'utf8')
    codes.push(...unionLiterals(source, file, type))
  }
  return uniqueSorted(codes)
}

/** 取一个字面量联合（`type X = 'a' | 'b'`）里的成员。 */
function unionLiterals(source, fileName, typeName) {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)
  const codes = []
  for (const statement of file.statements) {
    if (!ts.isTypeAliasDeclaration(statement) || statement.name.text !== typeName) continue
    const members = ts.isUnionTypeNode(statement.type) ? statement.type.types : [statement.type]
    for (const member of members) {
      if (ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal)) {
        codes.push(member.literal.text)
      }
    }
  }
  return codes
}

/**
 * 契约里有、但前端联合与白名单都没有的码。这些码会静默落到 `errors.unknown`。
 *
 * @param {{ backend: string[], handlers: string[] }} contract
 * @param {string[]} frontend
 * @param {Array<{ rule: string, code?: string }>} allowlist
 * @returns {Array<{ rule: string, code: string, source: string }>}
 */
export function unlistedErrorCodes(contract, frontend, allowlist) {
  const known = new Set(frontend)
  const allowed = new Set(
    allowlist.filter((entry) => entry.rule === 'error-code').map((entry) => entry.code),
  )
  const findings = []
  const sides = [
    ['backend', contract.backend],
    ['handlers', contract.handlers],
  ]
  for (const [source, codes] of sides) {
    for (const code of codes) {
      if (!known.has(code) && !allowed.has(code)) {
        const where = source === 'backend' ? '后端 errors.py' : 'Route Handler'
        findings.push({
          rule: 'error-code',
          line: 0,
          code,
          source,
          text: `${where} 产出码 ${code}，它不在前端码联合里、也没登记进白名单（会静默落到 errors.unknown）`,
        })
      }
    }
  }
  return findings.sort((a, b) => a.source.localeCompare(b.source) || a.code.localeCompare(b.code))
}

// ---------------------------------------------------------------------------
// 白名单腐烂校验
// ---------------------------------------------------------------------------

/**
 * 白名单条目自身的校验：路径要在、`text` 要在、登记的码要在，散文抑制项必须给出 `text`。
 * 没有这一条，范围外（`src/lib` / `src/server` / `src/db`）的「内部文案登记」就只是注释，
 * 会随着代码演化静默腐烂。
 *
 * @param {Array<{ path?: string, rule: string, text?: string, count?: number, code?: string, reason?: string }>} allowlist
 * @param {string} root 仓库根
 * @returns {Array<{ rule: string, file: string, line: number, text: string }>}
 */
export function unreadableAllowlistEntries(allowlist, root) {
  const findings = []
  const cache = new Map()
  const read = (relative) => {
    if (!cache.has(relative)) {
      const absolute = path.join(root, relative)
      cache.set(
        relative,
        existsSync(absolute) && statSync(absolute).isFile() ? readFileSync(absolute, 'utf8') : null,
      )
    }
    return cache.get(relative)
  }
  const reject = (label, message) => {
    findings.push({ rule: 'stale-allowlist', file: label, line: 1, text: message })
  }
  let contractCodes = null
  const readContractCodes = () => {
    if (contractCodes === null) {
      const contract = readContractErrorCodes(root)
      contractCodes = new Set([...contract.backend, ...contract.handlers])
    }
    return contractCodes
  }

  for (const entry of allowlist) {
    const label = entry.path ?? entry.code ?? '(未命名条目)'
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      reject(label, '白名单条目缺少 reason')
      continue
    }
    if (entry.rule === 'error-code') {
      if (!entry.code || !readContractCodes().has(entry.code)) {
        reject(label, `登记的码 ${entry.code ?? '(缺失)'} 已不在后端/Route Handler 的码里`)
      }
      continue
    }
    if (!entry.path) {
      reject(label, '条目既没有 path 也没有 code')
      continue
    }
    const source = read(entry.path)
    if (source === null) {
      reject(label, `${entry.path} 不存在`)
      continue
    }
    if (entry.rule.startsWith('prose') && !entry.text) {
      reject(label, '散文抑制项必须给出 text（不许按文件整体放行）')
      continue
    }
    if (entry.text && !source.includes(entry.text)) {
      reject(label, `登记的 text 已不在 ${entry.path} 里：${entry.text.slice(0, 60)}`)
      continue
    }
    if (entry.count !== undefined) {
      const actual = scanSource(source, entry.path).filter((finding) =>
        finding.rule.startsWith('prose'),
      ).length
      if (actual !== entry.count) {
        reject(
          label,
          `${entry.path} 的散文类字面量数：登记 ${entry.count}，实际 ${actual}，请复核归类`,
        )
      }
      continue
    }
    if (entry.rule === 'internal-copy' && !entry.text && entry.count === undefined) {
      reject(label, '内部文案登记项必须给出 text 或 count')
    }
  }
  return findings
}

// ---------------------------------------------------------------------------
// 仓库遍历与 CLI
// ---------------------------------------------------------------------------

/** 列出要扫描的源文件（仓库相对路径，`/` 分隔）。 */
function collectSources(root, roots) {
  const collected = []
  const walk = (absolute, relative) => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const childRelative = `${relative}/${entry.name}`
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && !SKIP_DIR.test(entry.name)) {
          walk(path.join(absolute, entry.name), childRelative)
        }
        continue
      }
      if (SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) collected.push(childRelative)
    }
  }
  for (const relative of roots) {
    const absolute = path.join(root, relative)
    if (existsSync(absolute) && statSync(absolute).isDirectory()) walk(absolute, relative)
  }
  return collected.sort()
}

function uniqueSorted(values) {
  return [...new Set(values)].sort()
}

function allowlisted(file, finding, allowlist) {
  return allowlist.some(
    (entry) =>
      entry.path === file &&
      entry.rule === finding.rule &&
      entry.text !== undefined &&
      entry.text === finding.text,
  )
}

/** 扫描入口。返回 `{ findings, suppressed }`，findings 为空表示门禁通过。 */
function analyze() {
  const findings = []
  let suppressed = 0
  for (const file of collectSources(REPO_ROOT, SCAN_ROOTS)) {
    const source = readFileSync(path.join(REPO_ROOT, file), 'utf8')
    for (const finding of scanSource(source, file)) {
      if (allowlisted(file, finding, ALLOWLIST)) {
        suppressed += 1
        continue
      }
      findings.push({ ...finding, file })
    }
  }
  findings.push(
    ...unlistedErrorCodes(
      readContractErrorCodes(REPO_ROOT),
      readFrontendErrorCodes(REPO_ROOT),
      ALLOWLIST,
    ).map((finding) => ({
      ...finding,
      file: finding.source === 'backend' ? BACKEND_ERRORS_FILE : 'src/app/api/**',
    })),
  )
  findings.push(...unreadableAllowlistEntries(ALLOWLIST, REPO_ROOT))
  return { findings, suppressed }
}

function main() {
  let result
  try {
    result = analyze()
  } catch (error) {
    console.error(`check:i18n 无法完成扫描：${error instanceof Error ? error.message : error}`)
    return 2
  }
  const { findings, suppressed } = result
  if (findings.length > 0) {
    console.log(`\n阻塞项（${findings.length}）`)
    for (const finding of findings) {
      const where = finding.line > 0 ? `${finding.file}:${finding.line}` : finding.file
      console.log(`  ${where}  [${finding.rule}] ${finding.text}`)
    }
  }
  const internal = ALLOWLIST.filter((entry) => entry.rule === 'internal-copy').length
  const codes = ALLOWLIST.filter((entry) => entry.rule === 'error-code').length
  console.log(
    `\ncheck:i18n: ${findings.length} 项阻塞命中（白名单抑制 ${suppressed} 项、内部文案登记 ${internal} 项、错误码白名单 ${codes} 项）。`,
  )
  console.log(
    '本工具只覆盖机械判据：散文启发式会漏掉不含空格且短于 12 字符的文案与带插值的模板文案；' +
      'src/app 与 src/components 之外的文件不做扫描。不要因为通过就认为没有未抽取的文案。',
  )
  return findings.length > 0 ? 1 : 0
}

if (path.resolve(process.argv[1] ?? '') === path.join(REPO_ROOT, 'scripts/check-i18n.mjs')) {
  process.exit(main())
}
