# i18n 阶段 1（locale 路由与词典骨架）实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 subagent-driven-development（推荐）或 executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 把站点改成 `/[locale]/...` 子路径路由，建立「缺键即编译错误」的词典层与 locale 格式化收口，并让逐语言 canonical/hreflang/sitemap/OG 上线——**全部只服务一个语言 `en`**，页面正文与今天逐字一致。

**架构：** `src/i18n/` 是 React-free 的纯模块层（locale 定义、词典、路径生成、格式化、内容回退解析）；React 适配器（Provider / Link）放在 `src/components/i18n/`，以遵守 `CONTEXT.md` 的目录层不变量。`src/proxy.ts` 是唯一的路由协商点，把无前缀 URL 永久跳转到默认语言。`LOCALES` 在本阶段**只有 `en`**，因此 `/zh-CN/*` 既无路由也无词典——语言一旦加进 `LOCALES`，类型系统立刻要求词典存在。

**技术栈：** Next.js 16（App Router、`proxy.ts`、`next/root-params`、`next typegen`）、React 19、TypeScript 5、Vitest 5。

**规格：** `docs/superpowers/specs/2026-10-13-i18n-multi-language-design.md`

---

## 全局约束

- **零新增运行时依赖。** 不引入 `next-intl` / `react-i18next` / ICU 库。
- **`LOCALES` 在阶段 1 只含 `'en'`。** 阶段 2 才扩成 `['en', 'zh-CN']`（见「裁决记录」R1）。
- **`SITE_MARKET`、`market.currency`、尺码换算表不改。** 删除 `src/lib/market.ts` 的硬编码 `locale: 'en-US'` 是唯一允许的改动。
- **`src/i18n/**` 不得导入 React，也不得导入 `src/server/**`。** React 适配器一律放 `src/components/i18n/`。
- **词典只承载文案**，不承载价格、库存、订单状态、支付结果（ADR 0004）。
- **后端不做 i18n。** `backend/**` 一行不改；错误按 `code` 在前端本地化。
- **现有 18 个断言英文文案的测试文件、`src/test/a11y/axe-gate.test.tsx` 的标题层级断言 `[1,2,3,3,3]`、内联 `<h1>Evoloop</h1>`、`SAMPLE_PRODUCT` 一律不改。** 这是阶段 1 的硬验收指标。
- **阶段 1 结束时的验收命令**：`npm run verify` 与 `npm run build` 全绿。
- **「现有 18 个断言英文文案的测试文件零改动」指标的分工（裁决 R18）**：
  - 对**任务 1–4、6–11**：原样生效。它们不改渲染出的 `href`，文案抽取后取值也不变。
  - 对**任务 5**：不适用——任务 5 的全部目的就是改变渲染出的 `href`。改为：不得删除/放宽/跳过任何断言；
    只允许改「期望值是一个 URL」的断言，并逐条给出 before/after 清单；任何非 URL 断言不得改动。
- 每个任务结束时提交；提交信息用 `feat(i18n):` / `refactor(i18n):` / `chore(i18n):` 前缀。
- **不改 `backend/`、不改 `drizzle/`、不跑迁移。** 本阶段不涉及任何数据库变更。

## 裁决记录（计划期已定，执行时记入账本）

- **R1 — 阶段 1 的 `LOCALES` 只有 `'en'`。** 规格 §6.1 写的是 `['en','zh-CN']`。若阶段 1 就含 `zh-CN` 而没有 `zh-CN.ts`，`messages('zh-CN')` 只能回退英文，那正是规格禁止的「假翻译」。代价：阶段 2 要改一行 `LOCALES` 并补词典；若要回退，代价为零。
- **R2 — React 适配器放 `src/components/i18n/` 而非 `src/i18n/`。** 规格 §6.1 的目录清单把 Provider/Link 放在 `src/i18n/`，但这与 `CONTEXT.md`「`src/i18n/` 不依赖 React」冲突，而 `CONTEXT.md` 的不变量是有约束力的。代价：多一个目录；若判断有误，移动两个文件即可。
- **R3 — 词典用扁平点号键（`shop.filter.title`），不用嵌套对象。** 键集一致性是一行 `Object.keys` 比较；`check:slop` 的 `dead-export` 不会把词典子对象误判为孤儿；`grep` 可定位。代价：约 300 个键的单一对象；若判断有误，改 `flattenKeys()` 一处 + 词典结构。
- **R4 — `useMessages()` 无 Provider 时回退默认语言词典，而不是抛错。** 这是「18 个测试文件零改动」的实现手段。代价：真实漏挂 Provider 时会静默显示英文；由布局层测试（任务 3）兜住。

## 审查重点（Review Focus）

规格没有逐条列出下面这些输入与失败模式，但它们是本阶段最可能伤到真实访客的五类。每个任务必须包含钉住对应行的测试。

| # | 输入 / 条件 | 一个正常人期待的行为 |
|---|---|---|
| 1 | 畸形或敌意的 `Accept-Language`（`zh-CN;q=abc`、空串、`*`、超长头、`<script>`） | 落到默认语言并正常 308，**不 500、不抛异常、不回显原始头** |
| 2 | 畸形前缀路径：`/EN/shop`、`/en/../api/commerce/cart`、`/enen/shop`、`/en`（无尾斜杠） | 不得产生叠加前缀（`/en/en/...`）或绕过排除表；`/en` 自身可达 |
| 3 | 带查询串与锚点的深链：`/shop?color=red#top`、`/product/dc-1001?size=42` | 跳转后**查询串与锚点原样保留** |
| 4 | 非 GET 请求打到旧的无前缀路径（表单 POST、站外集成 POST） | 307 且方法不变、body 语义不被改写；**绝不 308** |
| 5 | 词典键被删或改名（`t('shop.title')` 指向不存在的键） | **编译期或测试期失败**，绝不渲染出 `undefined` / 键名到界面上 |

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `src/i18n/locales.ts`（创建） | `LOCALES` / `Locale` / `DEFAULT_LOCALE` / `isLocale` / `resolveLocale` / `localePath` |
| `src/i18n/messages.ts`（创建） | `Messages` 类型、`messages(locale)`、键集一致性守卫 |
| `src/i18n/dictionaries/en.ts`（创建） | 唯一词典（阶段 1）；扁平点号键 |
| ~~`src/i18n/server.ts`~~（**不创建**，裁决 R20） | 规格 §6.2 原设计走 `next/root-params`。**已废弃**：该模块在 vitest 下是编译器替换的占位模块，导入即抛错，而任何导入它的模块会污染所有渲染该树的测试。服务端 locale 一律来自 `params`（root layout 已 `isLocale` 校验并 `notFound()`），词典直接 `messages(locale)` |
| `src/i18n/content.ts`（创建） | 内容回退解析（阶段 3 使用，本阶段只建骨架与状态类型） |
| `src/i18n/locales.test.ts` 等（创建） | 纯函数测试 |
| `src/components/i18n/locale-provider.tsx`（创建） | `'use client'`：`LocaleProvider` / `useLocale` / `useMessages` |
| `src/components/i18n/locale-link.tsx`（创建） | `'use client'`：`LocaleLink`，自动加前缀 |
| `src/proxy.ts`（创建） | 唯一协商点：排除表、308/307、偏好 Cookie、`Vary` |
| `src/app/[locale]/**`（移动） | 现有 `app/**` 页面全部下移一层；`api/`、`robots.ts`、`sitemap.ts`、`og/`、`global-not-found.tsx` 留在顶层 |
| `src/app/global-not-found.tsx`（创建） | 全局 404；配合 `next.config.ts` 的 `experimental.globalNotFound` |
| `src/lib/seo.ts`（修改） | `absoluteUrl` / `alternatesFor` / `pageMetadata` 接受 locale |
| `src/lib/market.ts`（修改） | 删除硬编码 `locale: 'en-US'` |
| `src/lib/format.ts`（修改） | `formatPrice(amount, locale)`，locale 默认 `DEFAULT_LOCALE` |
| `src/app/robots.ts`（修改） | disallow 覆盖带前缀与无前缀两种形态 |
| `src/app/sitemap.ts`（修改） | 按 locale 生成 URL 与 `alternates.languages` |
| `scripts/check-i18n.mjs`（创建） | 未收口文案与字面量绝对路径的门禁，带「必须保持英文」白名单 |
| `package.json`（修改） | `typecheck` 前置 `next typegen`；新增 `check:i18n` 并接进 `verify` |

---

### 任务 1：i18n 纯模块基础 —— locale 定义、协商与路径生成

**文件：**
- 创建：`src/i18n/locales.ts`
- 测试：`src/i18n/locales.test.ts`

