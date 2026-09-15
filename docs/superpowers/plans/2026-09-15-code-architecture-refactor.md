# 代码架构重构计划（高内聚 · 低耦合 · 去重复）

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法跟踪进度。每批次结束 `git commit`，批次内每个任务结束跑该任务的验证命令。

**目标：** 在不改变任何用户可见行为（页面、交互、URL 契约、文案）的前提下，消除代码中的重复真源与循环依赖，把放错位置的模块接缝（seam）归位，使耦合集中在少量深模块上、简化散落的逻辑分支。

**范围：** `src/` 全域（113 个非测试模块 / 7,907 行）。不改数据库表结构、不改 API 响应形状、不改 UI 文案。 批次 7 额外触及工具链层（锁文件 / `package.json` / CI / README），但**不触及 `src/`**。

**验证门禁（每批次出口）：**

```bash
bun run verify          # format:check → typecheck → lint → test
bun run build     # 批次 1 / 3 / 4 / 6 需要（涉及 RSC、SSG、route handler）
```

> **构建门禁固定为 `bun run build`，不要加 `--bun`。** `bun --bun run build` 会让 Next 跑在 Bun 运行时，在 "Collecting page data" 阶段以 `NAPI FATAL ERROR: napi_get_last_error_info` 崩溃（SIGTRAP；旧版 Bun 表现为 SIGILL）。项目已于 2026-09-07 决策去掉 `--bun`（`package.json` 的 dev/build/start 均无 `--bun`）。本计划早期版本的 `bun --bun run build` 是从 2026-09-04 的 execution-notes.md 抄来的过期命令，已于本次执行中实测修正。

基线：`56 个测试文件 / 294 个用例全绿`。任何批次结束时测试数不得下降，用例不得跳过。

---

## 执行纪律（分支与子代理）

### 分支策略

- **所有重构改动必须在新分支上进行**，不得直接在 `main` 上工作。
- 批次 1–6 在同一分支 `refactor/high-cohesion-low-coupling` 上完成（决策 2026-09-15），每批次一个 commit 作为回滚点。
- **用分支（`git switch -c`），不用 git worktree** —— 单写者、单一工作区，避免多工作区并行改动互相不可见。
- 每个批次结束一个 commit（见各批次「回滚点」），使任一批次可单点回退。
- 批次 7 按计划另开 `chore/de-bun-package-manager`（归因隔离要求）。

### 子代理驱动模式的前提条件

允许用 subagent-driven 模式（`superpowers:subagent-driven-development`）执行本计划，但**分派代码修复类任务时，必须在任务简报里写入以下硬约束**（否则子代理默认会退化成症状消解）：

> **禁止打地鼠式修复。** 不得按「报错 A → 改 A → 报错 B → 改 B」的方式逐个消解症状。
>
> - 动手前先定位**根因**：为什么会出现这个错误？它是不是同一原因的第 N 次表现？
> - 若修复正在变成「一处接一处地试」，**立即停止并回报**：已观察到的现象、已排除的假设、尚缺的信息。宁可交回一份说清问题的报告，也不要交回一串症状补丁。
> - 只有**根因不可达**时（第三方库内部、外部服务行为）才允许局部缓解，且必须写明：这是缓解而非修复、根因未知、缓解的适用边界。
> - 收尾必须给根因层证据：改完后跑该任务的验证命令，并说明**为什么这个改动消除的是原因而不是症状**。

子代理自检用的违规信号：

- 同一文件在本任务中被反复修改（>3 轮），却没有一轮能解释「之前为什么不对」
- 修复清单在变长，而理解没有变深
- 靠 `try/catch`、非空断言、类型断言、`eslint-disable`、跳过测试把门禁凑绿

读代码/调研类任务（不修代码）不受此约束 —— 但同样要求先给证据再给结论。

---

## 决策记录（已定，执行期间不再重开）

| 议题                                     | 决策                                                            | 含义                                                                                                                                              |
| ---------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 改造力度                                 | **允许内部 API 与目录重组**                                     | 内部函数签名、类型名、目录归属可改；页面行为、URL、对外语义不变                                                                                   |
| 注释策略                                 | **只留非显然的「为什么」**                                      | 保留踩坑记录、外部系统怪癖、SSR/React 非显然约束、安全边界；删除复述代码的 what、历史叙事、`规格 §x` / `决策 #n` 编号引用；长论证上移 `docs/adr/` |
| DB 双驱动                                | **只做行映射去重（A3），不合并两份 repository**                 | `repository.ts` 与 `repository-postgres.ts` 保留为薄壳；不改 DDL 生成方式                                                                         |
| 起点                                     | **先产出本计划文档**，再按批次执行                              | —                                                                                                                                                 |
| 去 Bun 的剩余部分（包管理器 / 锁文件层） | **推迟到批次 7**，在批次 1–6 全部落地并全绿后，作为独立改动执行 | 工具链迁移会改变依赖解析版本，与重构混做会让失败无法归因；隔离后 `src/` 零改动即可自证无行为影响                                                  |

**前置动作（必做）：** 工作区当前有未提交改动 —— `src/server/catalog/data/supplier.json` 被格式化重排（366 行）+ `docs/superpowers/specs/2026-09-04-shoe-store-ai-design.md`。二者与本计划无关，先 `git commit` 或 `git stash`，否则批次 1 的 diff 会被 300+ 行噪声淹没。

---

## 基线证据（实测，非推测）

| 指标           | 实测值                                                                             | 取证方式               |
| -------------- | ---------------------------------------------------------------------------------- | ---------------------- |
| 规模           | 非测试 113 模块 / 7,907 行；测试 4,435 行 / 56 文件 / 294 用例                     | `wc -l` + `vitest run` |
| 真实 import 环 | **2 个**：`ai/openai-compat ⇄ ai/provider`、`ai/mock ⇄ ai/provider`                | 全量 import 图 DFS     |
| 最大 fan-out   | `ai/chat.ts`(16) → `app/product/[handle]/page.tsx`(15) → `assistant-panel.tsx`(13) | 同上                   |
| 最大 fan-in    | `catalog/types.ts`(28) → `catalog/service.ts`(14) → `ai/events.ts`(9)              | 同上                   |
| 重复长字面量   | 20 组，其中 **3 组是逻辑重复**（非 Tailwind 样式重复）                             | 跨文件长字面量聚类     |
| 架构文档       | **无** `CONTEXT.md`、**无** `docs/adr/`                                            | `ls`                   |

---

## 本计划不做（已决策，留给后续架构审查参考）

| 不做项                                                               | 理由                                                                                                        |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 合并 `search/repository.ts` 与 `search/repository-postgres.ts`（C1） | 两套 drizzle 方言类型不同，合并需大量窄化断言；A3 已拿走「加字段改 6 处」的主要成本。保留两份薄壳是划算的。 |
| 用 `drizzle-kit` 生成迁移取代 `db/client.ts` 内联 DDL（C2）          | README 承诺「零迁移 DX」（`CREATE TABLE IF NOT EXISTS` 幂等建表）。引入迁移会改变开发流程，收益不抵。       |
| 全站 i18n / 多货币                                                   | `market.ts` 已锁 USD + 单市场，与范围无关。                                                                 |
| `lib/seo.ts` 的 `baseMetadata` 模块级 env 快照                       | 构建期元数据本就是常量语义，改动无收益。                                                                    |

---

## 批次 1：消除重复真源

**目标：** 把复制粘贴出来的第二、第三份实现收敛回单点。

**出口：** `bun run verify` + `bun run build` 全绿。

