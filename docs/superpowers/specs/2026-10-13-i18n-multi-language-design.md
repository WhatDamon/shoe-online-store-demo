# 多语言（en / zh-CN）与内容回退 — 设计规格

**日期：** 2026-10-13 · **分支：** `feat/i18n-support` · **决策记录：** `docs/adr/0008-locale-routing-and-typed-dictionaries.md`

相关文档：`docs/i18n-string-inventory-2026-10-13.md`（字符串清单快照）、`docs/seo-geo-plan.md`
（canonical / sitemap / 结构化数据验收）、`CONTEXT.md`（领域词汇与目录层）。

## 1. 概述与定位

给一个当前只有英文的 Next.js（App Router）店铺加 `zh-CN`。范围按「UI 文案先行、内容分轨」切分：

- **本期做**：URL 子路径 locale 路由、手写类型化词典、语言与市场解耦、逐语言 canonical/hreflang、
  内容「中文优先、缺则回退」机制及其检查规则、AI 与防护逻辑的语言相关性修正。
- **本期不做**：任何 i18n 运行时依赖、Python commerce 的 i18n、blog 全文翻译、
  界面内语言/尺码体系切换器、第三种语言。

设计的有意取舍是**先把「路由与词典」这两件会腐烂的事做对**，再让内容量增长。反过来做
（先翻文案、后改路由）会让所有译文在路由重构时全部失效并重测一遍。

## 2. 目标与非目标

### 目标

1. 两个 locale 的 UI 文案各自单源，**缺一条翻译在编译期失败**。
2. 旧的无前缀 URL 全部保持可达（永久跳转到默认语言），不产生 404 与权重损失。
3. 每个可收录页面输出**指向自身的** locale canonical；hreflang 只在译文确实存在时成对输出。
4. 没有译文的内容以**显式回退状态**呈现，读者能看到语言提示，爬虫看不到假 hreflang。
5. 语言与市场解耦：`SITE_MARKET` / `USD` / 尺码换算表语义不变。
6. 阶段 1 完成后，现有断言英文文案的测试与 a11y 门禁**零改动仍全绿**。

### 非目标

- 不在界面提供语言切换以外的行为切换（不做界面内尺码体系切换器）。
- 不做域名分语言、不做 `?lang=` 参数方案。
- 不引入机器翻译、不翻译运维/日志文本。
- 不改 `backend/`：`CommerceError.code` 已足够，前端按 `code` 本地化。
- 不引入 Redis 或任何跨实例共享状态。

## 3. 术语与不变量

| 术语 | 定义 | 不变量 |
|---|---|---|
| **Locale** | `'en' \| 'zh-CN'`（`src/i18n/locales.ts`） | URL 段、`<html lang>`、`Intl` 参数、词典选择共用同一个值 |
| **Messages** | 词典类型 `typeof en`（`src/i18n/messages.ts`） | `zh-CN.ts` 必须 `satisfies Messages`；键集不一致 = 编译错误 |
| **内容回退状态** | `'translated' \| 'fallback'` | 回退页不输出 hreflang、canonical 指向默认语言原文、不进 sitemap |
| **市场** | `SITE_MARKET` 决定的尺码显示体系 + `market.currency` | 与 Locale **完全正交**；locale 不改变尺码与货币事实 |

三条要保住的性质：

- **词典是纯模块。** `src/i18n/` 不依赖 `src/server/**`、不依赖 React、不做 IO、不读 `process.env`。
  原因是消费端文案既产自服务端（`src/server/ai/**`、`src/server/guardrails/**`）也渲染在客户端。
- **词典只承载文案。** 不含价格、库存、订单状态、支付结果（ADR 0004 边界不变）。
- **locale 不来自客户端可信输入。** 它只用于选择文案与格式化；任何交易事实仍由 Python commerce 重算。

## 4. 决策摘要

完整理由见 ADR 0008。落地形态：

