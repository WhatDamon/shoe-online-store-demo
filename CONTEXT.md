# CONTEXT — 领域词汇表

本文件是**语言**的单一来源：读代码前先读这里。每个术语给出定义与**不变量**——不变量是改代码时必须
保住的东西，也是评审时最该问的问题。架构决策的来龙去脉在 [`docs/adr/`](./docs/adr/)。

## 目录层

| 层 | 可以依赖 | 不可以依赖 |
|---|---|---|
| `src/domain/` | 只依赖 `src/lib` 中的纯模块（`market`）与 `src/i18n/locales.ts` 的 **`Locale` 类型** | 不依赖 `src/server/**`、不依赖 React |
| `src/i18n/` | 只依赖自身（`locales` / `dictionaries`） | **纯层**：无 React、无 `src/server/**`、无 `src/db`、无 IO、无 `process.env`；**不携带价格/库存/订单等交易事实**（ADR 0004） |
| `src/server/` | `src/domain`、`src/lib`、`src/i18n`、`src/db` | 不被 `'use client'` 文件**运行时**导入 |
| `src/components/` | `src/domain`、`src/lib`、`src/i18n` | 同上 |
| `src/components/i18n/` | `src/i18n` | 同上；**React 适配器只能住在这里**，不得上移到 `src/i18n/`（否则破坏该层的 React-free 不变量） |

`scripts/check-server-boundary.mjs` 在 `verify` 中强制最后一条：`'use client'` 文件可以有
`import type`（类型擦除，不产生运行时依赖），但不能有运行时 `@/server/**` 导入。

`src/i18n/` 之所以是纯层：它同时被 `src/server/**`（服务端取文案）与 `'use client'` 组件导入，
任何一侧的依赖都会把它拖进另一侧。字典只装**展示文案**，取用的形状（服务端 `messages(locale)`、
客户端 `useMessages()`）在 `src/components/i18n/`。

---

## CanonicalSize

**定义：** 尺码的唯一存储形式 —— **EU 整档，35–48 的整数**（`type CanonicalSize = number`，
`src/domain/size.ts` 提供 `nearestCanonical` / `parseSizeHint` / `convert`）。

#### 不变量

- `Product.sizes` 只存 canonical；**任何其它体系（US/UK/JP/CN）都只在展示边界换算**，
  绝不入库、绝不进 URL 契约以外的持久层。
- 换算以脚长 mm 为锚（`src/domain/size-fixture.ts` 的 `sizeRows`）：`convert` 经 US 锚点二次
  换算并回环校验，表外值返回 `null`。`sizeLabel` 对 `null` 回退为 `EU <n>`，**绝不渲染 `US null`**。
- 空 `sizes` 是合法状态（供应商「暂无尺码」款）：卡片的 `sizeRange` 为 `null`，徽标不渲染。
  注意 `Math.min([])` 是 `Infinity`，故任何区间计算必须先判空。

**代价：** `sizeRows` 是**演示数据，尚未对照权威尺码表核实**（用户已知悉并接受）。因此测试必须
**从 `sizeRows` 推导期望值**，不得手写 mm↔EU 对照——手写对照只会验证测试自己编的数字。

---

## Product / ProductView

**定义：** `Product`（`src/domain/product.ts`）是目录事实：`handle`（= 供应商货号小写，如 `dc-1001`）、
marketing 标题/副标题、描述、`price`、`sizes: CanonicalSize[]`、颜色、图片、构造参数等。
`ProductView = Product & { sizeOptions: { value: CanonicalSize; label: string }[] }` —— 「已按当前市场
换算好展示标签」的视图，由 `catalog/service.ts` 产出。

#### 不变量

- `sizeOptions` 是**展示层派生物**，不是存储字段；`value` 永远是 canonical。
- 商品照片可能缺失：`images` 为空时 UI 回退到程序化 SVG 视觉（`ProductVisual`），
  不是渲染破图。

---

## Mode

**定义：** 助手对话的意图分类（`src/domain/chat-events.ts`）：
`'shopping' | 'size-fit' | 'outfit' | 'find-shoes' | 'support'`。

#### 不变量

- 消费者界面**从不出现这些词**：`size-fit` → “Find my size”，`find-shoes` → “Help me find a pair”。
  界面上也从不出现 “AI” 一词（克制原则）。
- `size-fit` 与 `outfit` **需要商品锚定**：缺 `product` 时服务端返回 `error: invalid`
  （`Pick a product first, then I can help with that.`），这是契约而非意外。
