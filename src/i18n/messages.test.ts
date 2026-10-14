import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LOCALES } from './locales'
import { messages } from './messages'

describe('messages', () => {
  it('每个声明的 locale 都有词典', () => {
    for (const locale of LOCALES) {
      expect(Object.keys(messages(locale)).length).toBeGreaterThan(0)
    }
  })
  it('没有任何键的值是空串或 undefined', () => {
    // 审查重点 5
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(messages(locale))) {
        expect(typeof value, `${locale}.${key} 必须是 string`).toBe('string')
        expect(value.trim(), `${locale}.${key} 不能为空`).not.toBe('')
      }
    }
  })
  it('键名符合扁平点号约定', () => {
    // 裁决 R3
    for (const key of Object.keys(messages('en'))) {
      expect(key).toMatch(/^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/)
    }
  })
  it('里程碑键存在且为英文原文', () => {
    expect(messages('en')['nav.shop']).toBe('Shop')
    expect(messages('en')['notFound.title']).toBe("We couldn't find that page")
    expect(messages('en')['notFound.cta']).toBe('Browse the shop')
  })
  it('每个 locale 的词典都与 en 键集完全一致（双向）', () => {
    // 审查重点 5：`satisfies Messages` 只保证「en 的键都在该语言里」（单向，缺键是 TS2741）；
    // 「该语言多出 en 没有的键」类型系统抓不到，只有运行期相等断言能抓。因此这里遍历
    // `LOCALES` 而不是只比 `en`——阶段 1 的盲点正是后者。
    const enKeys = Object.keys(messages('en')).sort()
    for (const locale of LOCALES) {
      expect(Object.keys(messages(locale)).sort(), `${locale} 的键集与 en 不一致`).toEqual(enKeys)
    }
  })
})

// 用 process.cwd() 而非 import.meta.url：vitest 把 import.meta.url 转成非 file: 协议，
// `new URL(..., import.meta.url)` 会报「The URL must be of scheme file」（同
// src/components/i18n/locale-path-coverage.test.ts）。vitest 以仓库根为 cwd。
const SRC = join(process.cwd(), 'src')
const I18N_DIR = join(SRC, 'i18n')

/**
 * 死词典项守卫：词典里每个键都必须在**消费点**被引用，否则它就是无从察觉的残留
 * （组件删了、键留下）。静态守卫比「运行时键集与手写键表一致」更有价值：手写键表
 * 只是词典的副本，而它带来的保证（键存在）在类型系统里已经由每个使用点承担。
 *
 * 检测面与口径：
 * - 扫描 `src/**` 的 `.ts` / `.tsx`，**排除 `src/i18n/**` 自身**（词典与访问器不是消费点，
 *   本文件里对键名的断言也不算引用）；
 * - 其余文件**包括测试文件**的引用都算——`locale-provider.test.tsx` 在真实渲染路径上读
 *   `nav.shop` 就是一种引用；
 * - 只认**带引号的静态键访问**（`t['key']` / `t["key"]` / `` t[`key`] ``）。全仓没有动态
 *   拼接键，因此这个口径可靠；裸词出现在注释里不算引用。
 *
 * 已知边界（不是缺陷，是口径）：因为测试文件的引用也算，「某个键只在测试里活着、生产里
 * 忘了接」这一种漏检**不会**被本守卫抓到；它由抽取任务的「逐字一致」验收与正文等价核对
 * 兜底。守卫口径保持单一，不额外加「生产引用」断言——那需要手工列键，又变回键表副本。
 */
const KEY_LITERAL = (key: string) => [`'${key}'`, `"${key}"`, `\`${key}\``]

/** 该文件是否引用了这个键。 */
function references(key: string, source: string): boolean {
  return KEY_LITERAL(key).some((literal) => source.includes(literal))
}

/** 返回没有任何源文件引用的键（顺序保持传入顺序，便于定位）。 */
function deadKeys(keys: readonly string[], sources: readonly string[]): string[] {
  return keys.filter((key) => !sources.some((source) => references(key, source)))
}

/** 递归读取源码文本；`src/i18n/**` 整棵子树跳过（见上面的检测面）。 */
function sourceTexts(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (full !== I18N_DIR) sourceTexts(full, out)
    } else if (/\.tsx?$/.test(full)) {
      out.push(readFileSync(full, 'utf8'))
    }
  }
  return out
}

describe('词典没有死键', () => {
  // 零命中断言只在检测面本身有效时才有意义：先钉住「该命中的命中、该放行的放行」。
  it('检测面认可带引号的静态键访问，且不把裸词当引用，并真的扫到了语料', () => {
    const probe = (keys: string[], sources: string[]) => deadKeys(keys, sources)
    expect(probe(['live.key'], ["const t = messages('en'); t['live.key']"])).toEqual([])
    expect(probe(['live.key'], ['t["live.key"]'])).toEqual([])
    expect(probe(['live.key'], ['t[`live.key`]'])).toEqual([])
    expect(probe(['ghost.key'], ["t['other.key']"])).toEqual(['ghost.key'])
    expect(probe(['ghost.key'], ['const t = messages(locale)'])).toEqual(['ghost.key'])
    // 注释里出现裸键名不算引用（门禁不靠「文档提到过」
    expect(probe(['live.key'], ['// live.key 已被 nav 改名'])).toEqual(['live.key'])
    // 上面的探针只钉住判定规则；判定规则再对，检测面本身坏了守卫仍会**静默永真**：
    // `I18N_DIR` 一旦与任何目录都不相等，`src/i18n/**` 就落进检测面，而词典自己就是
    // 全部键的「消费点」——零命中断言于是永远成立。故把语料也钉住：非空（能抓
    // 「扫到 0 个文件」这类崩坏，50 只作余量下限，当前是两百多个 `.ts/.tsx`），
    // 且不含被排除子树的文件内容（能抓「把 src/i18n/** 纳入检测面」）。
    const corpus = sourceTexts(SRC)
    expect(corpus.length).toBeGreaterThan(50)
    expect(corpus).not.toContain(readFileSync(join(SRC, 'i18n', 'dictionaries', 'en.ts'), 'utf8'))
  })

  it('每个词典键都在 src/** 里被引用', () => {
    const dead = deadKeys(Object.keys(messages('en')), sourceTexts(SRC))
    expect(dead, `这些键没有任何消费点：${dead.join(', ')}`).toEqual([])
  })
})
