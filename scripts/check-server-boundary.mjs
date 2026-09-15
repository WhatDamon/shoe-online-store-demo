#!/usr/bin/env node
// 边界守卫：'use client' 模块不得**运行时** import src/server/**。
//
// 为什么需要脚本而不是靠自觉：Next.js 的 'use client' 并不阻止你 import 服务端模块 ——
// 打包器照单全收，把 DB 驱动、AI SDK、env 读取代码打进浏览器包（体积泄漏；部分模块还会在
// 浏览器里抛「意图在服务端使用」）。类型 import 编译期即擦除，所以 `import type` 与内联
// `type` 限定符是允许的。
//
// 共享契约请放进 src/domain/（两端共用的纯层）。这里没有例外清单 —— 一旦需要例外，
// 说明该模块站错了层。
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

const SRC = 'src'
const SERVER_PREFIX = `${SRC}/server/`
// 匹配 `import[ type] <clause> from '<spec>'`，clause 可跨行（具名导入换行很常见）。
const IMPORT_RE = /^import\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  )

/** 说明符 → 仓库内路径；外部包返回 null。 */
const resolveSpec = (spec, fromFile) => {
  if (spec.startsWith('@/')) return normalize(join(SRC, spec.slice(2)))
  if (spec.startsWith('.')) return normalize(join(dirname(fromFile), spec))
  return null
}

/** `import { type A, type B }` 全部内联 type 限定，等价于 import type。 */
const isTypeOnlyClause = (clause) => {
  const inner = clause.trim()
  if (!inner.startsWith('{')) return false
  const names = inner
    .slice(1, -1)
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  return names.length > 0 && names.every((name) => name.startsWith('type '))
}

const offenders = []

for (const file of walk(SRC)) {
  if (!/\.(ts|tsx)$/.test(file)) continue
  const source = readFileSync(file, 'utf8')
  if (!/^\s*['"]use client['"]/.test(source)) continue
  for (const [, typeKeyword, clause, spec] of source.matchAll(IMPORT_RE)) {
    const target = resolveSpec(spec, file)
    if (!target || !target.replace(/\\/g, '/').startsWith(SERVER_PREFIX)) continue
    if (typeKeyword || isTypeOnlyClause(clause)) continue
    offenders.push(`${file}: ${clause.replace(/\s+/g, ' ').trim()} <- ${spec}`)
  }
}

if (offenders.length > 0) {
  console.error("✖ server boundary violated — 'use client' 模块不得运行时 import src/server/**:\n")
  for (const offender of offenders) console.error(`  ${offender}`)
  console.error(`\n共 ${offenders.length} 处。共享契约请移入 src/domain/，或改用 \`import type\`。`)
  process.exit(1)
}
console.log("✓ server boundary clean ('use client' 模块无运行时 src/server/** 依赖)")