- `size-fit` 是唯一的**确定性**模式：走 `adviceFor`，不调用 LLM。

---

## SizeAdvice

**定义：** `size-fit` 的模式化结果（`src/server/ai/size-input.ts`）：
`{ recommended: CanonicalSize | null; alternatives: CanonicalSize[]; rationale: string; askedForInput: boolean }`。

#### 不变量

- `askedForInput: true` ⇒ `recommended === null`（信息不足，需追问）。
- `askedForInput: false && recommended === null` ⇒ 有信息但**附近无货**（措辞不同：out of stock）。
- `recommended` 若存在，必在 `product.sizes` 内（`nearestCanonical` 只在候选集中取最近值）。

---

## CatalogAdapter

**定义：** 目录读取契约（`src/server/catalog/adapter-contract.ts`）：
`getProducts(filter?)` / `getProductByHandle(handle)` / `getCollections()` / `getBuyUrl(product)`。
三种实现：`DbCatalogAdapter`（默认）、`SeedAdapter`（内存，测试用）、`shopifyStub`（占位）。

#### 不变量

- 运行时选择是**惰性**的：`adapter.ts` 的 `catalog()` 首次调用才读 `CATALOG_SOURCE` 并缓存实例
  （必须缓存：`DbCatalogAdapter` 内部持有「已灌种」promise）。
- 筛选/排序语义**只有一处**：`catalog/filter.ts` 的 `filterProducts`，被 seed 与 db 两个适配器共用。
- `getBuyUrl` 目前在所有实现中恒为 `null`：真实的购买通道是独立的 Shopify Buy Button
  （`shopify-buy.ts`），**不经过本接口**。`SHOPIFY_DOMAIN` / `SHOPIFY_STOREFRONT_TOKEN` 一旦同配
  会把目录源切到**会抛错**的 stub（刻意设计：预留位，见 README 与 `.env.example`）。

---

## RetrievalResult

**定义：** 检索命中（`src/server/search/retrieval.ts`）：`{ handle: string; score: number }`。

#### 不变量

- 语义检索（embedding）不可用时**静默降级**为关键词检索，不向用户报错——导购不该被检索层故障拖垮。
- `retrieve` 收**注入依赖**（`products` / `repo` / `canEmbed` / `embed`），不再有默认参数陷阱；
  组装点在 `src/server/ai/retrieval-gateway.ts`。
- 消费侧有**相关性下限** `score > 0`：语义路径会给全目录打分，cosine≈0 或为负的行否则会填满
  top-N，使「没找到」分支永远不可达。

---

## Guardrails

**定义：** 成本与滥用护栏（`src/server/guardrails/`）：按 IP/会话的内存令牌桶限流（10 次/分）、
会话回合上限（`AI_MAX_TURNS`，默认 20）、每日 token 预算、消息与输出长度上限。违规抛 `GuardrailError`
（`code: 'rate_limited' | 'budget' | 'turns'`）。

#### 不变量

- 必须跨请求**单例**（`createGuardrails(createDefaultRepository())` 在 `chat.ts` 内惰性建一次）：
  每次请求新建等于没有限流。测试通过 `ChatOptions` 注入独立实例。
- 上限值**调用时读 env**（`maxTurns()` 等函数，不是模块级常量），否则 `vi.stubEnv` 无效。
  为此 `envInt` 只接受正整数：Vercel 控制台会注入空串，而 `Number('') === 0` 会把上限归零、
  拦掉所有请求且不留日志。
- 文案一律消费者化（“taking a short break”），**绝不暴露 “rate limited”**。

---

## PageProductRef

**定义：** 页面锚点的轻引用 `{ handle: string; title: string }`（`src/lib/page-product.ts`）。
PDP 挂载时注册、卸载时（若仍指向自己）清空；FAB 据此在 `size-fit` / `outfit` 里预置商品上下文。

#### 不变量

- 只带 `handle` + `title`：服务端按 `handle` 回取全量事实，**客户端不传商品详情**（防篡改 + 防膨胀）。
- 引用必须**按值**比较去重：每次渲染传入的是新对象字面量，`createStore` 的 `Object.is` 守卫
  拦不住，故去重逻辑写在 `registerPageProduct` 内部。

---

## Locale / Messages

**定义：** `Locale` 是受支持的界面语言标识（`src/i18n/locales.ts`）；`Messages` 是该语言的**扁平点号键**
文案表（`src/i18n/messages.ts`，键名形如 `nav.shop`）。

#### 不变量