| # | 决策 |
|---|---|
| 1 | `LOCALES = ['en','zh-CN']`，`DEFAULT_LOCALE = 'en'`，locale 放 URL 子路径 |
| 2 | `proxy.ts`（Next 16 的 `middleware` 新名）是唯一协商点；排除 `/api/**`、`/_next/**`、`/og`、`/robots.txt`、`/sitemap.xml`、静态文件 |
| 3 | 手写类型化词典，零运行时依赖，缺键编译期失败 |
| 4 | `src/i18n/` 为纯模块层，服务端与客户端都可导入 |
| 5 | `SITE_MARKET` / `currency` / 尺码换算不变，删除 `market.locale` 硬编码 |
| 6 | 服务端用 `next/root-params` 取 locale；Route Handler 不支持该 API，改由请求显式传入并校验 |
| 7 | 内容「中文优先、缺则回退」，回退是显式可查状态 |
| 8 | Python commerce 不做 i18n，前端按 `code` 本地化 |

## 5. 路由与 `proxy.ts`

### 目录形状

```
app/
  [locale]/                       ← 新的 root layout（输出 <html lang={locale}>）
    layout.tsx  error.tsx  loading.tsx  not-found.tsx
    page.tsx  (landing)/  shop/  product/[handle]/  cart/  checkout/  saved/  orders/[id]/
    blog/  blog/[slug]/
  api/**                          ← 无前缀，[locale] 的兄弟节点，天然隔离
  globals.css                     ← **不随路由移动**：root layout（`../globals.css`）与
                                     global-not-found（`./globals.css`）双边导入，放 app 顶层
                                     是唯一无需互相引用的位置（执行期裁决 R15）
  global-not-found.tsx            ← 新增
  robots.ts  sitemap.ts  og/route.tsx  favicon.ico
```

`app/global-not-found.tsx` 是文档指定解法：随包 `not-found.md` 明确列出「root layout 由顶层动态段
定义」这一场景，需要在 `next.config.ts` 打开 `experimental.globalNotFound`。它绕过正常渲染，
因此要自行引入所需样式与字体。

### 请求处理表

| 请求 | 行为 |
|---|---|
| `/api/**`、`/_next/**`、`/og`、`/robots.txt`、`/sitemap.xml`、`/favicon.ico`、带扩展名的静态文件 | 直通，不做任何 locale 处理 |
| 已带合法 locale 前缀（`/en/...`、`/zh-CN/...`） | 直通；偏好 Cookie 与路径不一致时更新 Cookie（不重定向） |
| 其余 GET / HEAD | **308** 永久跳转到 `/<resolved><path>` |
| 其余非幂等方法 | **307** 临时跳转（不把非 GET 请求永久改写） |
| 任何依赖 `Accept-Language` 的响应 | 带 `Vary: Accept-Language` |

### 协商规则

`resolveLocale(acceptLanguage, cookie)` 是纯函数，顺序：

1. 偏好 Cookie `evoloop_locale`（值经 `isLocale` 校验，非法即忽略）；
2. `Accept-Language` 按 `q` 值降序；`zh`、`zh-Hans`、`zh-CN`、`zh-SG` 等归一到 `zh-CN`；
   `en`、`en-US`、`en-GB` 等归一到 `en`；未匹配的 tag 跳过；
3. `DEFAULT_LOCALE`。

偏好 Cookie：`httpOnly` + `sameSite=lax` + `path=/`。**`proxy.ts` 不碰 commerce 会话**：
`X-Session-ID` 与既有会话 Cookie 语义完全不受影响，`/api/commerce/**` 根本不在匹配范围内。

### 兼容与防环

- 旧 URL → 新 URL 是 308，方向单向；`proxy.ts` 在跳转前先判定「已带合法前缀」，
  因此不存在 `/en/en/shop` 这类叠加跳转。防环由单元测试固定。
- 现有内部链接硬编码 `href="/shop"`、`action="/shop"`、`router.push('/cart')` 等必须改为
  locale 感知（见 6.4），否则每次站内点击都吃一次跳转。

## 6. 词典机制与取用边界

### 6.1 模块布局

```
src/i18n/
  locales.ts           LOCALES / Locale / DEFAULT_LOCALE / isLocale / resolveLocale
  dictionaries/en.ts   export default { ... } satisfies Messages
  dictionaries/zh-CN.ts
  messages.ts          export type Messages = typeof en
  index.ts             messages(locale) 映射；两语言键集一致性断言
  paths.ts             localePath(locale, path) 纯函数
  format.ts            formatPrice / formatPostDate / plural 的 locale 参数收口
  content.ts           内容「中文优先、缺则回退」解析（见 8）
```

### 6.2 服务端取用

