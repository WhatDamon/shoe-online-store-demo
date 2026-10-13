# i18n 字符串清单快照 — 2026-10-13

> **这是带日期的快照，不是常驻状态描述。** 依据 `AGENTS.md` 的纪律，常驻文档只写要求与复核命令，
> 数字与行号会腐烂。本文记录 `b82352a`（`feat/i18n-support` 分支起点）的扫描结果，
> 供多语言抽取阶段当工作清单使用；实施后本文的数字即失效，不得当作当前状态引用。

## 采集方法与可复现命令

用 TypeScript 编译器 API 做 AST 扫描（不是按行 grep）。判定规则：

- 扫描范围：`src/`（排除 `node_modules`、`.next`、`.worktrees`），**排除测试文件**
  （`*.test.*` / `*.spec.*`）。
- **JSX 文本节点**：满足散文启发式的 `JsxText`。
- **文案属性**：`aria-label` / `title` / `placeholder` / `alt` / `label` / `aria-description` /
  `aria-placeholder` 上的字符串字面量。
- **散文字面量**：满足散文启发式的 `StringLiteral` / `NoSubstitutionTemplateLiteral`，
  排除 import 路径、属性名、`className`。
- 散文启发式：去空白后长度 ≥3、含字母、不是纯路径/URL 形状（排除 `^[\w./@:%#?&=+~^{}-]+$`），
  且（含词间空格 或 长度 ≥12）。

启发式必然有假阳性与假阴性：它会漏掉**不含空格且短于 12 字符**的文案（如 `'Search'`），
也不会识别**模板字符串插值**里的静态文案（`JsxExpression` 内的 `` `Wishlist, ${n} items` ``）。
因此下面的数字是**上限近似**，不是可翻译键数——真实词典规模见「分类」一节。

扫描脚本落在 `/tmp`（一次性工具，不提交）：它 `createRequire` 复用
`scripts/check-slop.mjs` 已依赖的 `typescript`，因此不新增任何依赖，也不需要改 `package.json`。
复核方式：在仓库任意干净检出上重跑同一脚本；本文的桶划分规则见下节。

## 分类

| 桶 | 含义 | 处理 |
|---|---|---|
| **D** | 词典候选：`src/components`、`src/app`、`src/lib`、`src/domain` 的 UI 与系统反馈文案 | 进 `src/i18n/dictionaries/` |
| **S** | 服务端产出文本：`src/server/**` 与 Route Handler 响应体 | **必须三分**，见下节 |
| **C** | 内容资产：商品策展文案、集合描述 | 内容本地化通道，不进 UI 词典 |
| **N** | 非文案：cva class map、CSS 类模板、SVG 几何、localStorage 键、日志/异常串 | 不翻译 |

本节的分桶汇总表与逐文件清单都是**前缀规则（按目录）的机器输出**，其后是人工核实后的下修。
不要把机器输出直接当作工作清单：它会把 SVG 路径数据当成文案，也会把 API 契约消息当 UI 文案。

合计：**87 个文件、450 个候选**（JSX 文本 81 / 文案属性 26 / 散文字面量 343）。

机器分桶：

| 桶 | 文件数 | 合计 | JSX 文本 | 文案属性 | 散文字面量 |
|---|---:|---:|---:|---:|---:|
| D | 65 | 333 | 81 | 26 | 226 |
| S | 12 | 33 | 0 | 0 | 33 |
| C | 3 | 41 | 0 | 0 | 41 |
| N | 7 | 43 | 0 | 0 | 43 |

**D 桶 316 是上限，不是键数。**（下修后的数字，见下节。）保留在 D 里的也仍有非文案成员，
例如 `src/app/og/route.tsx` 的 2 个 JSX 文本是**真实文案**（OG 图标题）须保留，但同文件里的
`'space-between'` 这类样式值就不是；`src/server/catalog/seed.ts` 整块属内容资产而非 UI 词典。
**真实词典规模量级在 200–300 键**，具体以阶段 1/2 抽取时的实际条目为准。
其中 `src/lib/` 里已经是单源常量的部分（`faq.ts` 8、`store-policy.ts` 8、`gift-offer.ts` 5、
`site.ts` 7）改造成本最低。

### 人工核实后的下修（抽查逐文件确认）