- [ ] **步骤 1：编写失败的测试**

```ts
// src/i18n/locales.test.ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_LOCALE, LOCALES, isLocale, localePath, resolveLocale } from './locales'

describe('LOCALES', () => {
  it('阶段 1 只声明 en', () => {
    expect(LOCALES).toEqual(['en'])
    expect(DEFAULT_LOCALE).toBe('en')
  })
})

describe('isLocale', () => {
  it.each([['en', true], ['zh-CN', false], ['', false], ['EN', false], [null, false], [undefined, false]])(
    '%s -> %s', (input, expected) => { expect(isLocale(input as string)).toBe(expected) },
  )
})

describe('resolveLocale', () => {
  it('合法 cookie 优先于 Accept-Language', () => {
    expect(resolveLocale('en-US,en;q=0.9', 'en')).toBe('en')
  })
  it('非法 cookie 被忽略', () => {
    expect(resolveLocale('en', 'not-a-locale')).toBe('en')
  })
  it.each([
    ['en-US,en;q=0.9', 'en'],
    ['zh-CN,zh;q=0.9', 'en'],        // zh-CN 尚未在 LOCALES 中 → 默认
    ['*', 'en'],
    ['', 'en'],
    ['   ', 'en'],
    ['zh-CN;q=abc', 'en'],            // 审查重点 1：畸形 q 值不抛错
    [';;;', 'en'],
    ['<script>alert(1)</script>', 'en'], // 审查重点 1：不回显、不抛错
    ['a'.repeat(10_000), 'en'],       // 审查重点 1：超长头不抛错
  ])('Accept-Language %s -> %s', (header, expected) => {
    expect(resolveLocale(header, null)).toBe(expected)
  })
})

describe('localePath', () => {
  it.each([
    ['en', '/', '/en'],
    ['en', '/shop', '/en/shop'],
    ['en', 'shop', '/en/shop'],
    ['en', '/en/shop', '/en/shop'],            // 审查重点 2：不叠加前缀
    ['en', '/en', '/en'],
    ['en', '/enen/shop', '/en/enen/shop'],      // 审查重点 2：不把 enen 当已带前缀
    ['en', '/EN/shop', '/en/EN/shop'],          // 审查重点 2：大小写敏感，不视为已带前缀
  ])('localePath(%s, %s) -> %s', (locale, path, expected) => {
    expect(localePath(locale as 'en', path)).toBe(expected)
  })
  it('保留查询串与锚点', () => {                 // 审查重点 3
    expect(localePath('en', '/shop?color=red#top')).toBe('/en/shop?color=red#top')
  })
  it('已是绝对 URL 时原样返回', () => {
    expect(localePath('en', 'https://evoloop.site/shop')).toBe('https://evoloop.site/shop')
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run src/i18n/locales.test.ts`
预期：FAIL，报错 `Failed to resolve import "./locales"`

- [ ] **步骤 3：实现 `src/i18n/locales.ts`**

导出以下签名（函数体由实现者写）：

```ts
export const LOCALES = ['en'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'

export function isLocale(value: string | null | undefined): value is Locale
export function resolveLocale(acceptLanguage: string | null, cookie: string | null): Locale
export function localePath(locale: Locale, path: string): string
```

实现约束：
- `resolveLocale` 顺序：合法 cookie → `Accept-Language` → `DEFAULT_LOCALE`。
- `Accept-Language` 解析用不抛错的纯函数：按 `,` 切分，每段按 `;` 取 tag 与 `q=`；`q` 无法解析或越界时按 `q=1`；按 `q` 降序；tag 先精确匹配 `LOCALES`（大小写不敏感比较），再按主语言前缀匹配；`*` 视为匹配 `DEFAULT_LOCALE`。
- `localePath`：绝对 URL（`/^[a-z][a-z0-9+.-]*:\/\//i`）原样返回；先把 `path` 拆成 `pathname + search + hash`；`pathname` 不以 `/` 开头则补 `/`；`pathname` 已是 `` `/${locale}` `` 或以其后跟 `/` 时为真时不再加前缀。
- **不得**在此文件写任何文案（它属于纯逻辑层）。

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run src/i18n/locales.test.ts`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add src/i18n/locales.ts src/i18n/locales.test.ts
git commit -m "feat(i18n): add locale definition, negotiation and path helper"
```

---

### 任务 2：词典层 —— 类型、键集一致性与缺键守卫

**文件：**
- 创建：`src/i18n/dictionaries/en.ts`、`src/i18n/messages.ts`
- 测试：`src/i18n/messages.test.ts`

**Interfaces：**
- 消费：任务 1 的 `Locale`、`DEFAULT_LOCALE`、`LOCALES`。
- 产出：`Messages`（类型）、`messages(locale): Messages`。

- [ ] **步骤 1：编写失败的测试**

```ts
// src/i18n/messages.test.ts
import { describe, expect, it } from 'vitest'
import { LOCALES, type Locale } from './locales'
import { messages } from './messages'

describe('messages', () => {
  it('每个声明的 locale 都有词典', () => {
    for (const locale of LOCALES) {
      expect(Object.keys(messages(locale)).length).toBeGreaterThan(0)
    }
  })
  it('没有任何键的值是空串或 undefined', () => {   // 审查重点 5
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(messages(locale))) {
        expect(typeof value, `${locale}.${key} 必须是 string`).toBe('string')
        expect(value.trim(), `${locale}.${key} 不能为空`).not.toBe('')
      }
    }
  })
  it('键名符合扁平点号约定', () => {               // 裁决 R3
    for (const key of Object.keys(messages('en'))) {
      expect(key).toMatch(/^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/)
    }
  })
  it('里程碑键存在且为英文原文', () => {
    expect(messages('en')['nav.shop']).toBe('Shop')
    expect(messages('en')['notFound.title']).toBe("We couldn't find that page")
    expect(messages('en')['notFound.cta']).toBe('Browse the shop')
  })
})

describe('键表单源', () => {
  // 显式键表：词典加键而这里没跟上时由运行时断言拦住；
  // 键表写了词典没有的键时由 satisfies 在编译期拦住。两个方向都有守卫。
  it('运行时键集与显式键表一致', () => {
    expect(Object.keys(messages('en')).sort()).toEqual([...KEYS].sort())
  })
})
```

`KEYS` 声明在 describe 之外：

```ts
const KEYS = ['nav.shop', 'notFound.title', 'notFound.cta'] as const satisfies readonly (keyof Messages)[]
```

> **禁止的写法（飞行前裁决 R11）：** 不要用 `const typed: Array<keyof Messages> = Object.keys(...) as never` 再加长度比较——
> `as never` 会擦除全部类型关系，且两个变量是同一个数组引用，断言恒真。同理禁用 `as any` 类的「顺手指」。
> 这条是任务 2 审查发现的真实缺陷，已从计划中修正。

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run src/i18n/messages.test.ts`
预期：FAIL，`Failed to resolve import "./messages"`

- [ ] **步骤 3：实现词典与访问器**

`src/i18n/dictionaries/en.ts`：`const en = { 'nav.shop': 'Shop', ... } as const; export default en`
——本任务只需填入里程碑键（`nav.*`、`notFound.*`），其余键由任务 7–10 的抽取任务补齐。

`src/i18n/messages.ts`：

```ts
export type Messages = Record<keyof typeof en, string>
export function messages(locale: Locale): Messages
```

实现约束：
- 用 `Record<Locale, Messages>` 的映射表，**不写 `default:` 分支**——`LOCALES` 增加语言而词典缺失时必须是编译错误。
- 导出 `export { default as en } from './dictionaries/en'` 供 `check:i18n` 与测试使用。

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run src/i18n/messages.test.ts`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add src/i18n/messages.ts src/i18n/dictionaries/en.ts src/i18n/messages.test.ts
git commit -m "feat(i18n): add typed message dictionary with key-set guards"
```

---

### 任务 3：React 适配器 —— Provider、hooks 与 LocaleLink

**文件：**
- 创建：`src/components/i18n/locale-provider.tsx`、`src/components/i18n/locale-link.tsx`
- 测试：`src/components/i18n/locale-provider.test.tsx`、`src/components/i18n/locale-link.test.tsx`

**Interfaces：**
- 消费：任务 1 的 `Locale`/`localePath`，任务 2 的 `Messages`/`messages`。
- 产出：`<LocaleProvider locale messages>`、`useLocale()`、`useMessages()`、`<LocaleLink href>`。

- [ ] **步骤 1：编写失败的测试**

```tsx
// src/components/i18n/locale-provider.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { messages } from '@/i18n/messages'
import { LocaleProvider, useLocale, useMessages } from './locale-provider'

