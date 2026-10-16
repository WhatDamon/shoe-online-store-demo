// @vitest-environment node
/**
 * check-i18n 的回归测试：这套门禁今天的契约是「0 阻塞命中」，所以测试的重点不是「能通过」，
 * 而是**每个判据都会红**——散文判据、裸路径判据、后端错误码差集、白名单腐烂校验各自都有负向对照。
 *
 * 文件名是 `.test.ts`（简报写的是 `.test.mjs`）：vitest 的 include 只收 `src` 下的 `.test.{ts,tsx}`
 * 与 `scripts` 下的 `.test.ts`（`vitest.config.ts`），`.test.mjs` 不会被发现。改 vitest 配置不在本任务
 * 的授权范围（只允许改 package.json 的 scripts），而「测试跑不起来」与「必须有负向对照」直接冲突，
 * 故按既有先例（`scripts/check-slop.test.ts`）用 `.test.ts`。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ALLOWLIST,
  REPO_ROOT,
  analyze,
  collectSources,
  readContractErrorCodes,
  readFrontendErrorCodes,
  scanSource,
  unlistedErrorCodes,
  unreadableAllowlistEntries,
  unusedAllowlistEntries,
} from './check-i18n.mjs'

const probe = (source: string, fileName = 'probe.tsx') => scanSource(source, fileName)
const rulesOf = (source: string, fileName = 'probe.tsx') =>
  probe(source, fileName).map((finding) => finding.rule)

/**
 * 负向对照是这套门禁唯一有意义的证据：`check:i18n` 今天的契约是「0 阻塞命中」，
 * 而 0 命中在判据失效时同样成立。下面每个 describe 都先钉住「该命中的真的命中」。
 */
describe('check-i18n：散文判据', () => {
  it('识别 JSX 文本里的散文', () => {
    expect(rulesOf('export const A = () => <p>Hello there</p>')).toEqual(['prose-jsx-text'])
  })

  it('识别文案属性', () => {
    // 按 rule 名断言（不是只数命中数）：命中数相同、规则张冠李戴时也要变红。
    expect(rulesOf('export const A = () => <img alt="Nice shoes" />')).toEqual(['prose-attr'])
    expect(rulesOf('export const A = () => <button aria-label="Close the panel" />')).toEqual([
      'prose-attr',
    ])
  })

  it('识别字符串里的散文，以及折叠空白后的多行 JSX 文本', () => {
    expect(
      probe("throw new Error('Chat stream ended before a terminal event')", 'a.ts'),
    ).toHaveLength(1)
    expect(
      probe(
        'export const A = () => <p>\n  It may have moved, or the link may be out of\n  date.\n</p>',
      ),
    ).toHaveLength(1)
  })

  it('放过 className、样式串、import 路径与纯路径形状的键', () => {
    const source = [
      "import x from '@/lib/a'",
      "const c = 'flex items-center gap-2'",
      "const d = 'mt-8 inline-flex items-center justify-center rounded-full bg-ink px-7 py-3'",
      "const key = 'evoloop:speak'",
      "const t2 = 'whitespace-pre-wrap break-words'",
      "const dims = '84px 96px'",
    ].join('\n')
    expect(probe(source, 'a.ts')).toHaveLength(0)
  })

  it('放过 JSX 上的 className / style 属性与 SVG 几何属性', () => {
    expect(
      probe("export const A = () => <div className={'flex items-center gap-2'} />"),
    ).toHaveLength(0)
    expect(
      probe("export const A = () => <div style={{ gridTemplate: '84px 96px' }} />"),
    ).toHaveLength(0)
    expect(probe('export const A = () => <path d="M38 116 a14 14 0 0 1 14 -14" />')).toHaveLength(0)
  })

  it("特判 React/Next 指令字面量（'use client' 不是文案）", () => {
    expect(probe("'use client'\nexport const A = 1", 'a.ts')).toHaveLength(0)
    expect(probe("'use server'\nexport async function A() {}", 'a.ts')).toHaveLength(0)
  })

  it('长度 <3 或纯路径形状的串不命中（不要为 mm 之类做特判）', () => {
    expect(probe("const mm = 'mm'", 'a.ts')).toHaveLength(0)
    expect(probe("const url = 'https://example.com/nowhere'", 'a.ts')).toHaveLength(0)
  })

  it('样式串判据不会吞掉小写散文串（纯单词序列与单位片段仍然命中）', () => {
    expect(probe("const pair = '/ pair'", 'a.ts')).toHaveLength(1)
    expect(probe("const supply = 'while supplies last'", 'a.ts')).toHaveLength(1)
  })
})