| 文件 | 候选 | 机器桶 | 修正为 | 理由 |
|---|---:|---|---|---|
| `src/components/shop/product-visual.tsx` | 9 | D | **N** | 全部是 SVG 路径数据（`M0 … Q …`），零可见文本 |
| `src/components/marketing/hero-background.tsx` | 2 | D | **N** | `className` 模板字符串与 `opacity-*` 类名 |
| `src/domain/commerce-response.ts` | 1 | D | **N** | `'Invalid commerce response'` 是校验器内部抛出，从不渲染 |
| `src/lib/speak-preference.ts` | 1 | D | **N** | `'evoloop:speak'` 是 localStorage 键名 |
| `src/app/api/ai/chat/route.ts` | 2 | D | **S** | API 响应体契约消息，按 ADR 0008 决策 8 保持英文、前端按 `code` 本地化 |
| `src/app/api/commerce/[...path]/route.ts` | 2 | D | **S** | 同上（`'Request body is too large'` / `'Request body is invalid'`） |
| `src/server/catalog/shopify-stub.ts` | 3 | C | **N** | 配置错误文本（`'Shopify adapter not configured'`），面向运维 |

下修后：

| 桶 | 文件数 | 合计 | JSX 文本 | 文案属性 | 散文字面量 |
|---|---:|---:|---:|---:|---:|
| D | 59 | 316 | 81 | 26 | 209 |
| S | 14 | 37 | 0 | 0 | 37 |
| C | 2 | 38 | 0 | 0 | 38 |
| N | 12 | 59 | 0 | 0 | 59 |

## S 桶必须三分：消费端文案 / API 契约消息 / 开发者文案

这是本清单最重要的一条结论。S 桶里混着三类性质完全不同的字符串：

**必须进词典（服务端产出、浏览器渲染）：**

| 位置 | 内容 |
|---|---|
| `src/server/guardrails/index.ts` | `GUARDRAIL_MESSAGE`（“The assistant is taking a short break — try again in a moment.”） |
| `src/server/ai/chat.ts` | `FALLBACK_ERROR_TEXT` |
| `src/server/ai/handlers.ts` | `PRODUCT_REQUIRED_TEXT`、无匹配文案、`'Give me outfit ideas.'` 合成用户轮 |
| `src/server/ai/size-input.ts` | `SizeAdvice.rationale` 两句 |
| `src/server/ai/mock.ts` | `REDIRECT_TEXT` 与确定性回复正文 |

**必须保持英文、且要进门禁白名单（不论它落在哪个桶——这是决策，不是分桶结果）：**
| 位置 | 内容 | 理由 |
|---|---|---|
| `src/server/search/repository{,-postgres}.ts` | `'AI budget reservation day is missing'` | 内部不变量违规 |
| `src/server/guardrails/request.ts` | `'AI_SESSION_SECRET must contain at least 32 bytes'` | 配置错误，面向运维 |
| `src/server/guardrails/{bounded-store,rate-limit}.ts` | 构造参数断言 | 开发者断言 |
| `src/server/search/embedder.ts` | `'Real AI is disabled'` | 内部状态 |
| `src/server/catalog/shopify-stub.ts` | `'Shopify adapter not configured (...)'` | 内部配置错误 |
| `src/db/client.ts` | 同族文本 | 日志与异常 |

`check:i18n` 必须有白名单机制承载后两类，否则门禁会逼出「把运维错误信息也翻译掉」这种反向错误。

第三类是 **API 契约消息**：`src/app/api/ai/chat/route.ts` 与
`src/app/api/commerce/[...path]/route.ts` 返回的 `{ code, message }` / `{ code, detail }`。
它们**保持英文**，由前端按 `code` 映射本地化文案（沿用
`src/lib/commerce-client.ts` 已有的映射表模式）。这样后端与 Route Handler 都不需要语言分支，
错误契约只有一份。注意 `chat/route.ts` 的 `session_unavailable` 分支已经复用
`FALLBACK_ERROR_TEXT`——那条属第一类，进词典；其余按 `code` 走。

## 完整逐文件清单

`分类` 列是**机器分桶的原始输出**；标 `→` 的 7 行已被下节的人工核实推翻，按箭头右侧取值。