- **`LOCALES` / `DEFAULT_LOCALE` 是语言集合的单一来源**，本文件**不得**预先展开这个集合
  （不要写死 `Locale = 'en' | 'zh-CN'`）。阶段 1 只声明 `en`，`zh-CN` 在阶段 2 加入。
  这样做的收益是类型系统强制配对：声明一个没有词典的语言是 **TS2741 编译错误**。
- **语言与市场解耦**（ADR 0008）：`SITE_MARKET` / 币种 / 尺码体系决定**尺寸怎么显示**，
  `Locale` 只决定**文案**。中文界面里显示 `US 8.5` 与 `$128.00` 是**刻意**的结果，不是缺陷。
- **三者各司其职**（ADR 0009 决策 4）：**语言决定文案、市场决定价格与尺码体系、内容可用性
  决定 SEO 信号**。**句子级 UI 文案用 URL 语言**（中文页的政策句就是中文）；
  **canonical / hreflang / sitemap / JSON-LD 用内容语言**（把英文内容宣称成中文是发假信号）。
  同页并存不矛盾：`/zh-CN/product/<h>` 的界面是中文，而 canonical 指向内容语言那一侧
  （阶段 2 商品回退 ⇒ `/en`）。复用任何一侧的规则到另一侧都是缺陷。
- 字典只装**展示文案**：不装价格、库存、订单状态或任何交易事实（ADR 0004）。
- **面向用户的「输入解析规则」不是词典条目**：`parseSizeHint` 的语言分支、`OFF_TOPIC` 关键词表、
  `estTokens` 的字符/token 比，都留在 domain/server 层作为**行为规则**，以 `Locale` 参数参与判断。
  把规则塞进词典会把「翻译」与「行为」混为一谈。
- 缺键必须**编译期**报错（`Messages` 是 `Record<keyof typeof en, string>`），不得在运行期渲染 `undefined`。

---

## 内容回退状态

**定义：** 内容（目前是博客）按语言的可用性状态：`{ post, status: 'translated' | 'fallback', sourceLocale }`。

#### 不变量

- **回退优先于缺失**：目标语言没有该内容时，渲染**默认语言**的正文并给出显式提示，
  **不是**留白、也不是 `noindex`（用户要求：宁可给英文原文也不要空页）。
- **回退页不进 sitemap、不发 hreflang**，且 canonical 指向**默认语言**的同一 slug 地址；
  已译页才自指 canonical 并成对发 hreflang。
- hreflang 资格要求 status 为 `translated` **且** `source_hash` 与默认语言正文一致——
  译文过期就不该声称是同一份内容。（`source_hash` 是规格 §8.2/§8.3 的**要求**与提示级判据，
  判定单源见下条；改动前先复核 `src/lib/blog.ts` 是否已实现它。）
- **可用必须与可渲染同义**：文件缺失、YAML 语法错、必填字段缺失都等同于**不可用并回退**；
  判定只得写在一处——`src/i18n/content.ts`（纯词汇：`ContentStatus` / `LocalizedPost<T>`）+
  `src/lib/blog.ts` 的 `availableLocalesFor` / `getLocalizedPost` / `listLocalizedPosts`（IO）。
  页面与 `sitemap.ts` 只消费结果，不自己判断（否则 metadata 与 sitemap 会得到不同结论）。
- **商品在阶段 2 按回退处理（ADR 0009 决策 3）**：商品文案（标题/描述/特性/`fitNotes`）的翻译
  排在阶段 3，故 `/zh-CN/product/<handle>` 是回退页——canonical → `/en/...`、不发 zh-CN
  hreflang、不进 zh-CN sitemap（`src/app/sitemap.ts` 商品段固定 `['en']`）。界面文案已中文化，
  与内容语言是两件事（见上一节 `Locale / Messages`）。翻转判据是「商品文案确实有译文且可渲染」
  （届时商品段改为与文章段同一写法），**不是日期到了**。

---

## ChatEvent / ChatMessage

**定义：** SSE 线协议（`src/domain/chat-events.ts`）与服务端帧的归约结果
（`src/components/assistant/use-chat-stream.ts`）。
`ChatEvent` 五类：`delta` / `productCards` / `sizeFit` / `done` / `error`。

#### 不变量

- `chat-events.ts` 必须**客户端可导入**（`'use client'` 的 `use-chat-stream` 用它的 `parseEvent`），
  故它住在 `domain` 而非 `server`。
- `productCards` 的 items 要过 `isValidCard`：`parseEvent` 只验 `Array.isArray`，**深层形状是运行时的事**。
- **产品卡一律不带价格**：AI 不传播 demo 价段（见 ADR 0004）。