**状态：✅ 已完成。** `verify` = 57 文件 / 297 用例全绿、**0 lint 问题**；`bun run build` = 42/42 静态页。用例数 294 → 297（净增 3 条，见执行记录 ③）。

### 任务 1.1 —— 统一「可搜索文本」投影（A1）

- [x] 新建 `src/domain/search-text.ts`，导出 `searchableText(product: Product): string`，实现取现 `filter.ts` 版本（`title + subtitle + productType + tags + features + description`，小写、空格连接）。
- [x] `src/server/catalog/filter.ts`：删除私有 `byText`，改 import `searchableText`。
- [x] `src/server/search/retrieval.ts`：删除导出的 `textualContent`，改 import `searchableText`；同步改本文件内 3 处调用（`missing` 计算、`embed` 入参、`hashText` 入参）。
- [x] `src/server/search/keyword.ts`：删除文件顶部那份「为绕开环而复制」的 `textualContent` 及其注释，改 import `searchableText`。
- [x] 改 `retrieval.test.ts` 对 `textualContent` 的引用（确有 5 处）。
- [x] 验证：`bun run test -- src/server/search src/server/catalog`

> 为什么放在 `domain/`：`catalog/` 不依赖 `search/`，因此 `keyword` 与 `retrieval` 同时依赖 `domain/search-text` 不构成环。原来的环是用复制规避的，不是靠倒置依赖解决的。

### 任务 1.2 —— 统一尺码标签与区间格式化（A2）

- [x] 在 `src/domain/size.ts` 导出 `sizeLabel(eu, system?)` 与 `sizeRangeFromCanonical(sizes, system?)`。
- [x] `src/server/ai/chat.ts`：删除私有 `sizeRangeText`，改调 `sizeRangeFromCanonical`。
- [x] `src/app/api/catalog/route.ts`：删除 `lo`/`hi` 内联计算块，改调 `sizeRangeFromCanonical`。
- [x] `src/server/catalog/service.ts`：删除本地实现，改 import `sizeLabel`（无外部消费者，故不需要重导出）。
- [x] `src/components/assistant/assistant-panel.tsx`：`sizeLabelFor` 的回退分支改调 `sizeLabel`。
- [x] `src/lib/size-range.ts`：`sizeRangeLabel(sizeOptions)` 保留签名（`ProductCard` 在用），内部改为委托 `sizeRangeFromCanonical`。
- [x] 验证：`bun run test -- src/lib/size-range src/server/catalog/size-charts`

> 根因不是「同一模板写了四遍」，而是 `sizeRangeLabel` 先渲染标签、再用正则把自己的输出解析回系统 —— 等于从自己的输出里恢复已知信息。改为直接从 canonical 取 min/max。

### 任务 1.3 —— 收敛 ProductRecord 行映射（A3）

- [x] `src/db/product-row.ts` 新增 `withoutId(r)` —— 见执行记录 ②，实际只需这一个辅助函数。
- [x] `src/server/search/repository.ts`：`listAllProducts` 的 18 字段 map、`upsertProducts` 的 `values` 与 `set` 三处全部收敛。
- [x] `src/server/search/repository-postgres.ts`：同样三处收敛。
- [x] 验证：`bun run test -- src/db src/server/search`

> 加一个商品字段的改动面：**6 处 → 2 处**（`productToRecord` 编码 / `productFromRecord` 解码）。这是本计划对 DB 层唯一的改动（对应决策记录）。

### 任务 1.4 —— 纠正已被违反的「文案单源」约定（A6）

- [x] `src/server/ai/mock.ts`：import 补上 `POLICY_PRODUCTION`，删除硬编码的那句运输文案（与 `lib/store-policy.ts` 逐字相同）。
- [x] 新建 `src/lib/gift-offer.ts` 承载赠品事实（见执行记录 ③；未按原计划并入 `store-policy.ts`）。
- [x] `src/server/ai/mock.ts`：赠品句改为按 `GIFT_OFFER` 事实拼装（原注释声称同源，实为另一份字面量）。
- [x] `FALLBACK_ERROR_TEXT` 收归单一来源（`chat.ts` 导出，`/api/ai/chat` 兜底 catch 复用）。
- [x] 验证：`bun run test -- src/server/ai src/lib`

### 执行记录（与计划的偏差，均为实测后的判断）

① **构建门禁命令修正。** 计划早期版本抄了 2026-09-04 `execution-notes.md` 的 `bun --bun run build`；实测该命令必崩（`NAPI FATAL ERROR`/SIGTRAP，死在 Collecting page data），而项目已于 2026-09-07 决策去掉 `--bun`。门禁固定为 `bun run build`，共修正 6 处并加了警示块。

② **1.3 比计划更彻底，只留 1 个辅助函数而非 3 个。** 计划的 `productRowFromDb` / `productRecordValues` / `productRecordSet` 三个函数其实是多余的：products 表行形状与 `ProductRecord` **一一对应**，所以 `listAllProducts` 直接 `return db.select().from(products)`（返回类型即编译期契约，列缺失会报错）、insert 直接 `.values(r)` 都是恒等映射，那 18 行 ×2 是纯噪声。真正需要变形的只有 upsert 的 `set`（id 是冲突目标），收敛为 `withoutId`。6 处 → 1 个函数。

③ **1.4 实际范围是 7 处而非 2 处，故单源收口扩到 UI。** 赠品事实（门槛 $50 / little buddy / leftover upper offcuts）同时硬编码在 `gifts.ts`、`shop/page.tsx`、`gift-gallery.tsx`、`ai/mock.ts`、`ai/prompts.ts` 五处渲染 + 两处注释。只修 `mock.ts` 两行等于打地鼠，所以新建 `src/lib/gift-offer.ts` 收口事实（门槛/名称/材质/供给口径），各呈现面保留自己的语气，输出逐字节不变（由 `gift-offer.test.ts` 三条黄金断言钉住）。未按原计划并入 `store-policy.ts`：那里是「店务政策」，赠品属「促销」，且该模块被 support 模式断言不得出现促销口径。

④ **`size-range.test.ts` 原本在测一个虚构，已重写。** 6 个用例的期望值与项目自己的 `size-fixture.ts` 矛盾（EU 43 写成 `US 10`，表里是 `US 9`）；旧实现把数字从传入的 `label` 读回来，断言恒真，从未验证生产行为。重写为「label 由真实换算表派生」，删掉生产不可达的混合体系输入用例，并新增真实目录一致性 + 零码款回归用例。测试数 7 → 7。等价性另有强证据：探针跑遍 29 款真实商品，新旧实现 **0 处差异**。

⑤ **顺带修掉 2 条既有 lint 警告。** `@typescript-eslint/no-unused-vars` 原先未开 `ignoreRestSiblings`，导致「摘掉一个键」的惯用写法必报警告（`product-row.test.ts` 即有 2 条），并会逼出 `void id` 之类的凑数行。已在 `eslint.config.mjs` 开启该选项：警告 2 → 0，且 1.3 的 `withoutId` 无需任何 hack。

**回滚点：** `git commit -m "refactor(core): single source for search text, size labels, row mapping and shared copy"`

---

## 批次 2：共享状态与配置基座

**目标：** 收敛手写 localStorage/external-store 样板（A5），消除 import 环与不一致的 env 读取时机（A4），建立统一 env 门面（D1）。

**出口：** `bun run verify` 全绿；新增 store 单测；import 图环数 **2 → 0**。