| 分类 | 文件 | JSX 文本 | 文案属性 | 散文字面量 | 合计 |
|---|---|---:|---:|---:|---:|
| D | `src/components/marketing/app-bar.tsx` | 0 | 6 | 15 | **21** |
| D | `src/components/shop/commerce-panel.tsx` | 12 | 0 | 9 | **21** |
| D | `src/components/shop/my-size-guide.tsx` | 4 | 3 | 13 | **20** |
| D | `src/components/shop/product-filter-bar.tsx` | 4 | 3 | 7 | **14** |
| D | `src/components/assistant/assistant-panel.tsx` | 3 | 2 | 7 | **12** |
| D | `src/components/marketing/story-section.tsx` | 5 | 0 | 6 | **11** |
| D | `src/components/marketing/promise-strip.tsx` | 1 | 1 | 7 | **9** |
| D | `src/components/shop/care-instructions.tsx` | 2 | 3 | 4 | **9** |
| D → N | `src/components/shop/product-visual.tsx` | 0 | 0 | 9 | **9** |
| D | `src/components/shop/product-buy-bar.tsx` | 1 | 0 | 7 | **8** |
| D | `src/components/shop/saved-pairs.tsx` | 5 | 0 | 3 | **8** |
| D | `src/lib/faq.ts` | 0 | 0 | 8 | **8** |
| D | `src/lib/store-policy.ts` | 0 | 0 | 8 | **8** |
| D | `src/app/blog/page.tsx` | 2 | 0 | 5 | **7** |
| D | `src/app/shop/page.tsx` | 4 | 0 | 3 | **7** |
| D | `src/components/assistant/suggestion-chips.tsx` | 0 | 0 | 7 | **7** |
| D | `src/lib/commerce-client.ts` | 0 | 0 | 7 | **7** |
| D | `src/lib/site.ts` | 0 | 0 | 7 | **7** |
| D | `src/app/error.tsx` | 2 | 1 | 3 | **6** |
| D | `src/components/assistant/message-list.tsx` | 2 | 0 | 4 | **6** |
| D | `src/components/shop/gift-gallery.tsx` | 1 | 1 | 4 | **6** |
| D | `src/components/shop/product-gallery.tsx` | 0 | 0 | 6 | **6** |
| D | `src/components/shop/shopify-buy-button.tsx` | 1 | 0 | 5 | **6** |
| D | `src/app/product/[handle]/page.tsx` | 5 | 0 | 0 | **5** |
| D | `src/components/shop/print-spec-sheet-button.tsx` | 0 | 2 | 3 | **5** |
| D | `src/components/shop/print-spec-sheet.tsx` | 3 | 1 | 1 | **5** |
| D | `src/components/shop/size-selector.tsx` | 2 | 0 | 3 | **5** |
| D | `src/lib/gift-offer.ts` | 0 | 0 | 5 | **5** |
| D | `src/app/not-found.tsx` | 1 | 1 | 2 | **4** |
| D | `src/app/saved/page.tsx` | 2 | 0 | 2 | **4** |
| D | `src/components/assistant/fab.tsx` | 1 | 1 | 2 | **4** |
| D | `src/components/shop/product-actions.tsx` | 2 | 0 | 2 | **4** |
| D | `src/lib/seo.ts` | 0 | 0 | 4 | **4** |
| D | `src/lib/structured-data.ts` | 0 | 0 | 4 | **4** |
| D | `src/app/(landing)/page.tsx` | 0 | 0 | 3 | **3** |
| D | `src/app/shop/empty-state.tsx` | 3 | 0 | 0 | **3** |
| D | `src/components/assistant/product-result-card.tsx` | 0 | 0 | 3 | **3** |
| D | `src/components/assistant/use-chat-stream.ts` | 0 | 0 | 3 | **3** |
| D | `src/components/marketing/collection-cards.tsx` | 2 | 0 | 1 | **3** |
| D | `src/components/marketing/footer.tsx` | 2 | 0 | 1 | **3** |
| D | `src/components/marketing/hero.tsx` | 1 | 1 | 1 | **3** |
| D | `src/components/marketing/site-shell.tsx` | 1 | 0 | 2 | **3** |
| D | `src/components/shop/wishlist-button.tsx` | 0 | 0 | 3 | **3** |
| D → S | `src/app/api/ai/chat/route.ts` | 0 | 0 | 2 | **2** |
| D → S | `src/app/api/commerce/[...path]/route.ts` | 0 | 0 | 2 | **2** |
| D | `src/app/blog/[slug]/page.tsx` | 1 | 0 | 1 | **2** |
| D | `src/app/og/route.tsx` | 2 | 0 | 0 | **2** |
| D | `src/app/orders/[id]/page.tsx` | 0 | 0 | 2 | **2** |
| D | `src/components/assistant/markdown-lite.tsx` | 0 | 0 | 2 | **2** |
| D | `src/components/marketing/faq-section.tsx` | 2 | 0 | 0 | **2** |
| D | `src/components/marketing/featured-grid.tsx` | 2 | 0 | 0 | **2** |
| D → N | `src/components/marketing/hero-background.tsx` | 0 | 0 | 2 | **2** |
| D | `src/components/shop/product-card.tsx` | 0 | 0 | 2 | **2** |
| D | `src/components/shop/wishlist-provider.tsx` | 0 | 0 | 2 | **2** |
| D | `src/lib/use-modal.ts` | 0 | 0 | 2 | **2** |
| D | `src/app/cart/page.tsx` | 0 | 0 | 1 | **1** |
| D | `src/app/checkout/page.tsx` | 0 | 0 | 1 | **1** |
| D | `src/components/assistant/assistant-page-anchor.tsx` | 0 | 0 | 1 | **1** |
| D | `src/components/assistant/assistant-provider.tsx` | 0 | 0 | 1 | **1** |
| D | `src/components/assistant/session.ts` | 0 | 0 | 1 | **1** |
| D | `src/components/marketing/status-shell.tsx` | 0 | 0 | 1 | **1** |
| D | `src/components/shop/product-color-selection.tsx` | 0 | 0 | 1 | **1** |
| D | `src/components/shop/wishlist-icon.tsx` | 0 | 0 | 1 | **1** |
| D → N | `src/domain/commerce-response.ts` | 0 | 0 | 1 | **1** |
| D → N | `src/lib/speak-preference.ts` | 0 | 0 | 1 | **1** |
| S | `src/server/ai/mock.ts` | 0 | 0 | 12 | **12** |
| S | `src/server/guardrails/index.ts` | 0 | 0 | 5 | **5** |
| S | `src/server/ai/handlers.ts` | 0 | 0 | 3 | **3** |
| S | `src/server/ai/prompts.ts` | 0 | 0 | 2 | **2** |
| S | `src/server/ai/size-input.ts` | 0 | 0 | 2 | **2** |
| S | `src/server/search/repository-postgres.ts` | 0 | 0 | 2 | **2** |
| S | `src/server/search/repository.ts` | 0 | 0 | 2 | **2** |
| S | `src/server/ai/chat.ts` | 0 | 0 | 1 | **1** |
| S | `src/server/guardrails/bounded-store.ts` | 0 | 0 | 1 | **1** |
| S | `src/server/guardrails/rate-limit.ts` | 0 | 0 | 1 | **1** |
| S | `src/server/guardrails/request.ts` | 0 | 0 | 1 | **1** |
| S | `src/server/search/embedder.ts` | 0 | 0 | 1 | **1** |
| C | `src/server/catalog/seed.ts` | 0 | 0 | 34 | **34** |
| C | `src/server/catalog/collections.ts` | 0 | 0 | 4 | **4** |
| C → N | `src/server/catalog/shopify-stub.ts` | 0 | 0 | 3 | **3** |
| N | `src/components/ui/button.tsx` | 0 | 0 | 13 | **13** |
| N | `src/db/client.ts` | 0 | 0 | 11 | **11** |
| N | `src/components/ui/badge.tsx` | 0 | 0 | 7 | **7** |
| N | `src/components/ui/sheet.tsx` | 0 | 0 | 7 | **7** |
| N | `src/components/ui/accordion.tsx` | 0 | 0 | 3 | **3** |
| N | `src/components/ui/input.tsx` | 0 | 0 | 1 | **1** |
| N | `src/components/ui/skeleton.tsx` | 0 | 0 | 1 | **1** |