function Probe() {
  return (
    <span>
      {useLocale()}:{useMessages()['nav.shop']}
    </span>
  )
}

describe('LocaleProvider', () => {
  it('向下游提供 locale 与词典', () => {
    // 裁决 R12：`messages` 是必填 prop（规格的设计是「由 layout 显式交出当前语言的词典」，
    // 词典进客户端树的入口只能有一个），所以用例必须显式传——这里原本漏传，是计划自身的缺陷。
    render(<LocaleProvider locale="en" messages={messages('en')}><Probe /></LocaleProvider>)
    expect(screen.getByText('en:Shop')).toBeInTheDocument()
  })
  it('无 Provider 时回退默认语言而不是抛错', () => {   // 裁决 R4：本行是用例硬指标的守卫，逐字不动
    render(<Probe />)
    expect(screen.getByText('en:Shop')).toBeInTheDocument()
  })
})
```

```tsx
// src/components/i18n/locale-link.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { messages } from '@/i18n/messages'
import { LocaleLink } from './locale-link'
import { LocaleProvider } from './locale-provider'

describe('LocaleLink', () => {
  it('给站内相对路径加 locale 前缀', () => {
    render(<LocaleLink href="/shop">Shop</LocaleLink>)
    expect(screen.getByRole('link', { name: 'Shop' })).toHaveAttribute('href', '/en/shop')
  })
  it('保留查询串', () => {
    render(<LocaleLink href="/shop?color=red">Shop</LocaleLink>)
    expect(screen.getByRole('link')).toHaveAttribute('href', '/en/shop?color=red')
  })
  it('外层 Provider 的语言生效', () => {
    // 裁决 R12：原计划此处既漏 import 又漏 `messages`，两个都会以同一种 undefined 报错失败。
    render(
      <LocaleProvider locale="en" messages={messages('en')}>
        <LocaleLink href="/cart">Cart</LocaleLink>
      </LocaleProvider>,
    )
    expect(screen.getByRole('link')).toHaveAttribute('href', '/en/cart')
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run src/components/i18n`
预期：FAIL，导入解析失败

- [ ] **步骤 3：实现两个组件**

`src/components/i18n/locale-provider.tsx`（`'use client'`）：

```tsx
export function LocaleProvider(props: { locale: Locale; messages: Messages; children: ReactNode }): ReactElement
export function useLocale(): Locale
export function useMessages(): Messages
```

`src/components/i18n/locale-link.tsx`（`'use client'`）：

```tsx
export function LocaleLink(props: ComponentProps<typeof Link>): ReactElement
```

实现约束：
- **返回类型用 `ReactElement` 而不是 `JSX.Element`，并从 `react` 导入类型**（飞行前裁决 R13）。
  `@types/react` 19.x 已移除全局 `JSX` 命名空间，写 `JSX.Element` 会报 `TS2503: Cannot find namespace 'JSX'`；
  本仓既有代码也从不使用该写法。此为计划自身缺陷，已在任务 3 修正。
- 默认上下文值 = `{ locale: DEFAULT_LOCALE, messages: messages(DEFAULT_LOCALE) }`，因此无 Provider 不抛错（R4）。
- `LocaleLink` 用 `typeof href === 'string'` 收窄：**字符串走 `localePath(locale, href)`；非字符串（`UrlObject`）原样透传给 `next/link`**，**绝不得 `String(href)` 强转**
  （`String({pathname:'/shop'})` 会得到 `"[object Object]"`）。同一句里既写 `String(href)` 又要求原样透传是**计划自身的矛盾**，以后者为准（飞行前裁决 R14）。
- **不得**在 `src/i18n/**` 里写 React（R2）。

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run src/components/i18n`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add src/components/i18n
git commit -m "feat(i18n): add locale provider, hooks and locale-aware link"
```

---

### 任务 4：路由重构 —— `app/[locale]/**`、`proxy.ts`、全局 404

**文件：**
- 移动：`src/app/**` → `src/app/[locale]/**`（`api/`、`robots.ts`、`sitemap.ts`、`og/`、`favicon.ico` 留在原位）
- 创建：`src/proxy.ts`、`src/app/global-not-found.tsx`、`src/app/[locale]/layout.tsx`（由 `src/app/layout.tsx` 移入并改 `<html lang={locale}>`）
- 修改：`next.config.ts`（加 `experimental.globalNotFound`）
- 测试：`src/proxy.test.ts`、`src/app/[locale]/layout.test.tsx`

**Interfaces：**
- 消费：任务 1、2、3 的全部导出。
- 产出：`/[locale]` 路由树；`proxy(request)`。

- [ ] **步骤 1：编写失败的测试**

```ts
// src/proxy.test.ts
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { config, proxy } from './proxy'

const req = (path: string, init?: { method?: string; acceptLanguage?: string; cookie?: string }) =>
  new NextRequest(new URL(`https://evoloop.site${path}`), {
    method: init?.method ?? 'GET',
    headers: {
      ...(init?.acceptLanguage ? { 'accept-language': init.acceptLanguage } : {}),
      ...(init?.cookie ? { cookie: init.cookie } : {}),
    },
  })

describe('proxy 排除表', () => {
  it.each([
    '/api/ai/chat', '/api/commerce/cart', '/_next/static/chunk.js',
    '/og', '/robots.txt', '/sitemap.xml', '/favicon.ico', '/logo.png',
  ])('%s 直通', (path) => {
    expect(proxy(req(path)).headers.get('location')).toBeNull()
  })
})

describe('proxy 跳转', () => {
  it('无前缀 GET 永久跳转（308）', () => {
    const res = proxy(req('/shop'))
    expect(res.status).toBe(308)
    expect(res.headers.get('location')).toBe('https://evoloop.site/en/shop')
  })
  it('无前缀非 GET 用 307', () => {                    // 审查重点 4
    const res = proxy(req('/cart', { method: 'POST' }))
    expect(res.status).toBe(307)
  })
  it.each([['/shop?color=red#top'], ['/product/dc-1001?size=42']])(
    '跳转保留查询串与锚点：%s', (path) => {              // 审查重点 3
      const res = proxy(req(path))
      expect(res.headers.get('location')).toBe(`https://evoloop.site/en${path}`)
    },
  )
  it('已带前缀不跳转，且不叠加', () => {                // 审查重点 2
    expect(proxy(req('/en/shop')).headers.get('location')).toBeNull()
    expect(proxy(req('/en')).headers.get('location')).toBeNull()
  })
  it('大小写不符不视为已带前缀', () => {                // 审查重点 2
    expect(proxy(req('/EN/shop')).status).toBe(308)
  })
  it('畸形 Accept-Language 不抛错、落默认语言', () => {  // 审查重点 1
    expect(() => proxy(req('/shop', { acceptLanguage: '<script>' }))).not.toThrow()
    expect(proxy(req('/shop', { acceptLanguage: ';q=abc' })).status).toBe(308)
  })
  it('依赖 Accept-Language 时带 Vary', () => {
    expect(proxy(req('/shop')).headers.get('vary')).toContain('Accept-Language')
  })
  it('设置偏好 cookie 但不重定向（已带前缀时）', () => {
    const res = proxy(req('/en/shop'))
    expect(res.headers.get('set-cookie')).toContain('evoloop_locale=en')
  })
})

describe('proxy matcher', () => {
  it('排除 api 与静态资源', () => {
    // matcher 是按「带前导斜杠的 pathname」匹配的（`^/((?!api|...).*)`）。
    // 不要剥掉前导斜杠再拼正则——那会把 `(?!api...)` 挪到错误位置而变成恒真
    // （飞行前裁决 R16：原计划写法会让 `/api/...` 也判为 true）。
    const pattern = new RegExp(`^${config.matcher[0]}$`)
    expect(pattern.test('/api/ai/chat')).toBe(false)
    expect(pattern.test('/api/commerce/cart')).toBe(false)
    expect(pattern.test('/logo.png')).toBe(false)
    expect(pattern.test('/robots.txt')).toBe(false)
    expect(pattern.test('/sitemap.xml')).toBe(false)
    expect(pattern.test('/shop')).toBe(true)
    expect(pattern.test('/en/shop')).toBe(true)
  })
})
```

```tsx
// src/app/[locale]/layout.test.tsx
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import RootLayout from './layout'

describe('root layout', () => {
  it('html lang 等于入参 locale', async () => {
    render(await RootLayout({ children: null, params: Promise.resolve({ locale: 'en' }) } as never))
    expect(document.documentElement.getAttribute('lang')).toBe('en')
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run src/proxy.test.ts`
预期：FAIL，`Failed to resolve import "./proxy"`

- [ ] **步骤 3：移动路由并实现 proxy**

1. `git mv src/app/(landing) src/app/[locale]/\(landing\)`，其余页面目录同样移入 `src/app/[locale]/`；`src/app/layout.tsx`、`error.tsx`、`loading.tsx`、`not-found.tsx` 一并移入 `src/app/[locale]/`。**`src/app/api/**`、`robots.ts`、`sitemap.ts`、`og/`、`favicon.ico`、`globals.css` 保持原位。**
   **`globals.css` 不移动（飞行前裁决 R15）**：它要被 `[locale]/layout.tsx`（`import '../globals.css'`）与 `global-not-found.tsx`（`import './globals.css'`）**两边**导入，放在 app 顶层是唯一不用互相引用的位置。CSS 文件不是路由，放 app 根不会被当成页面。
   **范围封顶（飞行前裁决 R5）：** 本任务只做移动 + 最小签名改动。**不改任何 `href` / `action` / `router.push`**（任务 5 的范围），**不改任何页面的 `metadata`**（任务 6 的范围）。混进来会让任务的审查面失控，并让任务 5 的覆盖率测试失去基线。
2. `src/app/[locale]/layout.tsx` 的签名改为：

```tsx
export default async function RootLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }): Promise<ReactElement>
```

   `const { locale } = await props.params`；非法则 `notFound()`；`<html lang={locale}>`；用 `<LocaleProvider locale={safe} messages={messages(safe)}>` 包裹现有 `WishlistProvider + AssistantProvider + SiteJsonLd` 链路；字体与 `metadata` 逻辑不变。
3. **删除** `src/app/layout.tsx`（已移入 `[locale]`）——否则两个 root layout 冲突。
4. `src/app/global-not-found.tsx`：不依赖任何 layout，自带 `globals.css` 导入；文案取自 `messages(DEFAULT_LOCALE)`。
   **需要 `notFound.*` 三族键：`title`、`description`、`cta`。** 任务 2 只种下了 `title` 与 `cta`（值取自 `src/app/not-found.tsx:9,13`），
   `description` 需在本任务前补进 `src/i18n/dictionaries/en.ts`，值逐字取自 `src/app/not-found.tsx:11`
   （`'It may have moved, or the link may be out of date. The shop is still open, though.'`）——
   **不得**在组件里临时硬编码。
5. `next.config.ts` 增加 `experimental: { globalNotFound: true }`。
6. `src/proxy.ts`：

```ts
export function proxy(request: NextRequest): NextResponse
export const config: { matcher: string[] }
```

   - 排除表由 `config.matcher` 的正则承担（`api`、`_next/static`、`_next/image`、`og`、`robots.txt`、`sitemap.xml`、`favicon.ico`、`.*\\..*`）；函数内再对 `/api` 开头做一次显式早退，避免 matcher 被改坏时破坏 commerce。
   - 已带合法前缀：`NextResponse.next()` 并 `set-cookie` 写 `evoloop_locale`（`httpOnly`、`sameSite: 'lax'`、`path: '/'`、`maxAge` 一年）。
   - 无前缀：`GET`/`HEAD` → 308，其余 → 307；`location` 用 `localePath` 的结果（含 search 与 hash）。
   - 所有出口都设 `Vary: Accept-Language`；**不读也不写任何 commerce 会话 Cookie**。
7. `generateStaticParams` 由 `LOCALES` 生成（阶段 1 只有一个 'en'）。

- [ ] **步骤 4：运行测试验证通过，并确认输出等价**

运行：`npx vitest run src/proxy.test.ts "src/app/[locale]/layout.test.tsx"`
预期：PASS

运行：`npm run verify`
预期：PASS，**且 18 个断言英文文案的测试文件与 axe-gate 未被修改过**（`git diff --name-only` 里不出现它们）

- [ ] **步骤 5：Commit**

```bash
git add -A
git commit -m "refactor(i18n): move app routes under [locale] with proxy negotiation"
```

---

### 任务 5：路径收口 —— 站内链接、表单与跳转全部走 `localePath`

> **本任务是唯一一个允许修改既有测试文件的任务**（裁决 R18）。已知会被触及的 URL 断言（实测清单，
> 派单时必须逐条核对 before/after）：
> `src/components/marketing/app-bar.test.tsx:25,31,34,37,40,43,74`、
> `src/components/marketing/site-shell.test.tsx:20,28`、
> `src/components/shop/product-card.test.tsx:29`、
> `src/components/shop/saved-pairs.test.tsx:58`、
> `src/components/shop/commerce-panel.test.tsx:107`、
> `src/components/assistant/assistant.test.tsx:194`。
> 注意 `app-bar.test.tsx:34,37` 断言的是 `/#collections` / `/#story` 这类**根路径带哈希**的链接，
> `localePath('en', '/#collections')` 应得到 `/en#collections`。
> **不得**删除或放宽任何断言；**不得**改动任何非 URL 断言。

**文件：**
- 修改：`src/components/**`（`next/link` 的直接使用）、`src/app/[locale]/**`（`router.push` / `redirect` / `<form action>`）、`src/app/global-not-found.tsx`（它里面有一条 404 逃生链接 `<Link href="/shop">`，**不在 `[locale]/**` 之下，极易漏掉**——审查已把这条列为 P2 并指定纳入本任务）
- 测试：`src/components/i18n/locale-path-coverage.test.ts`

**Interfaces：**
- 消费：任务 3 的 `LocaleLink`、`localePath`。
- 产出：站内不再出现无前缀的字面量绝对路径。

- [ ] **步骤 1：编写失败的测试**

> **收口后必须重跑任务 4 新增的 `src/components/assistant/fab-landing.test.tsx`**（裁决 R17）：
> 那两条断言正是「locale 相关路径判断」的守卫。路径下移已经静默破坏过一次这类判断，
> 本任务会改动大量调用点，不得让它们失效。

```ts
// src/components/i18n/locale-path-coverage.test.ts
//
// 守卫必须是**元素感知**的（裁决 R19）。简报原写法的正则 `(href|action)=["'`]/[a-z]`
// 把「正确写法」与「错误写法」判成同一类：`<LocaleLink href="/shop">` 正是 LocaleLink 的
// 设计用法（它接站内相对路径、由它补前缀），却被判红，于是 step 4 的零命中 GREEN 永不可达。
// 这是简报自身的矛盾，不是实现者的错。
//
// **精确语义（任务 11 的 check:i18n 的 raw-path 规则必须复用同一套；两处要同步改）：**
//   命中：`next/link` 或原生 `<a>` 上的字面量 `href="/x"`；裸的 `action="/x"`；
//         未被 `localePath(...)` 包裹的 `router.push|replace('/x')`、`redirect('/x')`
//   放行：元素是 `LocaleLink` 的 `href`；任何被 `localePath(...)` 包裹的字面量；
//         站外绝对 URL、纯 `#` 锚点、`mailto:` / `tel:`
//
// 用 AST 实现（`createRequire` 取 `typescript`，与 scripts/check-slop.mjs 同款，零新依赖），
// 不要用正则做字符串匹配——那正是上面这个矛盾的根源。
// 根目录用 `process.cwd()`，**不要**用 `new URL('../../', import.meta.url)`：
// 后者在 vitest 下抛 "The URL must be of scheme file"（先例：src/test/a11y/contrast.test.ts:61）。

describe('站内路径已收口', () => {
  it('没有未经 LocaleLink / localePath 处理的裸字面量路径', () => {
    expect(collectOffenders()).toEqual([])   // 必须是零命中，不要写成「不超过 N」
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run src/components/i18n/locale-path-coverage.test.ts`
预期：FAIL，列出所有仍未收口的文件

- [ ] **步骤 3：逐个收口**

- `src/components/**` 里所有 `import Link from 'next/link'` 且 `href` 为站内相对路径的，换成 `LocaleLink`。
- `src/app/[locale]/**` 里 `router.push('/x')` / `redirect('/x')` 改为 `localePath(locale, '/x')`（`locale` 来自 `useLocale()` 或 `await props.params`）。
- `<form action="/x">` 改为 `action={localePath(locale, '/x')}`。
- 站外绝对 URL、`#` 锚点、`mailto:` / `tel:` 原样保留（`localePath` 已能识别绝对 URL；`#` 与 `mailto:` 需在调用处跳过）。

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run src/components/i18n/locale-path-coverage.test.ts`
预期：PASS

运行：`npm run verify`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add -A
git commit -m "refactor(i18n): route all internal links through localePath"
```

---

### 任务 6：SEO 与缓存 —— canonical、hreflang、OG、sitemap、robots、locale 格式化

**文件：**
- 修改：`src/lib/seo.ts`、`src/lib/market.ts`、`src/lib/format.ts`、`src/app/robots.ts`、`src/app/sitemap.ts`、`src/app/og/route.tsx`、`src/app/[locale]/**/page.tsx` 的 `metadata`/`generateMetadata`、**`src/lib/structured-data.ts` 及其 6 个调用点**
- 测试：`src/lib/seo.test.ts`（扩充）、`src/lib/format.test.ts`（扩充）、`src/app/sitemap.test.ts`（新增）、`src/app/robots.test.ts`（新增）、`src/lib/structured-data.test.ts`（新增）

> **任务拆成两个提交、两轮审查（裁决 R24）：**
> 1. **提交 1 — SEO metadata 核心**：`alternatesFor` / `pageMetadata(locale, …)` / `market.locale` 删除 / `formatPrice(amount, locale)` / `robots.ts` / `sitemap.ts` / `og` / 各页 `generateMetadata`。
> 2. **提交 2 — 逐语言结构化数据**：`structured-data.ts` 与它的 6 个调用点（`(landing)/page.tsx`、`blog/[slug]/page.tsx`、`blog/page.tsx`、`product/[handle]/page.tsx`、`shop/page.tsx`、`components/seo/site-json-ld.tsx`）补 locale 前缀与 `inLanguage`。
>
> 原计划的文件清单漏了 `structured-data.ts`，而它是 `absoluteUrl` 的重度使用者（约 15 处）——不改就会出现「canonical 是 `/en/shop`、JSON-LD 却是 `/shop`」的不一致。
>
> **裁决 R23 — 本任务可修改 `src/lib/seo.test.ts` 的既有调用点**：`pageMetadata` 签名从 `(overrides)` 变为 `(locale, overrides)`，`seo.test.ts` 里 3 处 `pageMetadata({...})` 必须跟进。授权边界同 R18/R22：只允许改「因签名变化而必须改的调用」，**不得删除、放宽或跳过任何断言**，需给 before/after 清单。该文件不在 18 个受保护清单内。

**Interfaces：**
- 消费：任务 1 的 `localePath` / `LOCALES` / `DEFAULT_LOCALE`。
- 产出：`alternatesFor(locale, path, availableLocales?)`、`pageMetadata(locale, overrides)`、`formatPrice(amount, locale)`。

- [ ] **步骤 1：编写失败的测试**

```ts
// src/lib/seo.test.ts（追加）
describe('alternatesFor', () => {
  it('canonical 指向自身的 locale 绝对 URL', () => {          // 规格 §8.5
    const { canonical } = alternatesFor('en', '/shop')
    expect(canonical).toBe(`${site.url}/en/shop`)
  })
  it('输出成对 hreflang 与 x-default', () => {
    const { languages } = alternatesFor('en', '/shop')
    expect(languages).toEqual({ en: `${site.url}/en/shop`, 'x-default': `${site.url}/en/shop` })
  })
  it('availableLocales 为空时不输出 hreflang 对', () => {      // 规格 §8.2 资格判定
    const { languages } = alternatesFor('en', '/blog/foo', [])
    expect(languages).toBeUndefined()
  })
})

describe('pageMetadata', () => {
  it('page 级 title 仍是字符串（品牌后缀由 root layout 的 title.template 施加）', () => {
    // 裁决 R27：`pageMetadata` 只做浅合并，`title: 'Shop'` 是字符串透传；
    // 原计划写的 { absolute, template, default } 形状是错的。
    expect(pageMetadata('en', { title: 'Shop' }).title).toBe('Shop')
  })
  it('canonical 不再是根路径', () => {                          // 规格 §8.5 的已知缺陷
    expect(pageMetadata('en', { title: 'Shop', path: '/shop' }).alternates?.canonical).not.toBe('/')
  })
  it('openGraph.locale 随 locale', () => {
    expect(pageMetadata('en', { title: 'Shop', path: '/shop' }).openGraph?.locale).toBe('en_US')
  })
  it('openGraph 图带 locale query（让 /og 的 ?locale= 有生产消费者）', () => {   // 裁决 R25
    expect(pageMetadata('en', { title: 'Shop', path: '/shop' }).openGraph?.images).toEqual([
      '/og?locale=en',
    ])
  })
})
```

```ts
// src/lib/format.test.ts（新增）
describe('formatPrice', () => {
  it('默认 locale 与今天一致', () => { expect(formatPrice('128.00')).toBe('$128.00') })
  it('接受显式 locale', () => { expect(formatPrice('128.00', 'en')).toBe('$128.00') })
  it('货币仍由 market.currency 决定', () => { expect(formatPrice('0.00')).toContain('$') })
})
```

```ts
// src/app/sitemap.test.ts（新增）
describe('sitemap', () => {
  it('所有 URL 都带 locale 前缀', () => {
    for (const entry of sitemap()) expect(entry.url).toMatch(/\/(en)(\/|$)/)
  })
  it('为已译页面输出 alternates', () => {
    const home = sitemap().find((e) => e.url.endsWith('/en'))
    expect(home?.alternates?.languages).toEqual({ en: expect.any(String), 'x-default': expect.any(String) })
  })
  it('不输出 lastModified 除非有可靠时间', () => {              // 沿用 seo-geo-plan 口径
    expect(sitemap().every((e) => e.lastModified !== undefined)).toBe(true)
  })
})

// src/app/robots.test.ts（新增）
describe('robots', () => {
  it('disallow 同时覆盖带前缀与无前缀形态', () => {
    const rules = robots().rules as { disallow: string[] }
    expect(rules.disallow).toContain('/en/cart')
    expect(rules.disallow).toContain('/cart')
    expect(rules.disallow).toContain('/en/checkout')
    expect(rules.disallow).toContain('/en/saved')
    expect(rules.disallow).toContain('/en/orders/')
  })
  it('sitemap 指向绝对地址', () => {
    expect(robots().sitemap).toBe(`${site.url}/sitemap.xml`)
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run src/lib/seo.test.ts src/lib/format.test.ts src/app/sitemap.test.ts src/app/robots.test.ts`
预期：FAIL，`alternatesFor is not a function` 等

- [ ] **步骤 3：实现**

```ts
// src/lib/seo.ts
export function absoluteUrl(path: string): string                                  // 保持不变
export function alternatesFor(locale: Locale, path: string, availableLocales?: readonly Locale[]): Metadata['alternates']
export function pageMetadata(locale: Locale, overrides: { title: string; description?: string; path?: string; availableLocales?: readonly Locale[] }): Metadata
```

```ts
// src/lib/format.ts
export function formatPrice(amount: string, locale: Locale = DEFAULT_LOCALE): string
```

实现约束：
- `alternatesFor` 的 `languages` 仅在 `availableLocales` 非空时输出；`canonical` 永远是 `absoluteUrl(localePath(locale, path))`。
- **`absoluteUrl()` 与 `src/lib/site.ts` 本任务不改**（飞行前裁决 R6）：locale 前缀由调用方经 `localePath` 施加，`absoluteUrl` 保持只接一个 path 参数。
- `pageMetadata(locale, …)` 的 `availableLocales` 默认 `LOCALES`（阶段 1 = `['en']`）；
  `openGraph.images` 与 `twitter.images` 输出 `` `/og?locale=${locale}` ``（裁决 R25），
  而 **`baseMetadata` 的 `images` 保持 `['/og']` 不动**（无 locale 上下文时的兜底，如 `global-not-found`）。
  `src/lib/seo.test.ts` 里**只有**这两处 `images` 的**期望值字面量**可跟进修改，其它断言一律不得动。
- `og/route.tsx` 加 `?locale=` 查询参数并用 `isLocale` 校验（非法落 `DEFAULT_LOCALE`）；
  图内文案进词典按 locale 取，语言信号用 `headers: { 'Content-Language': locale }`。
  **`ImageResponse` 没有 `inLanguage` 字段**（已核实随包文档）——原计划这句话是措辞不精确，
  `inLanguage` 的正主是提交 2 的 JSON-LD（裁决 R26）。
- `robots.ts` 的 disallow 由 `LOCALES` 展开生成（`` `/${locale}/cart` `` …）并**额外保留无前缀的旧路径**（跳转来源仍需被禁）。
- `sitemap.ts` 用 `LOCALES` 展开；`lastModified` 沿用现有 `SITE_UPDATED` 常量的行为，不新增编造时间。
- `src/lib/market.ts` 删除 `locale: 'en-US'`；**`currency` 与 `sizeSystem` 不动**。
- `og/route.tsx` 加 `?locale=` 查询参数并 `isLocale` 校验，语言相关文案走词典（详见上面实现约束）。
- 所有 `page.tsx` 的 `export const metadata` 改为 `export async function generateMetadata(props: { params: Promise<{ locale: string }> })`，内部调 `pageMetadata(locale, …)`。

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run src/lib src/app/sitemap.test.ts src/app/robots.test.ts`
预期：PASS

运行：`npm run build`
预期：PASS，且构建产物中 `/shop` 等旧路径被 308 到 `/en/shop`

- [ ] **步骤 5：Commit**

```bash
git add -A
git commit -m "feat(i18n): emit per-locale canonical, hreflang, sitemap and OG"
```

---

### 任务 7：en 词典抽取 —— 批次 A：marketing 与站点外壳

**文件：**
- 修改：`src/components/marketing/**`（`app-bar.tsx`、`hero.tsx`、`footer.tsx`、`story-section.tsx`、`promise-strip.tsx`、`collection-cards.tsx`、`faq-section.tsx`、`featured-grid.tsx`、`status-shell.tsx`、`site-shell.tsx`、`hero-background.tsx`）、`src/lib/site.ts` 的 `nav`、`src/lib/faq.ts`
- 修改：`src/i18n/dictionaries/en.ts`
- 测试：`src/i18n/dictionaries/en.test.ts`（扩充）

**Interfaces：**
- 消费：任务 2 的 `messages` / `Messages`；任务 3 的 `useMessages`。
- 产出：`marketing.*` / `nav.*` / `faq.*` 键族。

- [ ] **步骤 1：编写失败的测试**

```ts
// src/i18n/dictionaries/en.test.ts（新增）
import { describe, expect, it } from 'vitest'
import en from './en'

describe('en 词典命名空间', () => {
  // 本任务只交付这两族；其余命名空间由任务 8–10 交付，全量断言在任务 11。
  // 飞行前裁决 R7：把全量断言放在本任务会让它依赖尚未完成的后续任务。
  it.each(['nav', 'marketing'])('存在 %s 命名空间', (ns) => {
    expect(Object.keys(en).some((k) => k.startsWith(`${ns}.`))).toBe(true)
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run src/i18n/dictionaries/en.test.ts`
预期：FAIL，缺少 `marketing` 命名空间

- [ ] **步骤 3：抽取（本任务只做 marketing 与外壳）**

- 按 `docs/i18n-string-inventory-2026-10-13.md` 的 D 桶清单定位本批次文件。
- 键名规则：`<surface>.<area>.<leaf>`，全小写驼峰叶子，例如 `marketing.hero.kicker`、`nav.shop`、`faq.q1.question`。
- 组件内用 `useMessages()`（客户端）；服务端组件用 `messages(locale)`，locale 来自 `params`。
  **不要导入 `next/root-params`**（裁决 R20），也**不要写 `as Locale` 强转**——用 `isLocale(raw) ? raw : DEFAULT_LOCALE` 收窄。
- `src/lib/site.ts` 的 `nav` 数组改为**键**（`{ key: 'nav.shop', href: '/shop' }`），文案在渲染处解引用——保持单源。
- **文案值必须与抽取前逐字一致**（本阶段只有 en，任何改动都是回归）。
- 抽取后 `src/i18n/dictionaries/en.ts` 必须仍然通过任务 2 的全部测试。

- [ ] **步骤 4：运行测试验证通过**

运行：`npm run verify`
预期：PASS；`src/components/marketing/**` 的现有测试**未被修改**

- [ ] **步骤 5：Commit**

```bash
git add -A
git commit -m "refactor(i18n): extract marketing and shell copy into dictionary"
```

---

### 任务 8：en 词典抽取 —— 批次 B：shop 与商品详情

**文件：**
- 修改：`src/components/shop/**`（`commerce-panel.tsx`、`my-size-guide.tsx`、`product-filter-bar.tsx`、`product-buy-bar.tsx`、`saved-pairs.tsx`、`care-instructions.tsx`、`product-gallery.tsx`、`shopify-buy-button.tsx`、`print-spec-sheet*.tsx`、`size-selector.tsx`、`gift-gallery.tsx`、`product-actions.tsx`、`product-card.tsx`、`wishlist-*.tsx`、`product-color-selection.tsx`）、`src/app/[locale]/shop/**`、`src/app/[locale]/product/[handle]/**`、`src/app/[locale]/saved/page.tsx`、`src/app/[locale]/cart/page.tsx`、`src/app/[locale]/checkout/page.tsx`、`src/app/[locale]/orders/[id]/page.tsx`
- **本任务不负责 `src/app/[locale]/(landing)/page.tsx`**：该文件原本同时列在任务 8 与任务 10 的清单里（重复归属），现已收归**任务 10 单独所有**，包含它剩余的硬编码文案与元信息。任务 8 不要改它。
- 修改：`src/i18n/dictionaries/en.ts`、`src/lib/store-policy.ts`、`src/lib/gift-offer.ts`、`src/lib/commerce-client.ts`

**Interfaces：**
- 消费：任务 2、3、6。
- 产出：`shop.*` / `pdp.*` / `cart.*` / `checkout.*` / `orders.*` / `errors.*` 键族。

- [ ] **步骤 1：编写失败的测试**

```ts
// src/lib/commerce-client.test.ts（追加）
describe('commerce 错误文案本地化', () => {
  it.each(['variant_unavailable', 'insufficient_stock', 'empty_cart', 'order_not_found', 'backend_unavailable', 'invalid_origin'] as const)(
    '%s 有本地化文案', (code) => {
      expect(typeof messages('en')[`errors.${code}`]).toBe('string')
    },
  )
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run src/lib/commerce-client.test.ts`
预期：FAIL，`errors.variant_unavailable` 不是 string

- [ ] **步骤 3：抽取**

- 键族：`shop.*`（筛选/排序/数量/空状态）、`pdp.*`（加入购物车、尺码、护理、规格单、配送与退货）、`cart.*`、`checkout.*`、`orders.*`、`errors.*`。
- `src/lib/commerce-client.ts` 的 `messages` 映射表**改为读词典**的 `errors.<code>`，保留 `code` 作为键、保留现有兜底文案。
- `src/lib/store-policy.ts` / `gift-offer.ts` 仍是**事实单源**；句子级文案进词典，事实（阈值、名称、材质）留在原模块。
- `pdp.*` 的尺码显示继续走 `sizeLabel` / `market.sizeSystem`，**不得**因 locale 改变尺码体系（ADR 0008 决策 6）。
- 逐字一致原则同任务 7。

- [ ] **步骤 4：运行测试验证通过**

运行：`npm run verify`
预期：PASS；`src/components/shop/**` 与 `src/lib/use-modal.ts` 的现有测试**未被修改**

- [ ] **步骤 5：Commit**

```bash
git add -A
git commit -m "refactor(i18n): extract shop, product and commerce-error copy into dictionary"
```

---

### 任务 9：en 词典抽取 —— 批次 C：助手与 AI/护栏的服务端文案

**文件：**
- 修改：`src/components/assistant/**`、`src/server/ai/mock.ts`、`src/server/ai/handlers.ts`、`src/server/ai/chat.ts`、`src/server/ai/size-input.ts`、`src/server/guardrails/index.ts`、`src/i18n/dictionaries/en.ts`
- 测试：`src/server/ai/mock.test.ts`（扩充）、`src/i18n/dictionaries/en.test.ts`（扩充）

**Interfaces：**
- 消费：任务 2 的 `messages`；任务 11 的 `check:i18n` 白名单（承载本任务刻意保持英文的内部文本）。
- 产出：`assistant.*` / `guardrail.*` / `ai.*` 键族。

- [ ] **步骤 1：编写失败的测试**

```ts
// src/i18n/dictionaries/en.test.ts（追加）
describe('服务端产出的消费端文案已入词典', () => {
  it.each(['assistant.redirect', 'assistant.fallbackError', 'assistant.productRequired', 'guardrail.cooldown'])(
    '%s 存在且非空', (key) => { expect(en[key as keyof typeof en]).toBeTruthy() },
  )
  it('助手确定性回复与该键逐字一致', () => {
    expect(REDIRECT_TEXT).toBe(en['assistant.redirect'])
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run src/i18n/dictionaries/en.test.ts`
预期：FAIL，`assistant.redirect` 为 undefined

- [ ] **步骤 3：抽取**

- `mock.ts` / `handlers.ts` / `chat.ts` / `size-input.ts` / `guardrails/index.ts` 的**消费端文案**改为从词典取值。
  **飞行前裁决 R10（这是那个计划缺陷）：已导出的常量必须保持导出与字面量形状。** `REDIRECT_TEXT` 等继续是 `export const`，值写成 `en['assistant.redirect']`，**不得**改成函数。理由：`src/components/assistant/**` 的现有测试断言 `REDIRECT_TEXT` 的存在与 delta 形状，改成函数就会逼着改测试，直接违反阶段 1「18 个测试文件零改动」的硬指标。阶段 2 需要按 locale 变化时再改形态，那是阶段 2 自己的测试面。
- **`OFF_TOPIC` 关键词表、`parseSizeHint` 正则、`estTokens` 的字符比不改**——它们是行为规则，属阶段 2（`CONTEXT.md` 的 `Locale 与 Messages` 不变量）。
- `mock.ts` 的确定性回复仍是 ~8 词一段的 delta 形状（现有测试断言「仅一段」），不得改变分片数量。
- 内部/运维文本（`repository*.ts`、`guardrails/request.ts`、`bounded-store.ts`、`rate-limit.ts`、`embedder.ts`、`db/client.ts`）**保持英文，不动**，由任务 11 的白名单承载。

- [ ] **步骤 4：运行测试验证通过**

运行：`npm run verify`
预期：PASS；`src/components/assistant/**` 的现有测试**未被修改**

- [ ] **步骤 5：Commit**

```bash
git add -A
git commit -m "refactor(i18n): localize assistant and server-produced user-facing copy"
```

---

### 任务 10：en 词典抽取 —— 批次 D：剩余内容组件与全局页面

**文件：**
- 修改：`src/app/[locale]/blog/**`、`src/app/[locale]/error.tsx`、`src/app/[locale]/(landing)/page.tsx`、`src/app/global-not-found.tsx`，以及 `docs/i18n-string-inventory-2026-10-13.md` 的 D 桶中其余尚未抽取的文件
- **`src/app/[locale]/shop/empty-state.tsx` 归任务 8**（它原本同时落在任务 8 的 `shop/**` 通配与任务 10 的清单里，是一处重复归属）；已从本任务清单删除。
- **必须显式认领 `src/app/[locale]/(landing)/page.tsx` 的这三处硬编码英文**（任务 6 只改了它们的 metadata **结构**、没抽文案，很容易被漏掉）：
  `:26` 的 metadata `title`、`:42-43` 的 `webPageSchema` 的 `name` 与 `description`。
  其中 `:26` 与词典里的 `marketing.hero.title` / `marketing.footer.pitch` 是**同一句话的第 3 份拷贝**——任务 7 已按「同值不同键」保留前两条，第三条请按同样的语境判断是否复用现有键（若语境相同则复用，不要新建）。
- 修改：`src/i18n/dictionaries/en.ts`
- **明确排除**：`src/components/marketing/**`（任务 7 已整族交付，飞行前裁决 R8）

**Interfaces：**
- 消费：任务 2、6。
- 产出：`blog.*` / `error.*` / `shop.empty.*` 键族；**全量命名空间断言**（本任务是最后一个抽取任务）。

**范围封顶（飞行前裁决 R9 — 这是一个计划缺陷的修正）：** 本任务**不创建** `src/i18n/content.ts`，**不改** `src/lib/blog.ts`。

理由：阶段 1 只有 `en`，内容回退解析没有生产消费方——「只对已译页面输出 hreflang」的口径已经由任务 6 的 `alternatesFor(locale, path, availableLocales)` 表达。此时新增 `content.ts` 会产出**无人消费的导出**，而 `scripts/check-slop.mjs` 的 `dead-export` 是**阻塞**规则，`npm run verify` 会直接失败。内容解析器与 `blog.ts` 的 locale 参数随阶段 3 的真实译文一起落地，届时它们有消费者。

- [ ] **步骤 1：编写失败的测试**

```ts
// src/i18n/dictionaries/en.test.ts（追加）
// 本任务是最后一个抽取任务，所以在这里做全量断言（而非任务 7，那里会依赖尚未完成的后续任务）。
describe('全量命名空间已交付', () => {
  it.each(['nav', 'marketing', 'shop', 'pdp', 'cart', 'checkout', 'orders', 'assistant', 'guardrail', 'errors', 'blog', 'error', 'notFound'])(
    '存在 %s 命名空间', (ns) => {
      expect(Object.keys(en).some((k) => k.startsWith(`${ns}.`))).toBe(true)
    },
  )
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run src/i18n/dictionaries/en.test.ts`
预期：FAIL，列出尚未命中的命名空间

- [ ] **步骤 3：抽取**

- 抽取本批次剩余的全部 D 桶文案（`blog.*`、`error.*`、`shop.empty.*`、`orders.*` 等）。
- `formatPostDate(iso, locale)` 的 locale 参数收口到 `src/lib/format.ts`，默认 `DEFAULT_LOCALE`——**签名变化，但调用方不传参，行为与今天一致**。
- **不碰 `src/components/marketing/**`**（R8）；**不碰 `src/lib/blog.ts`**（R9）。
- 逐字一致原则同任务 7。

- [ ] **步骤 4：运行测试验证通过**

运行：`npm run verify`
预期：PASS；`src/app` 下现有测试未被修改

- [ ] **步骤 5：Commit**

```bash
git add -A
git commit -m "refactor(i18n): extract remaining page copy into dictionary"
```

---

### 任务 11：门禁接入 —— `next typegen`、`check:i18n` 与 `verify`

**文件：**
- 创建：`scripts/check-i18n.mjs`、`scripts/i18n-allowlist.json`
- 修改：`package.json`（`typecheck` 前置 `next typegen`；新增 `check:i18n` 并插入 `verify`）
- 测试：`scripts/check-i18n.test.mjs`

**Interfaces：**
- 消费：任务 7–10 完成后的抽取结果。
- 产出：阻塞门禁，防止文案回退。

- [ ] **步骤 1：编写失败的测试**

```js
// scripts/check-i18n.test.mjs
import { describe, expect, it } from 'vitest'
import { scanSource, ALLOWLIST } from './check-i18n.mjs'

describe('check-i18n', () => {
  it('识别 JSX 文本中的散文', () => {
    expect(scanSource('export const A = () => <p>Hello there</p>', 'a.tsx')).toHaveLength(1)
  })
  it('识别文案属性', () => {
    expect(scanSource('export const A = () => <img alt="Nice shoes" />', 'a.tsx')).toHaveLength(1)
  })
  it('放过 className 与 import 路径', () => {
    expect(scanSource("import x from '@/lib/a'\nconst c = 'flex items-center gap-2'", 'a.ts')).toHaveLength(0)
  })
  it('识别字面量绝对路径', () => {                 // 与任务 5 的测试互补
    expect(scanSource("export const A = () => <a href=\"/shop\">x</a>", 'a.tsx').some((f) => f.rule === 'raw-path')).toBe(true)
  })
  it('白名单覆盖内部与运维文本', () => {
    expect(ALLOWLIST.some((e) => e.path.includes('guardrails/request.ts'))).toBe(true)
    expect(ALLOWLIST.some((e) => e.path.includes('search/repository'))).toBe(true)
    expect(ALLOWLIST.every((e) => typeof e.reason === 'string' && e.reason.length > 0)).toBe(true)
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run scripts/check-i18n.test.mjs`
预期：FAIL，导入解析失败

- [ ] **步骤 3：实现门禁并接入**

```js
// scripts/check-i18n.mjs
export const ALLOWLIST = [ /* { path, rule, reason } ... */ ]
export function scanSource(source, fileName)   // 返回 { rule, line, text }[]
export function main()                          // 退出码 1 表示存在阻塞命中
```

接入 `package.json`：

```json
"typecheck": "next typegen && tsc --noEmit",
"check:i18n": "node scripts/check-i18n.mjs",
"verify": "npm run format:check && npm run typecheck && npm run check:boundary && npm run check:coupling && npm run check:catalog && npm run check:i18n && npm run check:slop && npm run lint && npm run test"
```

实现约束：
- 复用 `scripts/check-slop.mjs` 的 `createRequire` 取 `typescript`，**不新增依赖**；判定规则与 `docs/i18n-string-inventory-2026-10-13.md` 的采集方法一致（同款散文启发式），便于对照。
- 扫描范围 `src/app/**`、`src/components/**`；**排除** `src/i18n/**`、测试文件、`node_modules`、`.next`、`.worktrees`。
- 白名单必须逐条写 `reason`，覆盖：`src/db/client.ts`、`src/server/search/repository*.ts`、`src/server/guardrails/{request,bounded-store,rate-limit}.ts`、`src/server/search/embedder.ts`、`src/server/catalog/shopify-stub.ts`、`src/app/api/**` 的契约消息、`src/domain/commerce-response.ts`、`src/lib/speak-preference.ts`。
- **必须关掉任务 8 遗留的 P2-1：后端错误码与前端联合的机械对齐。** `src/lib/commerce-client.ts:16-21` 的 `ErrorCode` 是**手写联合**，与 `backend/app/application/errors.py` 无机械绑定；`Record<ErrorCode, keyof Messages>` 只能锁住「手写联合 ↔ 映射 ↔ 词典」三角，**新增一个后端错误码不会让 `tsc` 报错**，会静默走 `errors.unknown`。
  要求：`check-i18n.mjs` 解析 `errors.py` 里的 code 字面量，与前端联合做**差集**，差集只允许出现在显式白名单里（每条带 `reason`）。
  今天已知的差集成员：后端另有 `product_not_found`、`variant_not_found`、`quantity_limit`，Route Handler 另有 `invalid_origin`、`not_found`（任务 8 裁决 R30 明确决定**本轮不给 `invalid_origin` 新增文案**，它现阶段正确地走兜底串）。
  自测要求：在 `scripts/check-i18n.test.mjs` 里做**负向对照**——人为在 `errors.py` 加一个码，确认检查变红；否则这条守卫是恒真的。
- **必须给 `src/lib/gift-offer.ts` 的两条整句定性归类**（任务 8 审查确认它们全仓**无渲染点**，只进 `src/server/ai/prompts.ts` 与 `src/server/catalog/gifts.ts`）：要么搬进词典，要么进白名单并写明理由。**不允许以「散文字面量」形态被 `check:i18n` 扫到后又默默塞进白名单不说原因。**
- **初始运行 0 阻塞命中，但已知会有大量噪声命中——已有现成清单可用。** 任务 10 产出了 **120 条白名单候选**：
  `.superpowers/sdd/2026-10-13-i18n-phase1-locale-routing/task-10-whitelist-candidates.md`（含机器可读 JSON，每条 `{path,line,rule,text,category,reason}`；
  分类：样式串 55 / `'use client'` 指令 34 / SVG 几何 16 / 开发者文案 6 / API 契约 4 / 内联样式 3 / 单位串 2）。
  **三个已知坑**（任务 10 实测）：
  1. **`'use client'` 指令字面量必须特判**（34 次命中）；
  2. **cva/样式串要按 `className` 口径放过**（55 条）；
  3. **单位串（`· EU`、`US 4.5–12.5`）与 SVG 几何路径都不是散文**（18 条），但也不能静默放过——逐条写 `reason`。
  注意 `mm` 这种长度 2 的串在「含字母」启发式下本来就**不**命中，别为它做特判。
  不要把这 120 条一股脑当白名单交差：它们是**候选**，每一条要么有 `reason`，要么就该被抽掉（例如 `ui/sheet.tsx` 的 `Close` 已被任务 10 抽取，不应再出现在白名单里）。
- **初始运行必须为 0 阻塞命中**；若有命中，修抽取而不是往白名单里塞。

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run scripts/check-i18n.test.mjs && npm run check:i18n`
预期：PASS，且 `check:i18n: 0 项阻塞`

运行：`npm run verify`
预期：PASS（含 `next typegen` 前置的 `typecheck`）

运行：`npm run build`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add -A
git commit -m "chore(i18n): add extraction gate and wire typegen into verify"
```

---

### 任务 12：阶段 1 验收 —— 输出等价性与硬指标核对

**文件：** 无源码改动（仅当核对发现缺陷时才修）

- [ ] **步骤 1：核对硬指标 1 —— 现有测试文件未被修改**

运行：`git diff --name-only $(git merge-base main HEAD) HEAD -- 'src/**/*.test.tsx' 'src/**/*.test.ts' | grep -E 'app-bar|commerce-panel|my-size-guide|product-actions|product-buy-bar|product-card|product-filter-bar|saved-pairs|size-selector|wishlist-button|care-instructions|print-spec-sheet|assistant|site-shell|use-modal|axe-gate'`
预期：**空输出**（这些文件一个都不许被改）

- [ ] **步骤 2：核对硬指标 2 —— 页面正文等价**

运行：`npm run build && npm run start &`，然后对关键路径 `curl -s localhost:3000/en/shop | shasum` 与 `git stash` 前基线对比
预期：正文差异仅限 canonical、`<html lang>`、链接前缀

- [ ] **步骤 3：核对审查重点 1–5 均有测试**

对「审查重点」表逐行确认存在钉住它的测试；缺失则补测试（**不是**补文档）。

- [ ] **步骤 4：核对旧 URL 兼容**

运行：`curl -sI localhost:3000/shop | head -3`
预期：`HTTP/1.1 308`，`location: /en/shop`

运行：`curl -sI -X POST localhost:3000/cart | head -3`
预期：307

- [ ] **步骤 5：Commit（仅当步骤 1–4 产生改动）**

```bash
git add -A
git commit -m "test(i18n): cover phase-1 acceptance gaps"
```

---

## 自检

**1. 规格覆盖度**

| 规格章节 | 对应任务 |
|---|---|
| §5 路由与 `proxy.ts`（含目录形状、请求处理表、协商、兼容防环） | 任务 4 |
| §6.1 模块布局 | 任务 1、2、3、10（含 R2 的 React 适配器位置修正） |
| §6.2 服务端取用 | 任务 4（layout 用 `params` + `isLocale` 校验）。**规格原文的 `next/root-params` 方案已废弃**（裁决 R20：vitest 下导入即抛错，已实测） |
| §6.3 客户端取用（Provider / LocaleLink） | 任务 3 |
| §6.4 路径收口清单 | 任务 5 |
| §6.5 服务端产出的消费端文案 | 任务 9 |
| §7 语言/市场解耦与格式化收口 | 任务 6（`market.locale` 删除、`formatPrice`） |
| §8.1–8.3 内容存放与回退语义 | **阶段 3**（阶段 1 无译文，解析器无消费者；口径由任务 6 的 `availableLocales` 表达 — 裁决 R9） |
| §8.4 检查规则 C1–C7 | **阶段 3**（本阶段无译文可检） |
| §8.5 逐语言 metadata | 任务 6 |
| §8.6 内容翻译边界 | 阶段 3（blog 回退与 PDP 模板翻译） |
| §9 AI/防护/后端边界 | 任务 9（仅文案）；`OFF_TOPIC`/`parseSizeHint`/`estTokens` 的 locale 分支 **归阶段 2**（规格 §11 阶段 2 明列） |
| §10 门禁与测试 | 任务 11 + 各任务的测试步骤 |
| §11 阶段 1 清单 | 任务 1–11 全体 |

未遗漏；C1–C7 与阶段 2/3 的归属已显式标注，避免被误当成漏项。

**2. 步骤扫描**：每个「实现」步骤给的是签名 + 取值约束，函数体留给实现者；抽取任务（7–10）给的是键名规则与「逐字一致」约束，而不是 300 行词典内容——因为那些值已经在代码里，计划不该抄一遍。未出现「处理边界情况」「添加适当验证」这类空步骤。

**3. 类型一致性**：`Locale`（任务 1）→ `Messages`（任务 2）→ `messages(locale)`（任务 2）→ `useMessages()`/`LocaleLink`（任务 3）→ `proxy`（任务 4）→ `localePath`（任务 5）→ `alternatesFor`/`pageMetadata`/`formatPrice`（任务 6、10）→ `scanSource`/`ALLOWLIST`（任务 11）。命名在全部任务中一致，无 `clearLayers`/`clearFullLayers` 型漂移。

**6. 飞行前冲突扫描（SDD 准备阶段执行）** 另发现并已内联修正 5 处，以裁决 R5–R10 记入账本：范围封顶（R5、R6）、依赖尚未完成任务的测试断言（R7）、任务间文件重叠（R8）、无消费方的模块会被 `dead-export` 阻塞（R9）、导出形态变化会破坏「测试零改动」硬指标（R10）。

**4. 审查重点**：五行全部落到具体测试——第 1 行在任务 1（`resolveLocale` 的畸形头用例）与任务 4（`proxy` 不抛错）；第 2 行在任务 1（`localePath` 的大小写与 `enen`）与任务 4（已带前缀不跳转）；第 3 行在任务 1、4（查询串与锚点）；第 4 行在任务 4（POST → 307）；第 5 行在任务 2（空值守卫与类型一致）。

**5. 比例**：本计划约 600 行，实现它的改动涉及约 70 个源文件与 300 个词典键。计划的代码块只包含测试、签名与配置文件片段，不含函数体。