**状态：✅ 已完成。** `verify` = 58 文件 / **318 用例**全绿、0 lint 问题；`bun run build` = 42/42 静态页；**import 环数实测 0**（118 个非测试模块全图 DFS）。

### 任务 2.1 —— `createPersistentStore` 深模块（A5）

- [x] 新建 `src/lib/create-store.ts`，导出 `Store<T>` / `createPersistentStore<T>` / `createStore<T>`。`encode` 允许返回 `null` 表示**删除该键**（见执行记录 ②）。
- [x] 新建 `src/lib/create-store.test.ts`：覆盖惰性加载、损坏回退、写入广播、同值不广播、退订、函数式更新、SSR 快照引用稳定、`window` 缺失、隐私模式静默读写。
- [x] `src/lib/speak-preference.ts` → `createPersistentStore<boolean>`（`'1'`/`'0'` 编解码）；文件从 60 行降到 16 行。
- [x] `src/lib/my-size.ts` → `createPersistentStore<number | null>`，保留 `MY_SIZE_*` 常量与领域函数（`footMmRow`/`footMmToEU`/`footMmToSystem`）。
- [x] `src/components/shop/wishlist-provider.tsx` → `createPersistentStore<string[]>`，Provider 外壳与 `useOptionalWishlist` 非抛出契约未动；删掉解释「为什么用 external store」的长注释并并入 `create-store.ts`。
- [x] `src/lib/page-product.ts` → `createStore<PageProductRef | null>`（无持久化，按 handle/title 去重语义保留）。
- [x] 验证：`bun run test`

### 任务 2.2 —— env 门面 `src/config.ts`（D1）

- [x] `env-int.ts` 迁为 `src/config.ts`，导出 `envStr` / `envInt` / `envFlag`，全部调用时求值并保留空串/空白硬化语义。
- [x] `env-int.test.ts` → `src/config.test.ts`，并为新增的 `envStr` / `envFlag` 补测。
- [x] 改消费方 import：`guardrails/budget.ts`、`session-state.ts`、`text.ts`、`ai/openai-compat.ts`。
- [x] `src/server/search/embedder.ts`：删除顶层 `base` / `model` 快照，改为函数内 `envStr`（含 `AI_API_KEY`）。
- [x] `src/server/ai/openai-compat.ts`：删除顶层 `AI_MODEL` / `TIMEOUT_MS` 快照，改为 `stream()` 内求值；新增 `aiModelName()` 供工厂复用（记账与流式同源）。
- [x] `shopify-buy.ts` / `shopify-stub.ts` / `lib/market.ts`：改走 `envStr`。
- [x] 额外（计划未列）：把 `guardrails` 里 4 个**模块级常量快照**改为函数 —— 见执行记录 ①。
- [~] `db/dialect.ts` / `db/client.ts`：**故意不改** —— 见执行记录 ③。
- [x] 验证：`bun run test`（全量）

### 任务 2.3 —— 拆掉 AI provider 环（A4）

- [x] `src/server/ai/provider.ts` 收敛为纯接口（`AiContext` / `AiProvider`），删除工厂与全部运行时 import。
- [x] 新建 `src/server/ai/factory.ts`：迁入 `realEnabled` / `aiProvider` / `aiModel`，沿用 `envStr` / `envFlag`。
- [x] 更新消费方 import：`ai/chat.ts` 改从 `./factory` 取工厂。
- [x] 验证 import 图无环：**实测 0 个环**（`factory → {openai-compat, mock} → provider` 单向）。
- [x] 验证：`bun run test -- src/server/ai`

### 任务 2.4 —— 目录适配器改为惰性单例

- [x] `src/server/catalog/adapter.ts` 的模块级 IIFE 改为 `catalog()`：首次调用才读 `CATALOG_SOURCE` 并缓存实例（实例必须缓存：`DbCatalogAdapter` 内部持有「已灌种」promise）。
- [x] 机械更新 6 个消费方（`catalog/service.ts`、`search/retrieval.ts`、`ai/chat.ts`、`app/shop/page.tsx`、`app/product/[handle]/page.tsx`、`components/marketing/collection-cards.tsx`）。
- [x] 改动面**正好 6 个消费方**，未超预期，故不跳过。

### 执行记录（与计划的偏差，均为实测后的判断）

① **2.2 的范围比计划大一倍：真正的不一致是 5 个「模块级常量快照」，计划只点了 2 个。** 计划让 `embedder.ts` 与 `openai-compat.ts` 去快照，但 `guardrails` 里还有 4 个模块级常量在 import 时求值 —— 而 `env-int.ts` 的注释本身写着「调用时才读 process.env，便于测试 vi.stubEnv 后直测」：消费方用 `export const MAX_TURNS = envInt(...)` 把这句话直接作废了（谁 stub `AI_MAX_TURNS` 都不会生效）。这与批次目标「消除不一致的 env 读取时机」是同一类缺陷，只修 2 处属于打地鼠，故一并改为函数：`maxTurns()` / `maxMessageChars()` / `maxOutputTokens()` / `dailyTokenCap()`（含 4 个测试文件的调用点）。当前无测试 stub 这些变量，所以这是**不可观测的潜在坑**，而非现存 bug。

② **2.1 删掉了整层「别名门面」。** 初版写的是 `export const subscribeMySize = mySize.subscribe` 这类 7 个透传别名（knip 报 `pass-through-wrappers`）。它们只增加名字不增加含义，改为直接导出 store 对象、让 5 个消费方用 `mySize.subscribe` 等；只有 `setMySize` 保留为函数（它做归一化，是真逻辑）。同时 `createPersistentStore.encode` 允许返回 `null` 以表达「删除该键」——`setMySize(null)` 因此仍是 `removeItem` 而非写入 `'null'`，行为与重构前一致。副作用：`lib/wishlist.ts` 变为纯函数（`parseWishlist` + `toggleWishlist`），持久化归 provider，`saveWishlist` 删除；`loadMySize`/`saveMySize`/`clearMySize` 删除（已并入 store，`my-size.test.ts` 相应改为 `resetModules` + 动态 import 以观察存储初始态）。

③ **2.2 故意不改 `db/dialect.ts` 与 `db/client.ts`，因为计划这一条会让代码变差。** 这两处的 env 是**可注入参数**（`resolveDbDriver(env = process.env)`、`createDb(file = process.env.DATABASE_URL ?? ...)`），`dialect.test.ts` 正是用假 env 对象跑 7 个用例。改走读全局 `process.env` 的 `envStr` 会**删掉可注入性并打挂这些用例** —— 局部可注入严格优于全局门面，故保留原样。

④ **2.2 补掉一个漏网点**：`search/retrieval.ts` 里还有一处 `process.env.AI_EMBEDDING_MODEL`（计划未列），已改 `envStr`。`lib/seo.ts` 的模块级快照按「本计划不做」保留。

⑤ **`AI_DISABLE_REAL` 语义小幅放宽**：原为 `!== '1'` 精确匹配，现走 `envFlag`，`'1'` 与 `'true'` 都算真。`AI_MODEL` 的解析也从 `process.env.AI_MODEL ?? 缺省` 变为 `envStr`（空串/空白按未设置）。二者都是空串硬化方向的一致性收紧，无测试依赖旧行为。

**回滚点：** `git commit -m "refactor(state,config): one store implementation, one env facade, acyclic AI provider seam"`

---

## 批次 3：域边界重组

**目标：** `src/server/**` 被客户端大面积 import —— server/client 边界名存实亡；同一个尺码域被 `server/catalog/size-charts.ts` 与 `lib/my-size.ts` 切成两半。建立 `src/domain/` 作为两端共享的纯域层。