## C 桶：内容资产（不走 UI 词典）

### 商品文案是模板拼装的，不是逐款手写

`src/server/catalog/seed.ts` 的 `toProduct()` 用少数片段拼出全部商品文案：

- `descParts`：`A <gender> everyday sneaker offered in N colorway(s): <colors>.`
  与 `Available in <sizeRun>.` / `Size range to be confirmed by the studio.`
- `sizeRunText()`：`Women's US <lo>–<hi>` / `Men's US <lo>–<hi>`
- `subtitles`：`<gender> · N colorways`
- `features`：`N colorways` / `Size run <sizeRun>` / `Fits true to size` / `Size range to be confirmed`
- `fitNotes`：`Fits true to size with a medium width; if between sizes, size up.`
- `GENDER_WORD` 映射

**含义：** 28 款商品的描述中文化工作量是**约 15 个模板片段 + 一句 `fitNotes`**，
不是 28 × 5 条独立文案。

### 颜色名已有中文，零翻译成本

`src/server/catalog/data/supplier.json` 的 `colors[]` 每项同时带 `en` 与 `cn`：
**39 个去重颜色名，`cn` 字段 39/39 全部有值**（例：`Ink Black => 暗黑`、`Lake Blue => 湖蓝`、
`Duckling Yellow => 鹅蛋黄`）。中文站点的颜色名直接读 `cn`，不需要翻译表。

`supplier.json` 另有 9 个 gift 条目，其名称与文案在 `src/lib/gift-offer.ts` 与 gift 画廊层渲染。

### blog 是真正需要人工翻译的部分