服务端的 locale 一律来自 **`params`**（root layout 已 `isLocale` 校验并 `notFound()`），词典直接取：

```ts
// 服务端组件
const { locale } = await props.params
const t = messages(isLocale(locale) ? locale : DEFAULT_LOCALE)
```

**不使用 `next/root-params`（执行期裁决 R20，已实测）。** 原设计是让 Server Component 无需逐层传 prop
即可读取根参数，但该模块在 vitest 下是编译器替换的占位模块，**导入即抛错**，而任何导入它的模块会
污染所有渲染该树的测试（实测：`site-shell.test.tsx` → `Footer` 一并挂掉）。代价是多一处 `params` 解构，
换来的是整棵组件树可测。

**不使用 `as Locale` 强转**：用 `isLocale(raw) ? raw : DEFAULT_LOCALE` 收窄。非法 locale 的用户可见
行为由 root layout 的 `notFound()` 负责，页面层不可达。

`next/link` 在 App Router 下不会自动加 locale 前缀，因此站内链接统一走 `LocaleLink`（它自身也是
客户端组件，所以即使在服务端组件里使用也**不引入新的客户端边界**）。

### 6.3 客户端取用

`app/[locale]/layout.tsx` 把 `locale` 与该语言的词典交给 `<LocaleProvider>`（`'use client'`），
客户端组件通过 `useMessages()` / `useLocale()` 读取。词典只有几百键，随当前语言进包，
体积可控；这比给 60+ 个客户端组件逐个透传文案 props 更小步、更可回滚。

`src/components/i18n/locale-link.tsx` 导出 `<LocaleLink>`：从 context 取 locale，
用 `localePath` 生成 `href`。它替代直接使用 `next/link` 的场景（`next/link` 在 App Router 下
不会自动加前缀）。

### 6.4 路径收口清单

必须走 `localePath` / `LocaleLink` 的位置：`<Link href>`、`<form action>`、`router.push`、
`redirect()`、`metadata.alternates.canonical`、`openGraph.url`、`sitemap.ts`、JSON-LD 的 `path`、
`robots.ts` 的 sitemap 与 disallow 规则。`check:i18n` 扫描 `src/app` 与 `src/components` 中
未经包装的字面量绝对路径。

### 6.5 服务端产出的消费端文案

以下位置改为从词典取值（同一 locale 的 messages 传入）：

| 位置 | 常量 |
|---|---|
| `src/server/ai/chat.ts` | `FALLBACK_ERROR_TEXT` |
| `src/server/ai/handlers.ts` | `PRODUCT_REQUIRED_TEXT`、无匹配文案、合成用户轮 `'Give me outfit ideas.'` |
| `src/server/ai/mock.ts` | `REDIRECT_TEXT`、确定性回复正文 |
| `src/server/ai/size-input.ts` | `SizeAdvice.rationale` 两句 |
| `src/server/guardrails/index.ts` | `GUARDRAIL_MESSAGE` |

**保持英文且进门禁白名单**（防止被误翻）：`src/server/search/repository*.ts` 的不变量违规、
`guardrails/request.ts` 的配置错误、`guardrails/{bounded-store,rate-limit}.ts` 的参数断言、
`search/embedder.ts` 的内部状态、`catalog/shopify-stub.ts` 的配置错误、`src/db/client.ts` 的
日志与异常文本。

## 7. 语言 / 市场解耦与格式化收口

`src/lib/market.ts`：删除硬编码 `locale: 'en-US'`；`currency: 'USD'` 与 `sizeSystem`
（读 `SITE_MARKET`）不变。

`src/lib/format.ts` 与 `src/lib/blog.ts` 的格式化函数接受 locale：

```ts
formatPrice(amount: string, locale: Locale, currency: string): string
formatPostDate(iso: string, locale: Locale): string
plural(n: number, locale: Locale, forms: { one: string; other: string }): string
```

`plural` 对 `zh-CN` 返回同一形式（中文无复数形态差异）。**明示代价**：中文界面显示
`US 8.5` 与 `$128.00`。这是把语言与市场解耦的必然结果，也是本次刻意不动的展示契约。