**出口：** `bun run verify` + `bun run build` 全绿；新增一条边界守卫；此后 `src/server/**` 不再被任何 `'use client'` 模块非类型导入。

**状态：✅ 已完成。** `verify` = 58 文件 / **318 用例**全绿、0 lint 问题；`build` = **42/42 静态页**；守卫 `check-server-boundary` 通过；import 环数 **0**。三个子任务全程 `318` 用例不变 —— 零行为变化。

### 任务 3.1 —— 建立 `src/domain/` 并保留兼容垫片

- [x] 新建 `src/domain/product.ts`：`SizeSystem` / `CanonicalSize` / `Price` / `Colorway` / `Product` / `Collection` / `ProductFilter`（`CurrencyCode` 保持模块私有）。
- [x] 新建 `src/domain/size.ts`：合并 `size-charts.ts` 全部纯函数 + `lib/my-size.ts` 的纯函数（`footMmRow` / `footMmToEU` / `footMmToSystem` / `MY_SIZE_MIN_MM` / `MY_SIZE_MAX_MM`）。
- [x] `size-fixture.ts` 迁入 `src/domain/`（`git mv`，纯数据无依赖）。
- [x] 批次 1 的 `search-text.ts`、批次 1.2 的尺码格式化函数并入 `domain/`。
- [x] 旧路径改为垫片（`size-charts.ts` / `size-fixture.ts` / `types.ts` 各 `export *`），使本任务可独立验证。
- [x] 验证：`bun run test` 全绿（**318 用例不变**，零行为变化）。

### 任务 3.2 —— 全量改写消费方 import

- [x] 全部 `@/server/catalog/types` → `@/domain/product`（实测 fan-in 21 个别名引用点 + `server/catalog` 内 4 处相对引用）。
- [x] 全部 `size-charts` → `@/domain/size`（含 `print-spec-sheet.tsx`、`assistant-panel.tsx` 等 `'use client'` 文件）。
- [x] 全部 `size-fixture` → `@/domain/size-fixture`。
- [x] `lib/my-size.ts` 只保留存储层（持久化 mm + store 接线 + UI 滑杆上下界）；域数学来自 `@/domain/size`。
- [x] `lib/size-range.ts` 改用 `@/domain/size` 的格式化原语。
- [x] 验证：`bun run test` + `bun run typecheck` 全绿（**318 用例不变**）。

### 任务 3.3 —— 删除垫片并加边界守卫

- [x] 删除 `server/catalog/types.ts`、`size-charts.ts`、`size-fixture.ts` 三个垫片。
- [x] `ProductView` 迁入 `domain/product.ts`（15 个消费方 repoint）；`service.ts` 只保留取数函数。
- [x] `CatalogAdapter` 移入新增的 `server/catalog/adapter-contract.ts`（**不进 domain**，理由见执行记录 ②）。
- [x] 新增 `scripts/check-server-boundary.mjs` + 接入 `verify`（`check:boundary`，位在 typecheck 与 lint 之间）。
- [x] 验证：守卫在当前代码上通过；并用**故意注入违规**的负向用例证明它真的会拦（见执行记录 ⑤）。

### 执行记录（与计划的偏差，均为实测后的判断）

① **把 `ai/events.ts` 迁到了 `domain/chat-events.ts` —— 计划没列这一项，但守卫逼出了它。** 守卫第一次运行只报出**一处**真实违规：`'use client'` 的 `use-chat-stream.ts` 运行时 `import { parseEvent } from '@/server/ai/events'`。该模块是 SSE **线协议**（`ChatEvent` / `ProductCard` / `Mode` / `parseEvent` / `encodeEvent`），服务端 `chat()`/route 产出、客户端消费，本身无任何 server-only 依赖；它的文件头注释甚至写着「本模块必须保持客户端可导入」—— 那正是用**约定**去顶替**结构**。本批次出口写的是「`src/server/**` 不再被 `'use client'` 非类型导入」，若靠例外清单放行，出口就没真正达成。故移入 `domain/`（14 处 import repoint），使约束由目录位置承载，守卫得以**零例外**。若判为超出批次范围，回退点即本批次 commit。

② **`CatalogAdapter` 没有进 domain。** 它是**纯服务端**契约（DB / 内存 seed / Shopify 三种实现，含 `getBuyUrl`），放进「两端共享的纯层」会把 IO 关切带进 domain。计划只说删除 `types.ts`，没说 `CatalogAdapter` 去哪；实际做法是新建 `server/catalog/adapter-contract.ts` 承载它（5 个 import repoint），避免它被删成孤儿。`types.test.ts` 相应改名 `adapter-contract.test.ts`（其测试对象只剩适配器契约）。

③ **`size-charts.test.ts` → `src/domain/size.test.ts`。** 它测的是已迁移的模块，留在 `server/catalog/` 会变成「测一个不存在的路径」。

④ **`MY_SIZE_MIN_MM` / `MY_SIZE_MAX_MM` 改为从 fixture 首末行派生**（原为重新写一遍的 `227` / `313` 字面量）。这属于批次 1 的「消除重复真源」主题：给尺码表补一档时上下界自动跟着走，不会再漂移。

⑤ **守卫做过负向测试，不是只跑通就算。** 注入一个 `'use client'` 探针（一个运行时 import + 一个 `import type` + 一个内联 `{ type X }`），守卫退出码 1 且**只**报出那一个运行时 import，两种类型写法均正确放行 —— 证明它是有判别力的检查，而非「见到 `@/server` 就报」。探针已删除。

⑥ **合并时顺手删掉一处无意义的类型重述**：`size-charts.ts` 里的 `type Key = 'US' | 'EU' | 'UK' | 'JP' | 'CN'` 与 `SizeSystem` 完全等价，连带 5 处 `as Key` / `as 'US' | ...` 断言都是空操作；已删除该别名与全部断言（行为中性：318 用例不变）。

**回滚点：** `git commit -m "refactor(domain): move product types and size math into a shared domain layer"`

---

## 批次 4：AI 编排解耦

**目标：** `ai/chat.ts`（283 行 / 18 import，全仓 fan-out 最高）把护栏顺序、5 个 mode 分支、上下文构造、流式转发、记账、错误映射挤在一个生成器里，导致改任一 mode 都必须穿过整条护栏栈才能测试。同时去掉 `retrieve()` 的隐式全局依赖与「默认参数陷阱」。

**出口：** `bun run verify` + `bun run build` 全绿；每个 mode 有独立单测；`chat()` 主函数 ≤ 80 行。

**状态：✅ 已完成。** `verify` = 60 文件 / **341 用例**全绿、0 lint 问题；`build` = **42/42 静态页**；`chat()` **62 行**（≤80）；`chat.ts` 283 → **106 行**，import 18 → 10，运行时依赖只剩 6 个；import 环 **0**。

### 任务 4.1 —— 抽出 `ai/context.ts`

- [x] 把 `chat.ts` 中的纯函数移出：`productContextOf`、`digestLines`、`toCard`（连同批次 1.2 已迁走的 `sizeRangeText` 调用点）。
- [x] 新建 `src/server/ai/context.test.ts`（10 例），直接对纯函数断言 —— 此前这些逻辑只能经 SSE 端到端断言。

### 任务 4.2 —— 按 mode 拆分处理函数