`content/blog/` 为 5 篇手写 Markdown（`3d-printed-shoes-daily-commute`、
`finding-your-evoloop-size`、`how-to-choose-shoes-for-wide-feet`、
`sustainable-on-demand-3d-printing`、`what-are-3d-printed-shoes`），
共 11 017 字节的英文正文 + 每篇的 YAML frontmatter（`title`/`date`/`description`/`tags`）。
这是本次唯一「无法靠模板与既有数据解决」的内容资产，也是内容回退策略的适用对象。

### 护理指引有物理对应物

`src/lib/store-policy.ts` 的 `POLICY_CARE` 逐条来自一张**纯英文护理海报**的图像提取。
译文会把页面文字与随页展示的海报图片分离，需要在页面上注明海报为英文原版。

## 语言相关性逻辑（不是文案问题，是功能缺口）

这些不是「翻译字符串」能解决的，必须在功能层按 locale 分支：

| 位置 | 现状 | 引入中文后的实际后果 |
|---|---|---|
| `src/server/ai/mock.ts` `OFF_TOPIC` | 英文关键词表 | 中文离题输入**不再被拦截**，助手照答 |
| `src/domain/size.ts` `parseSizeHint` | 匹配 `us`/`eu`/`size`/`cm`/`jp` 与 ASCII 数字 | 「我脚长 26 厘米」「42 码」**解析不出尺码** |
| `src/server/guardrails/text.ts` `estTokens` | `Math.ceil(len / 4)` | 中文约 1 字符 ≈ 1 token，token 预算被**低估数倍**，可穿透 `AI_DAILY_TOKEN_CAP` |
| `src/lib/format.ts` `formatPrice` | 硬编码 `new Intl.NumberFormat('en-US', …)` + `USD` | 中文界面仍显示美式货币格式 |
| `src/lib/blog.ts` `formatPostDate` | 硬编码 `Intl.DateTimeFormat('en-US')` | 中文日期格式不变 |
| `src/app/layout.tsx` 字体 | Geist / Geist_Mono / Newsreader，`subsets: ['latin']` | **CJK 字形全部回退系统字体**，中文排版不可控 |
| `src/components/shop/my-size-guide.tsx` | `'use client'` 却在运行时读 `market.sizeSystem` | `SITE_MARKET` 无 `NEXT_PUBLIC_` 前缀，浏览器侧一直静默回退 `'US'`；locale 有同样陷阱，必须由 Provider 下发 |

`market`（`src/lib/market.ts`）在非测试代码中只被 3 处引用：`src/app/shop/page.tsx`、
`src/components/shop/my-size-guide.tsx`、`src/domain/size.ts` 的默认参数。改动涟漪很小且已界定。

## 测试与门禁的连带影响

- **18 个测试文件**断言英文文案（`getByText` / `toHaveTextContent` / `getByLabelText` /
  `getByPlaceholderText` / `getByRole` 的 name），分布在 assistant、marketing、shop 与
  `lib/use-modal`。阶段 1 的硬指标是这些文件**零改动仍全绿**（靠测试环境默认注入 `en` 词典）。
- `src/test/a11y/axe-gate.test.tsx` 内嵌 `SAMPLE_PRODUCT`（`'Urban Bloom'`、`'Unisex · 5 colorways'`、
  `'US 7'`）与内联 `<h1>Evoloop</h1>`，并断言标题层级等于 `[1,2,3,3,3]`。
- `scripts/check-slop.mjs` 的 `unreferenced-file` 与 `dead-export` 是**阻塞**规则：词典文件必须被
  真实入口引用、导出必须被消费，否则 `npm run verify` 直接失败。这正好防止词典变成孤儿文件。
- `src/app/robots.ts` 目前 disallow `/cart`、`/checkout`、`/saved`、`/orders/` 四条**无前缀**路径；
  加 locale 前缀后这四条必须覆盖前缀形态，同时保留裸路径以兼容旧 URL 跳转来源。
- `tsconfig.json` include 了 `.next/types/**/*.ts`，而 CI 冷检出时该目录不存在；
  `[locale]` 根参数与 `PageProps` 的类型依赖生成产物，`verify` 需要 `next typegen` 前置。

## 数据库文档侧的冲突登记

`docs/superpowers/specs/2026-09-04-shoe-store-ai-design.md` 决策 #9 原文为
「配置级单市场切换 + mm 锚换算表 → **全站仍英文/USD**」。本清单所属的多语言工作
**部分取代**该决策的后半句。已按 `AGENTS.md` 的要求记录差异、影响与建议，并落成
`docs/adr/0008-locale-routing-and-typed-dictionaries.md`；不得直接删改原规格中的决策日志。