顺带修掉一个既存缺陷：`src/components/shop/my-size-guide.tsx` 是客户端组件却在运行时读
`market.sizeSystem`，而 `SITE_MARKET` 无 `NEXT_PUBLIC_` 前缀 → 浏览器侧一直静默回退 `'US'`。
locale 与 sizeSystem 改由 Provider 下发后该陷阱一并消失。

## 8. SEO 与内容回退

### 8.1 内容存放约定

```
content/blog/<slug>.md            ← 默认语言（en）真源，路径与现状完全一致
content/blog/<locale>/<slug>.md   ← 其它语言译文
```

默认语言放顶层，因此现有 `src/lib/blog.ts` 的「slug 由文件名派生 + 正则白名单」性质不变，
URL 契约不变，新增语言不需要改 slug 解析。译文路径由 `path.join(dir, locale, `${slug}.md`)`
构造，`slug` 仍必须先过现有正则校验——**目录拼接不引入新的路径穿越面**。

### 8.2 回退解析

```ts
type ContentStatus = 'translated' | 'fallback'
type LocalizedPost = { post: BlogPost; status: ContentStatus; sourceLocale: Locale }
```

`getPost(slug, locale)` → `LocalizedPost | null`：目标语言文件存在且合法 → `translated`；
否则回退默认语言 → `fallback`；两者都没有 → `null`（沿用现有 404 路径）。

**hreflang 资格** = `status === 'translated'` **且** 译文的 `source_hash` 与当前默认语言正文
哈希一致。内容更新使译文过期时，该页自动失去 hreflang 资格并退回回退页的 canonical 规则——
即**门禁不阻塞编辑动作，只阻塞误导性的 SEO 输出**。

### 8.3 页面对待回退内容的差异化处理

| 页面 | 回退时 |
|---|---|
| 正文 | 渲染默认语言原文，页面显式提示「本文暂无中文版本」，并标注原文语言 |
| canonical | 指向默认语言同一 slug 的绝对 URL |
| hreflang | 不输出该语言的 hreflang 对 |
| sitemap | 不收录该 URL |
| 结构化数据 | `inLanguage` 用**实际内容**语言（默认语言），不是 URL 语言 |

> **施工提醒（阶段 3 必读）：`locale` 参数是内容语言，不是 URL 段语言。**
> `src/lib/seo.ts` 的 `alternatesFor` / `pageMetadata` 与 `src/lib/structured-data.ts` 的所有
> 构造器都是这个语义：canonical、`og:url`、hreflang 与 `inLanguage` 的目标语言都是它。
> 回退页的 URL 段语言与内容语言分裂（URL 是 `zh-CN`、内容是英文原文），所以上表的 canonical
> 规则要求调用方传**内容语言**；若照 9 个页面的既有模式机械传 URL locale，C4 会静默错
> （编译与现有测试都不会变红）。若将来需要同时表达两者，再引入独立的 `canonicalLocale` 参数，
> 阶段 3 之前不要加。

### 8.4 检查规则

`scripts/check-i18n-content.mjs`，与代码扫描 `check:i18n` 分离（前者查内容，后者查代码）。

| 规则 | 级别 | 判定 |
|---|---|---|
| C1 译文 frontmatter 合法，且 `locale` 字段与所在目录一致、`slug` 与文件名一致 | 阻塞 | 解析失败或字段不符 |
| C2 译文声明 `source_hash`，且与当前默认语言同一 slug 的正文哈希一致 | 提示 | 不一致时打印「译文已过期」清单 |
| C3 回退页不输出 hreflang 对 | **阻塞** | metadata 单元测试断言 |
| C4 回退页 canonical 指向默认语言同一 slug 的绝对 URL | **阻塞** | metadata 单元测试断言 |
| C5 回退页不进 sitemap；已译页进 sitemap 且带 hreflang | **阻塞** | sitemap 单元测试断言 |
| C6 译文存在时优先译文 | **阻塞** | `getPost(slug, 'zh-CN').status === 'translated'` 单测 |
| C7 未翻译清单始终可查 | 提示 | 打印每个 locale 的回退页数量与列表 |

`source_hash` 取默认语言正文（frontmatter 之后）的 sha256 前 12 位十六进制。它是**提示**级别，
因为编辑英文文章不应立刻让 CI 变红；真正被阻塞的是 C3/C4/C5 那几个「输出是否误导」的断言。