- [x] 定义统一签名 `ModeHandler = (ctx: TurnContext) => AsyncGenerator<ChatEvent, void, void>`。
- [x] 拆出 `handleSizeFit`（含 `footMmToEU` 预填）、`handleOutfit`、`handleSupport`、`handleCatalogModes`（find-shoes / shopping 共用检索分支）。
- [x] `chat()` 收敛为：`truncateMessage` → `assertRate` → `assertBudget` → `assertTurn` → `modeHandlers[req.mode](ctx)` → `catch → toErrorEvent`（**62 行**）。
- [x] `streamAssistantReplies` 的 `yield*` 复用结构保留（那处「yield 不能出现在箭头闭包内」的注释也保留）。
- [x] 新增 `src/server/ai/handlers.test.ts`（13 例），给每个 mode 独立单测；`chat.test.ts` 保留护栏顺序等端到端用例。
- [x] 验证：`bun run test src/server/ai`（66 例全绿）。

### 任务 4.3 —— `retrieve()` 注入化（B3）

- [x] `retrieval.ts`：签名改为 `retrieve(query: string, deps: RetrievalDeps)`，`RetrievalDeps = { products, repo, canEmbed, embed }`。
- [x] 删除默认参数 `repo = createDefaultRepository()` 与 `opts = { embedIfAvailable: true }`。
- [x] 删除文件内对 `catalog` 单例的 import；`products` 由调用方传入。
- [x] 新增 `src/server/ai/retrieval-gateway.ts` 作为组合根，装配 `catalog` + `createDefaultRepository()` + `embeddingsAvailable` + `embed`。
- [x] `retrieval.test.ts` 改为注入假 repo / 假 embed，**删除了 `vi.mock('./embedder')` 整个模块 mock**。
- [x] 验证：`bun run test src/server/search src/server/ai`（全绿）。

### 执行记录（与计划的偏差，均为实测后的判断）

① **新增了计划里没有的 `ai/turn.ts`。** 计划让 `ChatRequest` 留在 `chat.ts`、handler 另置他处 —— 这两件事不能同时成立：handler 要用 `ChatRequest`，`chat.ts` 要用 `modeHandlers`，必然成环。故把 `ChatRequest` / `TurnContext` / `ModeHandler` / `StreamReplies` / `RecordTurn` 独立成接口模块，两侧都只依赖它，它不依赖任何一侧。

② **`TurnContext` 不含 `provider` / `guardrails`**（计划写的是 `{req, text, history, provider, guardrails, record}`）。handler 实际只用到两个能力：转发流、记账。把 provider / guardrails 暴露出去等于让每个 handler 都能绕过护栏顺序与 `maxTokens` 约束。改为注入 `stream`（已绑定 provider 与 `maxOutputTokens`）与 `record`——顺带让 handler 单测完全不需要假 provider。

③ **find-shoes 与 shopping 共用一个 `handleCatalogModes`**，而非计划要的两个函数。二者只差「是否先出结果卡」，拆成两个近乎相同的函数只会得到一层透传。

④ **三个逐字相同的 try/catch 合并为一个**（护栏 rate → budget → turns）。行为等价：任一失败都只回一个 error 帧并 return，被 rate/budget 拒的请求仍不消耗回合。

⑤ **组合根落在 `retrieval-gateway.ts` 而非计划备选的 `context.ts`。** `context.ts` 是纯投影函数（无 IO），把目录与仓库装配塞进去会毁掉它的纯度与可测性。

⑥ **没有新建 `copy.ts`**（维持批次 1 的判断）：三个文案各自只有一个归属模块 —— `PRODUCT_REQUIRED_TEXT` / `NO_MATCH_TEXT` 归 `handlers.ts`，`FALLBACK_ERROR_TEXT` 归 `chat.ts`，不满足「需要共享」的条件。`chat.test.ts` 的 `NO_MATCH_TEXT` 改从 `./handlers` 导入。

⑦ **发现并修掉了 `chat.test.ts` 相关性下限用例的空转。** 该用例自称验证「余弦 ≤0 的命中被下限滤掉」，但两个 mock handle（`daily-drift` / `cloudwalk-slip`）**在真实目录里不存在**，会被 `getProductByHandle` 返回 null 丢掉 —— 于是「按分过滤」这一步从未被执行，用例在接线断掉时也照样变绿。且查询串 `zzz nonsense` 在关键词路径本来就零命中，spy 失效时同样变绿。改为：用**真实 handle** 承载 ≤0 分（保证这一步真的被执行），查询串换成关键词路径**本来会命中**的 `avocado`（保证 spy 失效时可被证伪）。负向验证：把分数改成 `0.9` 后该用例**确定失败**（productCards 出现），证明 mock 的返回值确实流到断言、下限确实承重。

**回滚点：** `git commit -m "refactor(ai): per-mode handlers, extracted context builders, injected retrieval deps"`

---

## 批次 5：助手状态与模态统一

**目标：** `assistant-provider.tsx` 同时持有 chat 流状态、面板开关、朗读副作用，以及「size-fit 已结算则自动转 shopping」这条领域规则；两个 ~300–500 行的 UI 测试是为了覆盖这些规则而存在的。同时焦点陷阱在两个组件里被逐字复制。

**出口：** `bun run verify` 全绿；会话规则由 reducer 单测覆盖；UI 测试行数下降。

**状态：✅ 已完成（出口第 3 条未采纳，理由见执行记录 ②）。** `verify` = 63 文件 / **375 用例**全绿、0 lint 问题；`build` = **42/42 静态页**；`focusableIn` 全仓只剩 **1 份**；import 环 **0**。

### 任务 5.1 —— 会话 reducer

- [x] 新建 `src/components/assistant/session.ts`：`sessionReducer(state, action)` 管 `{ mode, product }`；`sizeFitSettled` 抽为纯选择器，不再由 `useMemo` 持有。
- [x] 新建 `src/components/assistant/session.test.ts`（16 例）：覆盖「size-fit 已结算 + 自由输入 → shopping」「移除商品上下文 → mode 归位 shopping」「chip 重入 size-fit/outfit」三条规则，外加 reducer 各动作与 `productRefOf` / `needsProduct`。
- [x] `assistant-provider.tsx` 改用 `useReducer`，只保留 store 接线、朗读副作用、`AssistantHandle` 的 `open`/`close`（167 → 154 行）。
- [x] 验证：`bun run test -- src/components/assistant`（全绿）。

### 任务 5.2 —— SSE 帧归约抽为纯函数

- [x] `use-chat-stream.ts`：抽出 `applyEvent(message, event): ChatMessage`；`isValidCard` 保留（守运行时形状）。`onEvent` 从五个分支的 `setMessages` 收敛成一次 `map` + 错误态旁路。
- [x] 新建 `src/components/assistant/use-chat-stream.test.ts`（8 例）：覆盖 delta / productCards / sizeFit / done / error 五类帧，含坏 item 过滤与「每类帧都返回新对象」。
- [x] 验证：`bun run test -- src/components/assistant`（全绿）。

### 任务 5.3 —— 模态与焦点陷阱统一（B5）

- [x] 新建 `src/lib/use-modal.ts`：`useModalDismiss` —— 打开时聚焦首个可聚焦元素、Tab/Shift+Tab 环形、Escape 关闭、关闭后焦点还原触发元素。
- [x] 新建 `src/lib/use-modal.test.tsx`（10 例）：含回环方向、中间元素不被劫持、`dismiss` 的所有关闭路径都还原焦点、无触发元素、空弹窗、额外按键透传、关闭后不再响应。
- [x] 三处采用并删除各自的 `focusableIn` 副本与长注释：`care-instructions.tsx`（121 → 76 行）、`product-buy-bar.tsx`（165 → 128 行）、`gift-gallery.tsx`。
- [x] 验证：`bun run test -- src/components/shop src/test/a11y`（含既有 care-instructions / product-buy-bar / axe 门禁，全绿）。

