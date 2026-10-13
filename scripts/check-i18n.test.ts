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
import { describe, expect, it } from 'vitest'
import {
  ALLOWLIST,
  REPO_ROOT,
  readContractErrorCodes,
  readFrontendErrorCodes,
  scanSource,
  unlistedErrorCodes,
  unreadableAllowlistEntries,
} from './check-i18n.mjs'

const probe = (source: string, fileName = 'probe.tsx') => scanSource(source, fileName)

/**
 * 负向对照是这套门禁唯一有意义的证据：`check:i18n` 今天的契约是「0 阻塞命中」，
 * 而 0 命中在判据失效时同样成立。下面每个 describe 都先钉住「该命中的真的命中」。
 */
describe('check-i18n：散文判据', () => {
  it('识别 JSX 文本里的散文', () => {
    expect(probe('export const A = () => <p>Hello there</p>')).toHaveLength(1)
  })

  it('识别文案属性', () => {
    expect(probe('export const A = () => <img alt="Nice shoes" />')).toHaveLength(1)
    expect(probe('export const A = () => <button aria-label="Close the panel" />')).toHaveLength(1)
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

describe('check-i18n：裸路径判据（与 locale-path-coverage.test.ts 同一套语义）', () => {
  it('识别字面量绝对路径', () => {
    expect(
      probe('export const A = () => <a href="/shop">x</a>').some((f) => f.rule === 'raw-path'),
    ).toBe(true)
  })

  it('放行 LocaleLink 属性、localePath 包裹与站外链接', () => {
    expect(probe('export const A = () => <LocaleLink href="/shop">x</LocaleLink>')).toHaveLength(0)
    expect(probe("export const A = () => <a href={localePath('/shop')}>x</a>")).toHaveLength(0)
    expect(probe("export const A = () => <a href='mailto:hi@evoloop.site'>x</a>")).toHaveLength(0)
    expect(probe("export const A = () => <a href='https://evoloop.site/shop'>x</a>")).toHaveLength(
      0,
    )
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