**可翻转的一处**：若你希望更保守，可对回退页再加 `robots: noindex, follow`。当前设计只靠
canonical 归并（Google 对跨语言重复内容的常规处理），改动点是 `pageMetadata` 的一处调用。

### 8.5 逐语言 metadata

- 每页输出**指向自身**的 locale canonical。注意现状：`pageMetadata` 从 `baseMetadata` 继承
  `alternates: { canonical: '/' }`，带 locale 后会**把全站 canonical 塌成一处**，必须改。
- `alternates.languages` 只在 8.2 的资格判定通过时输出，且必须成对（`en` / `zh-CN` / `x-default`）。
- `openGraph.locale` 随 locale；OG 图走 `/og?locale=`（`/og` 已被 proxy 排除，不带前缀）。
- `<html lang>` 用 locale；JSON-LD 加 `inLanguage`（用内容实际语言）。
- sitemap 按语言展开并为已译页带 `alternates`；沿用现状「没有可靠更新时间就不输出 `lastModified`」的口径。

### 8.6 本期内容翻译边界

| 资产 | 处理 |
|---|---|
| UI chrome / 系统反馈 / 表单校验 | 词典翻译 |
| **商品文案（PDP）** | 模板片段真翻译（约 15 片段 + `fitNotes`）；颜色名直接读 `supplier.json` 已有的 `cn`（39/39 有值）。**排期在阶段 3** |
| 集合描述（`catalog/collections.ts`，4 条） | 真翻译 |
| FAQ / `STORE_POLICY_FACTS` / `GIFT_OFFER` | 真翻译（各 5–8 句，且已是单源常量） |
| **blog（5 篇，11 017 字节）** | **保持英文**，走 8.3 的回退规则 |
| 护理指引 `POLICY_CARE` | 内容译，但**保留英文海报原图**并在页面注明海报为英文原版 |

## 9. AI / 防护 / 后端边界

| 项 | 处理 |
|---|---|
| AI 回答语言 | locale 进 `/api/ai/chat` 请求体，`isLocale` 校验；`systemFor(mode, { locale })` 追加语言指令 |
| 助手确定性文案 | `mock.ts`、`handlers.ts`、`chat.ts`、`size-input.ts`、`guardrails/index.ts` 的消费端文案进词典 |
| `OFF_TOPIC` 关键词表 | **按 locale 分表**——中文离题输入当前不被拦截，这是功能缺口 |
| `parseSizeHint` | **按 locale 分表**，支持「厘米 / 公分 / 码」——当前中文尺码输入解析不出 |
| `estTokens` | 按 locale 采用不同字符/token 比——中文当前被低估数倍，可穿透 `AI_DAILY_TOKEN_CAP` |
| 护栏语义 | 上限值仍「调用时读 env」；`GuardrailError.code` 不变，只有文案本地化 |
| ADR 0004 边界 | 不变：AI 输出与商品卡仍不携带价格 |
| Python commerce | **不做 i18n**。前端按 `CommerceError.code` 本地化（`commerce-client.ts` 现有映射表即接口）。`OrderView.message` 当前无界面渲染，暂不动 |
| Shopify | 仍默认关闭，不因 i18n 改变入口语义 |

## 10. 门禁与测试

### 新增/修改的门禁

| 门禁 | 内容 |
|---|---|
| `verify` 增加 `next typegen` | 前置于 `typecheck`。`tsconfig.json` 已 include `.next/types/**/*.ts`，CI 冷检出时不存在；`[locale]` 根参数与 `PageProps` 类型依赖生成产物 |
| `scripts/check-i18n.mjs` → `npm run check:i18n` | 扫描 `src/app` + `src/components` 中未经 `src/i18n` 收口的散文字面量与字面量绝对路径；带**白名单**承载「必须保持英文」的运维/日志文本。风格对齐 `check-server-boundary.mjs` |
| `scripts/check-i18n-content.mjs` | 8.4 的 C1–C7 |
| `check:coupling` / `CONTEXT.md` | 补 `src/i18n/` 的层依赖规则（纯模块，不依赖 `src/server/**` 与 React） |

### 新增测试