### 执行记录（与计划的偏差，均为实测后的判断）

① **没有把 `messages` 并进 session reducer**（计划写的是 `{mode, product, messages, sizeFitSettled}`）。messages 的生命周期属于 SSE 消费 hook（网络、abort、流式增量），搬进 session reducer 会把它与任务 5.2 刚拆出的纯帧归约重新缠在一起 —— **同一批次的两个任务在这一点上互相拉扯**。实际做法：reducer 管 `{ mode, product }`；`sizeFitSettled` 成为纯选择器，只在发送那一刻现算。这比原实现更省：原先是一个 `useMemo`，每条消息变化都要重算一遍并驻留。

② **未删除 UI 测试 —— 计划「UI 测试行数下降」的前提不成立。** 实测两个文件不是「为了覆盖这些规则而存在」：`assistant.test.tsx` 10 例中只有 3 例沾会话规则，其余是流式渲染、错误重试、卡片链接、PDP 锚定等接线；`assistant-speak.test.tsx` 8 例**全部**是 TTS 副作用（开关默认值、完成即读、去重、打断、历史不补读）。这些恰恰是 reducer 单测覆盖不到的「reducer → send → fetch 请求体」与副作用接线。删掉它们等于用「规则已被单测覆盖」换掉「接线不再有人验证」。故改为只增不删：新增 34 例单测，UI 测试原样保留。代价是本条出口未达成 —— 但达成它的方式（删测试）会让总覆盖变差。

③ **`useModalDismiss` 比计划签名多两个参数**：`open`（监听必须在关闭时卸载）与 `onKeyDown`（灯箱左右方向键）。计划写的 `{dialogRef, triggerRef, onClose}` 表达不了这两件事。

④ **钩子返回 `dismiss()`，而不只是装监听。** 三条关闭路径（Escape / 关闭按钮 / 点遮罩）都必须还原焦点。把「关状态 + 还焦点」绑成一个动作，调用方就不可能只做对一半；原实现里 `close()` 恰好兼做两件事，一旦有人拆开就会静默丢掉焦点还原（WCAG 2.4.3）。

⑤ **内部用「最新回调」ref 持有 `onClose` / `onKeyDown`。** 调用方几乎总是传箭头函数（每次渲染换身份），若进依赖数组，监听会在打开期间每次重渲染重挂 —— 副作用是焦点被反复抢回第一个元素。这是测试里「中间元素上的 Tab 不被劫持」之外的隐性坑，故在注释中写明。

⑥ **gift-gallery 不传 `triggerRef`**（不还原焦点）：每件赠品都是入口，没有可归属的单一触发元素。它换到的是**完整焦点圈闭** —— 原先只处理 Escape，Tab 能把焦点移到遮罩后的页面（WCAG 2.1.2 违规），这是本批次顺带修掉的一个真实 a11y 缺陷。

⑦ **过程中自己制造并修掉一个回归**：替换 care-instructions 关闭按钮时误把 `onClick={() => close()}` 整行删掉（只保留了 `aria-label`），关闭按钮会变成死按钮。读完文件核对时发现并补回 `onClick={() => dismiss()}`，随后由既有 UI 测试（点击 X 关闭）守住。

**回滚点：** `git commit -m "refactor(assistant): session reducer, pure SSE fold, shared modal dismissal"`

---

## 批次 6：收口与文档

**目标：** 处理剩余的死接口面、类型松动与注释审计，并把本次决策固化为 ADR。

**出口：** `bun run verify` + `bun run build` 全绿；`CONTEXT.md` 与 `docs/adr/` 建立。

**状态：✅ 已完成（6.1 按计划自身的前置条件跳过）。** `verify` = 63 文件 / **375 用例**全绿、0 lint 问题；
`build` = **42/42 静态页**；import 环 **0**；`CONTEXT.md` + 6 条 ADR 建立。

### 任务 6.1 —— 收缩死接口面（D2）⏭️ 跳过

- [x] **前置确认已执行，结论是「保留休眠可启用」，故本任务按计划的自身规定跳过。**
- [x] 记入「本计划不做」（见下方执行记录 ①）。

### 任务 6.2 —— 数据访问层收口（D3）→ 选 (b)

- [x] 采纳 (b)：接受内存筛选，在 `Repository` 工厂处写明这条**非显然约束** ——
      「前提是目录规模 ~10²（当前 29 款）；若增长到 10⁴，需把筛选下推到 SQL」。
- [x] 未改 `db-adapter.ts` / `service.ts` 的查询形态（与「只做 A3」的决策一致）。

### 任务 6.3 —— 类型与死参收紧（D4）

- [x] `server/ai/size-input.ts`：删除 `adviceFor` 的 `base?` 预留参数与 `void base`（唯一调用点本就传 `null`）。
- [x] `SizeAdvice`：`recommended: CanonicalSize | null`、`alternatives: CanonicalSize[]`
      （`nearestCanonical` 本就返回 `CanonicalSize | null`，故收紧无摩擦）。
- [x] 同步更新唯一调用点 `handlers.ts` 与 `size-input.test.ts` 的 4 处调用。
- [x] 验证：`bun run test -- src/server/ai`（全绿）。

### 任务 6.4 —— 注释审计

- [x] 保留：`keyword.ts` 的位置权重理由、`create-store.ts` 的 `getServerSnapshot` 引用稳定性、
      `embedder.ts` 的网关 `encoding_format` 怪癖、`openai-compat.ts` 的惰性构造、安全与合规边界。
- [x] `shopify-buy.ts` 顶部 17 行数据来源史 → 压缩为 1 行维护说明（保留两条真正的约束：不改 Product/schema；
      绝不复用 `SHOPIFY_DOMAIN`/`SHOPIFY_STOREFRONT_TOKEN`）。
- [x] `product-filter-bar.tsx` 的 11 行 `baseRef` 论证 → 3 行。
- [x] `assistant-page-anchor.tsx` 的自问自答（「…？No——」）→ 一句陈述。
- [x] `chat-events.ts` 复述字段名的逐字段 JSDoc（`photoCount` / `colorCount`）→ 删除；
      携带真实信息的（`subtitle` = 货号、`sizeRange` 的 null 语义、`palette` 的「仅 SVG 兜底时才需要」）→ 保留。
- [x] 全仓 `规格 §x` / `决策 #n` 编号引用 → **全部清理为 0**（见执行记录 ②）。
- [x] 文档指针核验：`src/` 内无 `docs/*.md` 指针；`docs/` 与 README 的相对链接逐条存在性检查通过。
- [x] 验证：`bun run verify`

### 任务 6.5 —— 建立领域词汇与 ADR（D6）

- [x] `CONTEXT.md`：术语表 —— `CanonicalSize`（EU 整档 35–48，唯一存储形式）、`Product`/`ProductView`、
      `Mode`、`SizeAdvice`、`CatalogAdapter`、`RetrievalResult`、`Guardrails`、`PageProductRef`、
      `ChatEvent`/`ChatMessage`，每项含定义 + 不变量，并补一节「目录层」依赖规则表。