describe('check-i18n：裸路径判据（逐条复刻 locale-path-coverage.test.ts 的 HIT/PASS 样本）', () => {
  // 两个守卫是同一套语义的两份实现（`.mjs` 不能 import `.ts`，只能复制）；
  // `src/components/i18n/locale-path-coverage.test.ts` 是这套语义的真值来源。下面把这组样本
  // **成对复刻**进本文件：同一份样本必须给出同一个判定——任一侧改了语义而另一侧没跟上时会变红。
  // 语义本身不改动（不新增、不放宽任何样本）。
  const verdict = (source: string) => rulesOf(source)

  it('HIT：字面量、JSX 表达式字面量、命令式跳转与内联导航都命中', () => {
    expect(verdict('<Link href="/shop">x</Link>')).toEqual(['raw-path'])
    expect(verdict("<Link href='/shop'>x</Link>")).toEqual(['raw-path'])
    expect(verdict('<Link href={"/shop"}>x</Link>')).toEqual(['raw-path'])
    expect(verdict("<Link href={'/shop'}>x</Link>")).toEqual(['raw-path'])
    expect(verdict('<Link href={`/blog/${post.slug}`}>x</Link>')).toEqual(['raw-path'])
    expect(verdict('<a href="/shop">x</a>')).toEqual(['raw-path'])
    expect(verdict('<Link href="/">x</Link>')).toEqual(['raw-path'])
    expect(verdict('<form action="/shop" />')).toEqual(['raw-path'])
    expect(verdict('<form action={"/shop"} />')).toEqual(['raw-path'])
    expect(verdict("router.replace('/shop')")).toEqual(['raw-path'])
    expect(verdict('router.push(`/shop?q=1`)')).toEqual(['raw-path'])
    expect(verdict("redirect('/shop')")).toEqual(['raw-path'])
    // 同一文件里多处命中都要报，不能只报第一处
    expect(verdict('<a href="/a">1</a><a href="/b">2</a>')).toEqual(['raw-path', 'raw-path'])
    // JSX 内联导航：属性初始化表达式必须继续下探，否则 router.push / redirect 写在 JSX 回调里就逃出检测面
    expect(verdict('<button onClick={() => router.push("/shop")}>x</button>')).toEqual(['raw-path'])
    expect(verdict('<form onSubmit={() => redirect("/shop")}>')).toEqual(['raw-path'])
    // 同一处字面量不得因「属性判定 + 内联导航判定」两条路径被报两次
    expect(verdict('<a href="/shop" onClick={() => router.push("/shop")}>x</a>')).toEqual([
      'raw-path',
      'raw-path',
    ])
  })

  it('PASS：LocaleLink 属性、localePath 包裹、站外链接与纯锚点都不命中', () => {
    expect(verdict('<LocaleLink href="/shop">x</LocaleLink>')).toEqual([])
    expect(verdict('<LocaleLink href={"/shop"}>x</LocaleLink>')).toEqual([])
    expect(verdict('<LocaleLink href={`/product/${row.handle}`}>x</LocaleLink>')).toEqual([])
    expect(verdict('<LocaleLink action="/shop">x</LocaleLink>')).toEqual([])
    expect(verdict("<Link href={localePath(locale, '/shop')}>x</Link>")).toEqual([])
    expect(verdict('<Link href={localePath(locale, `/blog/${post.slug}`)}>x</Link>')).toEqual([])
    expect(verdict("router.replace(localePath(locale, qs ? `/shop?${qs}` : '/shop'))")).toEqual([])
    expect(verdict("redirect(localePath(locale, '/shop'))")).toEqual([])
    expect(verdict('<Link href={href}>x</Link>')).toEqual([])
    expect(verdict('<LocaleLink href="/">Home</LocaleLink>')).toEqual([])
    expect(verdict("<Link href={localePath(locale, '/')}>Home</Link>")).toEqual([])
    expect(verdict('<a href="#main">Skip</a>')).toEqual([])
    expect(verdict('<a href="mailto:hello@evoloop.site">Mail</a>')).toEqual([])
    expect(
      verdict('<a href="https://github.com/WhatDamon/shoe-online-store-demo">Source</a>'),
    ).toEqual([])
  })
})

describe('check-i18n：扫描面确实覆盖真实仓库（不只喂合成源码）', () => {
  it('对真实源码文件跑扫描，产出散文命中', () => {
    // 单测若只喂合成源码，「scanSource 对真实文件不再产出散文」也不会有人发现。
    const file = 'src/components/shop/shopify-buy-button.tsx'
    const findings = scanSource(readFileSync(join(REPO_ROOT, file), 'utf8'), file)
    expect(findings).toContainEqual(
      expect.objectContaining({ rule: 'prose-literal', text: 'no window' }),
    )
  })

  it('collectSources 真的走进了 src/components（挡住「返回空 = 全绿」）', () => {
    const files = collectSources(REPO_ROOT, ['src/components'])
    expect(files).toContain('src/components/shop/shopify-buy-button.tsx')
    // 余量阈值：拦住「扫描面塌成空/只剩一两个文件」，不钉死具体文件数。
    expect(files.length).toBeGreaterThan(40)
  })

  it('真实仓库的门禁结果：0 阻塞，且白名单条目都在压制命中（没有惰性条目）', () => {
    const result = analyze()
    expect(result.suppressed).toBeGreaterThan(0)
    expect(result.findings).toEqual([])
  })
})