- `resolveLocale`：`q` 值排序、`zh-Hans`/`zh-SG` 归一、非法 Cookie、空 `Accept-Language`。
- `proxy.ts`：排除表逐项、308/307 分流、防环（`/en/en/...`）、`Vary` 头。
- 词典：两语言键集一致（运行时断言 + 类型层 `satisfies`）、无空值。
- `localePath`：根路径、带查询串、已是绝对 URL 时不重复加前缀。
- metadata：每个 locale 的 canonical 自指、hreflang 成对与 `x-default`、回退页 C3/C4。
- sitemap：C5。
- 内容：C6，含「译文过期 → 失去 hreflang 资格」。
- a11y：现有 `axe-gate` 与 `contrast` 在两个 locale 下各跑一次；`lang` 属性正确。

### 阶段 1 的硬指标

现有**18 个断言英文文案的测试文件**与 `axe-gate` 的标题层级断言（`[1,2,3,3,3]`）、
内联 `<h1>Evoloop</h1>`、`SAMPLE_PRODUCT` 全部**零改动仍全绿**。实现手段：测试环境
（`src/test/setup.ts`）默认注入 `en` 词典，使组件在测试中的默认输出与今天逐字节一致。

## 11. 分阶段交付与回滚

| 阶段 | 内容 | 验收 | 回滚 |
|---|---|---|---|
| **0** | 本规格 + ADR 0008 + 字符串清单快照 + `CONTEXT.md` 层规则 | 你审阅 | 纯文档，删文件即可 |
| **1** | **仅 `en`**：`src/i18n/` 骨架 + 词典 + `LocaleProvider` + `LocaleLink`；`app/**` → `app/[locale]/**` + `proxy.ts` + `global-not-found`；路径收口；canonical/hreflang/OG/sitemap/robots 按 locale；`next typegen` 与 `check:i18n` 进门禁 | `npm run verify` + `npm run build` 全绿；页面正文与改造前一致（差异仅限 canonical、`lang`、链接前缀）；18 个测试文件零改动 | `git revert` 该阶段提交；308 保证前后旧 URL 都可达 |
| **2** | 加 `zh-CN`：词典 + 语言入口 + AI/护栏/mock/rationale 文案 + `Accept-Language` 协商 + `estTokens` 与 `OFF_TOPIC`/`parseSizeHint` 的 locale 分支 + `check:i18n-content.mjs` | verify 全绿；两 locale 的 axe/对比度回归；中文 token 估算修正 | 词典与 locale 列表可回退（收窄为 `en`） |
| **3** | 内容：商品文案模板翻译（含 `colors[].cn` 接入）、集合描述、FAQ/店务礼物、blog 回退规则落地 | 译文经人工复核；sitemap/hreflang 只对已译页展开 | 内容层独立于 1–2 |
| **4** | 硬化：CJK 字体方案（子集 vs 系统回退）、CJK 排版与对比度复检、护理海报口径落地 | `npm run verify:all` + 真机复测 | 各子项独立 |

**不并行做 UI 与内容翻译**：先让路由与词典机制稳定，再让内容量增长。

## 12. 未决与已知风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 阶段 1 触及全部路由 | 这是本次最大的一次性改动 | 单次提交 + 308 兼容 + 「仅 en 时输出不变」的硬指标 |
| CJK 字体 | 现有 Geist / Newsreader 只加载 `latin` 子集，中文必然回退系统字体 | 阶段 4 决定：引入 CJK 子集或明确接受系统字体回退；先把影响量化 |
| `check:slop` 阻塞规则 | 词典文件必须被真实入口引用、导出必须被消费 | 词典经 `messages.ts` → `LocaleProvider`/`messages(locale)` 被消费，天然可达；阶段 1 就要让 `verify` 通过。注意：泛指「不存在的 `server.ts` 入口」的设计已被 R20 废弃 |
| 中文 token 预算 | `estTokens` 低估数倍 | 阶段 2 必做，否则日预算形同虚设 |
| 译文过期 | 英文原文更新后译文静默发散 | `source_hash` 提示 + 过期即失去 hreflang 资格（C2 + 8.2） |
| 护理海报 | 译文与英文原版图片并存 | 页面注明海报为英文原版（阶段 4） |
| 语言入口位置 | AppBar 已有 44 处文案，加切换器会挤压移动端布局 | 阶段 2 实现时单独走一次移动端与 a11y 复检 |
| 决策冲突 | 决策 #9 的「全站仍英文/USD」被部分取代 | 已在 ADR 0008 显式记录取代关系，原规格决策日志不改 |