- [x] `docs/adr/0001-canonical-eu-size-storage.md`
- [x] `docs/adr/0002-dual-db-driver-thin-adapters.md`
- [x] `docs/adr/0003-zero-migration-idempotent-ddl.md`
- [x] `docs/adr/0004-ai-never-emits-price.md`
- [x] `docs/adr/0005-shared-domain-layer.md`
- [x] `docs/adr/0006-bun-to-node-scope.md`
- [x] `docs/implementation-report.md` 顶部加时效标注（实际有 **3** 处与当前 HEAD 不符，计划只列了 2 处）。
- [x] `docs/superpowers/plans/execution-notes.md` 追加本次批次记录表。

### 任务 6.6 —— 重复 UI 基元收敛

- [x] 心形 SVG path（`wishlist-button` / `product-result-card` / `saved-pairs` 三份）→
      抽出 `components/shop/wishlist-icon.tsx`，全仓该 path 由 3 份降为 **1 份**。
- [x] `error.tsx` / `not-found.tsx` 外壳 → 抽出 `components/marketing/status-shell.tsx`，
      并把重复 3 次的长 CTA class 收敛为 `STATUS_CTA_CLASS`；两文件合计 −55 行。
- [x] 图片包裹层类名（`product-card` / `gift-gallery` / `collection-cards`）：按计划**不单独开任务**，未动。

### 执行记录（与计划的偏差）

① **6.1 跳过，且理由与计划的预设方向相反。** 计划要求先确认「Shopify 通道是否仍要保持休眠可启用」，
不确定则跳过。核实结果是**确定要保留**：`README.md:108` 写明 `SHOPIFY_DOMAIN`/`SHOPIFY_STOREFRONT_TOKEN`
与 `SHOPIFY_BUY_*` 分离是「**on purpose**」、设前者会「trip the catalog stub」；`README.md:107` 标注
「Reserved / not yet active」；`.env.example:67` 重复了同一警告；spec #14 记为「远期仍可选」。
既然答案是「保留」，计划给的选项 (b)（**删除** `shopify-stub` 与 `shopifyEnabled()`）就与本意相反 ——
所以跳过不是犹豫，而是结论。
附带确认：`getBuyUrl` 的确是死接口面（4 处实现全返回 `null`，唯一消费点永远拿不到非 null），
但删除它是**产品可见**的决定（去掉一条休眠的购买路径），计划把它与前置条件捆在一起，
故不在本批次单方面执行。**留作后续一次性决策。**
② **6.4 的编号引用是「已被验证失效」，不是照着描述删。** spec 中 `决策 #15`–`#20` 的标签**已不存在**
（列表裁剪后重编号，见 `09ac764`），而 `src/` 里有 **36 处**引用它们；`§8.5.2` / `§8.5.6` / `§8.3.4`
在 spec 中**从未出现**（spec 只到 `### 8.5`）。即编号已自行腐烂，故一律删编号、保留描述性文字。
机械替换产生了几处破损片段（`（，消费端措辞`、`（：本地程序化`、`（/§8.5.5`、`（注）`、`（+ P1`），
逐条读 diff 后修掉。
③ **`product-filter-bar.tsx` 只压缩注释，未收敛逻辑。** 计划写「若该逻辑本身可收敛则优先收敛」。
评估结论是不收敛：`baseRef` + 无依赖数组的 effect 是处理「RSC 提交渲染与在途意图竞争」的正确形态，
改写它属于**冒真实回归风险换取更短代码**，与本次「等价改写」的原则相悖。
④ **6.6 两项都做了**（计划标「可选」），因为两处都满足「真有重复 + 抽取后不新增抽象」。
心形 path 从 3 份降到 1 份；两处页面壳合计减 55 行。
⑤ **6.5 的时效标注纠正了计划的事实**：计划说 2 处不符，实际是 **3** 处（还漏了
`bun --bun run build` 这条 gate 命令本身）。
⑥ **自己制造并修掉的缺陷：** 追加 `execution-notes.md` 时新起了第二个 H1（MD025）；
替换 care-instructions 关闭按钮时误删 `onClick`（批次 5）。
另：本轮有**两次实验设计错误**——第一次 boundary 探针没插进 `'use client'` 文件（探针无效，
「✓ clean」无意义），已用真探针重做并确认 guard 会以 exit 1 报 2 处违规。

**回滚点：** `git commit -m "chore: prune dead seams, tighten types, audit comments, add CONTEXT and ADRs"`

---

## 批次 7：包管理器层去 Bun（已完成）

**为什么单独成批：** 批次 1–6 的验证模型是「代码改动 + 门禁不变 + 294 用例全绿 ⇒ 行为等价」。工具链迁移会改变传递依赖的解析版本 —— 若与重构混在一起，一旦变红就**无法归因**是重构错了还是运行时变了。本批把唯一的控制变量单独隔离，使失败只有一个可能来源。

**状态：✅ 已完成。** 分支 `chore/de-bun-package-manager`，从 **合并后的 main**（`9d92351`）切出。
出口的三个判据全部达成：冷启动 `npm ci` + `npm run verify` 全绿（**63 文件 / 375 用例**）、
`npm run build` 绿（**42/42**）、`git diff --stat 9d92351..HEAD -- src/` **为空**。

**入口条件：**

- [x] 批次 1–6 全部落地并已 commit，工作区干净（PR #1 已合并、远程分支已删）。
- [x] `verify` 与 `build` 在干净工作区全绿，测试数 ≥ 294（实测 63 文件 / 375 用例）。
- [x] 已在独立分支上。**注意基点与计划不同**：计划写 `git switch -c`（即从重构分支 tip 切出），
      实际从**合并后的 main** 切出，理由见执行记录 ①。

### 任务 7.1 —— 选定包管理器并定稿 ADR

- [x] 选 **npm**：`verify` 脚本已是 `npm run …`、CI 已装 Node、`engines.node` 已声明。
- [x] pnpm 未评估 —— 计划本身写明「没有明确理由就选 npm」，且无理由。

### 任务 7.2 —— 生成新锁文件

- [x] 删除 `bun.lock`，`npm install` 生成 `package-lock.json`。
- [x] `git status` 核对：本步只产生锁文件变更。
- [x] 依赖版本漂移清单已逐个核对（714 包对照），**结论：无一处无法解释的漂移**。
- [x] 原生模块实测：`better-sqlite3` 通过（详见执行记录 ③）；`sharp` / `unrs-resolver` / `esbuild` 亦逐一实测可加载。
- [x] 验证：`npm run verify` 全绿。

### 任务 7.3 —— `package.json` 去 bun 化

- [x] `packageManager`: `bun@1.3.14` → `npm@12.0.1`。
- [x] 删除 `ignoreScripts` 与 `trustedDependencies`。
- [x] **未**添加 `allowScripts`，也**未**采用计划的「`npm ci --ignore-scripts` + 手工 rebuild」——
      计划此处前提被实测推翻，详见执行记录 ②。
- [x] `verify` 脚本未改动。

### 任务 7.4 —— CI 切换并补 Node 版本矩阵

- [x] 删除 `oven-sh/setup-bun` 步骤；保留 `actions/setup-node@v6` 并加 `cache: npm`。
- [x] `bun install --frozen-lockfile` → `npm ci`；`bun run verify` → `npm run verify`。
- [x] 加 `node-version` 矩阵 `[20, 22, 24]` 与 `fail-fast: false`。
- [x] 追加：两个 action 由可变标签钉死为提交 SHA（见执行记录 ⑤）。

### 任务 7.5 —— 文档同步