describe('check-i18n：惰性白名单条目（stale-allowlist）', () => {
  it('没有压制任何命中的抑制条目会被报出来（负向对照：字面量还在但已不产生命中）', () => {
    const entry = {
      path: 'src/components/a.tsx',
      rule: 'prose-literal',
      text: '这条字面量还在文件里，但今天的扫描不再把它当散文',
      reason: '自证惰性条目判据有判别力',
    }
    expect(unusedAllowlistEntries([entry], new Set())).toHaveLength(1)
    expect(unusedAllowlistEntries([entry], new Set([entry]))).toEqual([])
  })

  it('扫描面外的登记（internal-copy / error-code）不参与惰性判定', () => {
    const internal = {
      path: 'src/lib/gift-offer.ts',
      rule: 'internal-copy',
      text: 'x',
      reason: 'y',
    }
    const code = { rule: 'error-code', code: 'product_not_found', reason: 'z' }
    expect(unusedAllowlistEntries([internal, code], new Set())).toEqual([])
  })
})

describe('check-i18n：后端错误码与前端联合的机械对齐', () => {
  const contract = { backend: ['product_not_found', 'order_not_found'], handlers: [] }
  const frontend = ['order_not_found']

  it('未进前端联合、也不在白名单的码会被报出来（负向对照：人为加码必须变红）', () => {
    // 模拟「有人在 errors.py 里加了一个码」：它既不在前端联合里，也不在白名单里。
    const withNewCode = { ...contract, backend: [...contract.backend, 'brand_new_code'] }
    expect(unlistedErrorCodes(withNewCode, frontend, ALLOWLIST).map((f) => f.code)).toEqual([
      'brand_new_code',
    ])
  })

  it('白名单里的差集成员与已 present 的成员都不再报出', () => {
    // product_not_found 在白名单里，order_not_found 在前端联合里。
    expect(unlistedErrorCodes(contract, frontend, ALLOWLIST)).toEqual([])
  })

  it('真实仓库的差集正好就是白名单登记的那些码（上面的负向对照证明它不是恒真）', () => {
    const realContract = readContractErrorCodes(REPO_ROOT)
    const realFrontend = readFrontendErrorCodes(REPO_ROOT)
    // 解析器本身必须有判别力：解析不出已知码的话，「差集为空」是假的。
    expect(realContract.backend).toContain('order_not_found')
    expect(realContract.handlers).toContain('invalid_origin')
    expect(realFrontend).toContain('order_not_found')
    expect(unlistedErrorCodes(realContract, realFrontend, ALLOWLIST)).toEqual([])
  })
})

describe('check-i18n：白名单自身', () => {
  it('白名单覆盖内部与运维文本，且每条都有 reason', () => {
    expect(ALLOWLIST.some((e) => e.path?.includes('guardrails/request.ts'))).toBe(true)
    expect(ALLOWLIST.some((e) => e.path?.includes('search/repository'))).toBe(true)
    expect(ALLOWLIST.every((e) => typeof e.reason === 'string' && e.reason.length > 0)).toBe(true)
  })

  it('提交进仓库的白名单没有腐烂条目（路径/文本/错误码都还在）', () => {
    expect(unreadableAllowlistEntries(ALLOWLIST, REPO_ROOT)).toEqual([])
  })

  it('腐烂条目会被报出来（负向对照）', () => {
    const stale = [
      {
        path: 'src/db/client.ts',
        rule: 'internal-copy',
        text: '这句话在 db/client.ts 里不存在',
        reason: '故意造的腐烂条目，用于自证校验有判别力',
      },
      {
        path: 'src/does-not-exist.ts',
        rule: 'internal-copy',
        text: 'x',
        reason: '故意造的腐烂条目（路径不存在）',
      },
    ]
    expect(unreadableAllowlistEntries(stale, REPO_ROOT)).toHaveLength(2)
  })

  it('散文抑制项必须给出 text（不许按文件整体放行）', () => {
    const blanket = [{ path: 'src/components/a.tsx', rule: 'prose-literal', reason: '空口放行' }]
    expect(unreadableAllowlistEntries(blanket, REPO_ROOT)).toHaveLength(1)
  })
})