- [x] `README.md`：前置要求 → Node ≥ 20.9 + npm；`bun install` → `npm ci`；命令表 9 行改为 `npm run x`（保留「Node runtime」说明）。
- [x] 全仓 `grep -rn "bun" README.md docs/ AGENTS.md`：README 与 AGENTS.md 已 **0** 命中；
      `.github/` 唯一命中是 `ubuntu-latest`（含子串）；`docs/` 残留仅存在于归档、ADR 0006 与历史报告。
- [x] `docs/implementation-report.md` 时效标注补记包管理器现状。
- [x] 顺带修正 README 两处早已过期的事实（见执行记录 ⑥）。

### 任务 7.6 —— 归因证明与冷启动验证

- [x] **代码零改动证明**：`git diff --stat 9d92351..HEAD -- src/` **为空**。
- [x] **冷启动验证**：删除 `node_modules` → `npm ci` → `npm run verify` 全绿 → `npm run build` 全绿。
- [x] 每个任务独立 commit（锁文件 `7e9ed5e` / package.json `8777ea1` / CI `38bf438` / 文档 `802da2f`，
      另加 SHA 钉死 `f99aba1`）。

### 执行记录（与计划的偏差）

① **基点改为「合并后的 main」。** 计划写 `git switch -c chore/de-bun-package-manager`，即从重构分支
   tip 切出。改为在 PR #1 合并进 main 之后从 main 切出。**理由是归因**：本批出口含 CI 矩阵全绿，
   若基点是未合并的重构，那次 CI 里就装着整个重构（139 文件 / +3544−1454），一红便无法回答
   「是工具链层还是重构层」—— 而可归因正是把本批拆出去的**全部理由**。
② **计划关于 npm 默认行为的描述被实测推翻。** 计划写「npm 默认允许全部 postinstall」，据此给了
   两个选项。实测 **npm 12 默认阻止全部 install script**，需显式 `allowScripts` 白名单才放行。
   于是选项二（`--ignore-scripts`）失去意义（默认即此），而选项一实际指向的是一套**比 Bun 允许名单
   更严格**的策略。**决定：不添加 `allowScripts`，直接采用 npm 12 默认**，因为实测那 5 个被拦脚本
   在本项目并非必需，且默认姿态比迁移前更严格而非更宽松。
③ **计划列为「最高风险」的 `better-sqlite3` 重编译风险并未发生。** 它是任务 7.2 里唯一被要求
   「单独实测」的项。实测 `better-sqlite3@13` 自带**全平台 N-API 预编译产物**
   （`prebuilds/darwin-arm64.node` 等），运行时可加载，不需要 node-gyp。计划的风险行前提已过时。
④ **计划未提及的坑：锁文件会把 registry 写死。** `package-lock.json` 记录 `resolved` URL，而本机
   全局配置是 `registry.npmmirror.com`；照此生成会把第三方 CDN 写进锁文件、让 CI 也走该镜像。
   故改用官方 registry 生成（983 条 `resolved` 全部指向 `registry.npmjs.org`）。顺带实测到镜像当时
   严重降速（二进制 36 KB/s 且 90s 未下完 vs 官方 1.38 MB/s，约 38 倍差），这是必须走官方源的第二个理由。
⑤ **7.4 之后追加一个提交，修订了 7.4 自身的判断。** 7.4 的提交信息写明「SHA 钉死属独立决定，
   不在本批范围」。该判断已修正：`verify.yml` 正是本批修改的 6 个文件之一，钉死其中用到的 action
   属于本批份内事。SHA 经 `git ls-remote refs/tags/v6^{}` + `gh api` 两步核实后才写入。
⑥ **顺带修正 README 两处早已过期的事实**（与本批直接相关，故顺手改）：命令表写的测试数是
   56 文件 / 294 用例（实际 63 / 375）；验收门描述漏了批次 3 新增的 `check:boundary`，
   且把 `build` 列入了 `verify`（verify 里并没有 build）。
⑦ **计划的风险行「批次 7 与批次 3 同时改 package.json」未造成冲突**：两者改的是 `package.json`
   的不同区域（批次 3 加 `check:boundary` 脚本，本批改 `packageManager` 并删两个字段），
   且本批基点已含批次 3 的结果。

**回滚点：** `git commit -m "chore(toolchain): move package manager from bun to npm (isolated, src/ untouched)"`
（实际按任务拆成 5 个提交，见 7.6）

---

## 执行顺序与依赖

```text
批次 1（去重）
   └─> 批次 2（store + config + provider 环）
          └─> 批次 3（domain 边界；依赖 1.1/1.2 的产物落位）
                 └─> 批次 4（AI 拆分；依赖 2.2 的 config 与 3.x 的 domain 类型）
                        └─> 批次 5（助手状态；依赖 2.1 的 store）
                               └─> 批次 6（收口与文档）
                                      └─> 批次 7（包管理器去 Bun：隔离归因）
```

顺序理由：**先消除重复**，否则后续拆分会把重复一起搬走；**再换接缝位置**（批次 3 是全计划唯一大批量修改 import 路径的批次）；**最后动编排与 UI 状态**，此时类型与依赖已稳定。

## 验收总表

| 批次 | 必须通过                                         | 新增测试                                                    | 关键不变量                                    |
| ---- | ------------------------------------------------ | ----------------------------------------------------------- | --------------------------------------------- |
| 1    | `verify` + `build`                               | 无（等价证明）                                              | 行为零变化；加商品字段改 2 处                 |
| 2    | `verify`                                         | `create-store.test.ts`、`config.test.ts`                    | import 环 = 0；env 全部调用时求值             |
| 3    | `verify` + `build`                               | 边界守卫脚本                                                | `'use client'` 模块不非类型导入 `@/server/**` |
| 4    | `verify` + `build`                               | `context.test.ts`、每 mode 单测、注入式 `retrieval.test.ts` | 每个 mode 独立可测                            |
| 5    | `verify`                                         | `session.test.ts`、`applyEvent` 单测、`use-modal.test.ts`   | 焦点陷阱单点实现                              |
| 6    | `verify` + `build`                               | ADR / CONTEXT 文档                                          | 死接口面收缩或显式记账                        |
| 7    | `npm ci` 冷启动 `verify` + Node 20/22/24 CI 矩阵 | 无（工具链层，不新增测试）                                  | `src/` 零改动                                 |

## 风险与缓解

| 风险                                  | 缓解                                                                                            |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 批次 3 的 import 批量重写遗漏         | 3.1 先建垫片使每步可验证，3.3 删垫片时 typecheck 会精确报出遗漏点                               |
| 批次 2 改动 env 读取时机影响既有测试  | 测试集中在 `bun run test` 全量跑；`envInt` 的硬化语义有专测                                     |
| 批次 4 的 SSE 行为回归（流式边界）    | 保留 `chat.test.ts` 的端到端护栏顺序用例；新 handler 单测补齐后不删旧用例                       |
| 批次 6.1 触碰 Shopify 语义            | 已标注为「不确定则跳过」，默认按 (b) 只移除死方法、保留静态映射模块                             |
| 未提交改动的 diff 污染                | 前置动作：先 commit/stash `supplier.json` 与 spec 改动                                          |
| 批次 7 锁文件重生导致依赖版本漂移     | 独立分支 + 逐项列出 vitest/next/eslint/better-sqlite3 版本变化；无法解释即回退并保留 `bun.lock` |
| `better-sqlite3` 在 npm 下重建失败    | 迁移后必须实跑 DB 测试；必要时 `npm rebuild better-sqlite3`                                     |
| 批次 7 与批次 3 同时改 `package.json` | 串行执行：批次 3 定型 `verify` 脚本后才允许开工批次 7                                           |
