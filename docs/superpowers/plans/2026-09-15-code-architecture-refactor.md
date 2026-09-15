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

**目标：** 收敛 4 份手写 localStorage/external-store 样板（A5），消除 2 个 import 环与不一致的 env 读取时机（A4），并建立统一的 env 门面（D1）—— D1 是 A4 的前置。

**出口：** `bun run verify` 全绿；新增 store 单测；import 图环数 **2 → 0**。

### 任务 2.1 —— `createPersistentStore` 深模块（A5）

- [ ] 新建 `src/lib/create-store.ts`：

```ts
export interface Store<T> {
  subscribe(listener: () => void): () => void
  getSnapshot(): T
  getServerSnapshot(): T
  set(next: T | ((prev: T) => T)): void
}
export function createPersistentStore<T>(spec: {
  key: string
  serverSnapshot: T
  decode(raw: string | null): T
  encode(value: T): string
}): Store<T>
export function createStore<T>(spec: {
  initial: T
  serverSnapshot: T
}): Store<T> // 无持久化
```

要求：懒加载（首次 `getSnapshot` 才读 `localStorage`）、写入包 `try/catch`（隐私模式静默）、`serverSnapshot` 引用稳定、`window === undefined` 时返回 `serverSnapshot`。

- [ ] 新建 `src/lib/create-store.test.ts`：覆盖懒加载、JSON 损坏回退、写入广播、SSR 快照稳定性。
- [ ] `src/lib/speak-preference.ts` → 用 `createPersistentStore<boolean>` 重写（`'1'`/`'0'` 编解码）。
- [ ] `src/lib/my-size.ts` → 用 `createPersistentStore<number | null>` 重写，仅保留 `MY_SIZE_*` 常量与「我的尺码」领域的公开函数。
- [ ] `src/components/shop/wishlist-provider.tsx` → 内部改用 `createPersistentStore<string[]>`，Provider/Context 外壳保留（`useOptionalWishlist` 的契约不能动）；删除文件里那段解释「为什么用 external store」的长注释，将其结论并入 `create-store.ts` 的接口文档。
- [ ] `src/lib/page-product.ts` → 改用 `createStore<PageProductRef | null>`（无持久化）。
- [ ] 验证：`bun run test -- src/lib src/components/shop/wishlist-button.test.tsx src/components/shop/saved-pairs.test.tsx`

### 任务 2.2 —— env 门面 `src/config.ts`（D1）

- [ ] 把 `src/server/guardrails/env-int.ts` 迁为 `src/config.ts`，导出 `envStr(name, fallback='')`、`envInt(name, fallback)`、`envFlag(name, fallback=false)`；全部**调用时求值**，保留空串/空白硬化语义（`envInt` 的既有注释是这套硬化的取值理由，保留其要点）。
- [ ] `src/server/guardrails/env-int.test.ts` → 迁为 `src/config.test.ts`。
- [ ] 改 4 个消费方 import：`guardrails/budget.ts`、`guardrails/session-state.ts`、`guardrails/text.ts`、`ai/openai-compat.ts`。
- [ ] `src/server/search/embedder.ts`：删除顶层 `const base` / `const model` 快照，改为函数内 `envStr` 调用。
- [ ] `src/server/ai/openai-compat.ts`：删除顶层 `const AI_MODEL` 与 `TIMEOUT_MS` 快照，改为 `stream()` 内求值。
- [ ] `src/server/catalog/shopify-buy.ts` / `shopify-stub.ts` / `db/dialect.ts` / `db/client.ts` / `lib/market.ts`：逐一改走 `envStr` / `envFlag`（这些本已是调用时读取，只统一取值方式）。
- [ ] 验证：`bun run test`（全量，env 相关用例分布较广）

### 任务 2.3 —— 拆掉 AI provider 环（A4）

- [ ] `src/server/ai/provider.ts` 收敛为**纯接口**：只留 `AiContext`、`AiProvider`；删除文件中的工厂代码与运行时 import。
- [ ] 新建 `src/server/ai/factory.ts`：迁入 `realEnabled` / `aiProvider` / `aiModel`，沿用 `envStr`。
- [ ] 更新消费方 import：`ai/chat.ts`、`app/api/ai/chat/route.ts`，以及测试中 mock 掉工厂的位置。
- [ ] 验证 import 图无环（重新跑一次 DFS 或人工确认：`factory → {openai-compat, mock} → provider`，单向）。
- [ ] 验证：`bun run test -- src/server/ai`

### 任务 2.4（可选，低优先）—— 目录适配器改为惰性单例

- [ ] `src/server/catalog/adapter.ts` 的模块级 IIFE 会在 import 时快照 `CATALOG_SOURCE` / `SHOPIFY_*`。改为 `export const catalog = (): CatalogAdapter => (instance ??= pick())`。
- [ ] 机械更新 6 个消费方（`catalog/service.ts`、`search/retrieval.ts`、`app/shop/page.tsx`、`app/product/[handle]/page.tsx`、`app/api/*`）。
- [ ] 若改动面超出预期，**跳过本任务**并在本文件「本计划不做」表中补记理由 —— 当前 vitest 已通过 config 级 `CATALOG_SOURCE: 'seed'` 规避该问题，收益有限。

**回滚点：** `git commit -m "refactor(state,config): one store implementation, one env facade, acyclic AI provider seam"`

---

## 批次 3：域边界重组

**目标：** `src/server/**` 目前被客户端大面积 import —— server/client 边界名存实亡；同一个尺码域被 `server/catalog/size-charts.ts` 与 `lib/my-size.ts` 切成两半。建立 `src/domain/` 作为两端共享的纯域层。

**出口：** `bun run verify` + `bun run build` 全绿；新增一条边界守卫（脚本或 lint 规则）；此后 `src/server/**` 不再被任何 `'use client'` 模块非类型导入。

### 任务 3.1 —— 建立 `src/domain/` 并保留兼容垫片

- [ ] 新建 `src/domain/product.ts`：迁入 `server/catalog/types.ts` 的领域类型（`SizeSystem`、`CanonicalSize`、`Price`、`Colorway`、`Product`、`Collection`、`ProductFilter`）。
- [ ] 新建 `src/domain/size.ts`：合并 `server/catalog/size-charts.ts` 全部纯函数 与 `lib/my-size.ts` 的纯函数（`footMmRow` / `footMmToEU` / `footMmToSystem` / `MY_SIZE_MIN_MM` / `MY_SIZE_MAX_MM`）。
- [ ] 新建 `src/domain/size-fixture.ts`：从 `server/catalog/size-fixture.ts` 迁入。
- [ ] 把批次 1 的 `search-text.ts`、批次 1.2 的尺码格式化函数并入 `domain/`。
- [ ] 旧路径暂时改为 `export * from '@/domain/...'` 垫片，使本任务可独立验证。
- [ ] 验证：`bun run test` 全绿（此步应零行为变化）。

### 任务 3.2 —— 全量改写消费方 import

- [ ] 机械替换全部 `@/server/catalog/types` → `@/domain/product`（fan-in 28）。
- [ ] 全部 `@/server/catalog/size-charts` → `@/domain/size`（含 `assistant-panel.tsx` 等 `'use client'` 文件）。
- [ ] 全部 `@/server/catalog/size-fixture` → `@/domain/size-fixture`（含 `lib/my-size.ts`）。
- [ ] `lib/my-size.ts` 只保留存储层（持久化 mm 值与 store 接线），域数学全部来自 `@/domain/size`。
- [ ] `lib/size-range.ts` 改为从 `@/domain/size` 取格式化原语。
- [ ] 验证：`bun run test` + `bun run typecheck`

### 任务 3.3 —— 删除垫片并加边界守卫

- [ ] 删除 `server/catalog/types.ts`、`server/catalog/size-charts.ts`、`server/catalog/size-fixture.ts` 三个垫片文件。
- [ ] 确认 `server/catalog/service.ts` 的 `ProductView` 定义位置：`ProductView` 被 14 个文件引用，且被客户端组件用于 props → 一并迁入 `domain/product.ts`，`service.ts` 只保留取数函数。
- [ ] 新增守卫，二选一：
  - **首选** `scripts/check-server-boundary.mjs`：扫描含 `'use client'` 的文件，若出现非 `import type` 的 `from '@/server/...'` 则退出码 1；接入 `package.json` 的 `verify`。
  - 备选：`eslint.config.mjs` 中对 `src/components/**` 与 `src/lib/**` 加 `no-restricted-imports` 的 `@/server/*` 规则。
- [ ] 验证：守卫脚本在当前代码上通过（既证明迁移完整，也证明守卫可用）。

**回滚点：** `git commit -m "refactor(domain): move product types and size math into a shared domain layer"`

---

## 批次 4：AI 编排解耦

**目标：** `ai/chat.ts`（293 行 / 16 import，全仓 fan-out 最高）把护栏顺序、5 个 mode 分支、上下文构造、流式转发、记账、错误映射挤在一个生成器里，导致改任一 mode 都必须穿过整条护栏栈才能测试。同时去掉 `retrieve()` 的隐式全局依赖与「默认参数陷阱」。

**出口：** `bun run verify` + `bun run build` 全绿；每个 mode 有独立单测；`chat()` 主函数 ≤ 80 行。

### 任务 4.1 —— 抽出 `ai/context.ts`

- [ ] 把 `chat.ts` 中的纯函数移出：`productContextOf`、`digestLines`、`toCard`（连同批次 1.2 已迁走的 `sizeRangeText` 调用点）。
- [ ] 新建 `src/server/ai/context.test.ts`，直接对纯函数断言（当前这些逻辑只能经 SSE 端到端断言）。

### 任务 4.2 —— 按 mode 拆分处理函数

- [ ] 定义统一签名：`type ModeHandler = (ctx: TurnContext) => AsyncGenerator<ChatEvent, void, void>`，其中 `TurnContext` 携带 `{req, text, history, provider, guardrails, record}`。
- [ ] 拆出 `handleSizeFit`（含 `footMmToEU` 预填）、`handleOutfit`、`handleSupport`、`handleFindShoes`、`handleShopping`（后两者共用检索分支）。
- [ ] `chat()` 收敛为：`truncateMessage` → `assertRate` → `assertBudget` → `assertTurn` → `modeHandlers[req.mode](ctx)` → `catch → toErrorEvent`。
- [ ] `streamAssistantReplies` 的 `yield*` 复用结构保留（那处注释解释了「yield 不能出现在箭头闭包内」这一非显然约束 —— 属保留范围）。
- [ ] 为每个 handler 增加独立单测，覆盖现有 `chat.test.ts` 已断言的场景；`chat.test.ts` 保留护栏顺序相关的端到端用例。
- [ ] 验证：`bun run test -- src/server/ai`

### 任务 4.3 —— `retrieve()` 注入化（B3）

- [ ] `src/server/search/retrieval.ts`：签名改为 `retrieve(query: string, deps: { products: Product[]; repo: Repository; canEmbed: () => Promise<boolean>; embed: EmbedFn })`。
- [ ] 删除默认参数 `repo = createDefaultRepository()` 与 `opts = { embedIfAvailable: true }`（后者依赖调用约定，是缺陷不是配置）；`features` 开关由组合根决定是否调用。
- [ ] 删除文件内对 `catalog` 单例的 import；`products` 由调用方传入。
- [ ] 新增 `src/server/ai/retrieval-gateway.ts`（或放在 `ai/context.ts`）作为组合根，装配 `catalog` + `createDefaultRepository()` + `embeddingsAvailable` + `embed`，供 `chat.ts` 使用。
- [ ] 同步更新 `retrieval.test.ts`：改用注入的假 repo / 假 embed，删除为绕过单例而做的 env 设置。
- [ ] 验证：`bun run test -- src/server/search src/server/ai`

**回滚点：** `git commit -m "refactor(ai): per-mode handlers, extracted context builders, injected retrieval deps"`

---

## 批次 5：助手状态与模态统一

**目标：** `assistant-provider.tsx` 同时持有 chat 流状态、面板开关、朗读副作用，以及「size-fit 已结算则自动转 shopping」这条领域规则；两个 ~300–500 行的 UI 测试是为了覆盖这些规则而存在的。同时焦点陷阱在两个组件里被逐字复制。

**出口：** `bun run verify` 全绿；会话规则由 reducer 单测覆盖；UI 测试行数下降。

### 任务 5.1 —— 会话 reducer

- [ ] 新建 `src/components/assistant/session.ts`：`sessionReducer(state, action)` 管 `{ mode, product, messages, sizeFitSettled }`；`sizeFitSettled` 由 reducer 内的派生函数算出，不再是 `useMemo` 里的遍历。
- [ ] 新建 `src/components/assistant/session.test.ts`：覆盖「size-fit 已结算 + 自由输入 → shopping」「移除商品上下文 → mode 归位 shopping」「chip 重入 size-fit/outfit」三条现有规则。
- [ ] `assistant-provider.tsx` 改用 reducer，只保留：store 接线、朗读副作用、`AssistantHandle` 的 `open`/`close`。
- [ ] 验证：`bun run test -- src/components/assistant`

### 任务 5.2 —— SSE 帧归约抽为纯函数

- [ ] `use-chat-stream.ts`：把 `onEvent` 里对单条 `ChatEvent` 的 state 变换抽为纯函数 `applyEvent(message, event): ChatMessage`；`isValidCard` 保留（它守的是运行时形状，非样式）。
- [ ] 新增单测覆盖 delta / productCards / sizeFit / done / error 五类帧。
- [ ] 验证：`bun run test -- src/components/assistant`

### 任务 5.3 —— 模态与焦点陷阱统一（B5）

- [ ] 新建 `src/lib/use-modal.ts`：`useModalDismiss({ dialogRef, triggerRef, onClose })` —— 打开时聚焦首个可聚焦元素、Tab/Shift+Tab 环形、Escape 关闭、关闭后焦点还原触发元素。
- [ ] 新建 `src/lib/use-modal.test.ts`。
- [ ] 三处采用并删除各自的 `focusableIn` 副本与长注释：`components/shop/care-instructions.tsx`、`components/shop/product-buy-bar.tsx`、`components/shop/gift-gallery.tsx`（后者当前只有 Escape，改用后获得完整焦点圈闭）。
- [ ] 验证：`bun run test -- src/components/shop src/test/a11y`

**回滚点：** `git commit -m "refactor(assistant): session reducer, pure SSE fold, shared modal dismissal"`

---

## 批次 6：收口与文档

**目标：** 处理剩余的死接口面、类型松动与注释审计，并把本次决策固化为 ADR，避免后续架构审查重复提出同一议题。

**出口：** `bun run verify` + `bun run build` 全绿；`CONTEXT.md` 与 `docs/adr/` 建立。

### 任务 6.1 —— 收缩死接口面（D2）

- [ ] `CatalogAdapter.getBuyUrl` 在 `DbCatalogAdapter` 与 `SeedAdapter` 中恒返回 `null`，仅 `shopify-stub` 占位 —— 属「一个实现 = 假想接缝」。二选一：(a) 落地真实 Shopify adapter 证成该接口；(b) 从 `CatalogAdapter` 移除 `getBuyUrl`，`getBuyUrl` 调用点改为直接使用已独立的 `shopify-buy.ts` 映射（该模块本就是与 catalog 无关的静态表）。
- [ ] 若选 (b)，同步删除 `shopify-stub.ts` 与 `adapter.ts` 的 `shopifyEnabled()` 分支。
- [ ] **前置确认：** 该决策会改变 `CATALOG_SOURCE` / `SHOPIFY_*` 的语义，需先确认 Shopify 通道是否仍要保持「休眠可启用」。若不确定，**跳过本任务**并记入「本计划不做」。

### 任务 6.2 —— 数据访问层收口（D3）

- [ ] `server/catalog/db-adapter.ts` 的 `getProductByHandle` 目前 `listAllProducts().find()`；`service.ts` 的 `getRelatedProducts` 连做两轮全表。
- [ ] 二选一：(a) `Repository` 暴露 `getProductByHandle` / `queryProducts(filter)`，把筛选下推到 DB；(b) 明确接受内存筛选，在接口处写清「目录规模 ≤2k 的前提」这一非显然约束。
- [ ] 按「只做 A3，不合并 repository」的决策，**推荐 (b)** —— 改动最小且诚实。

### 任务 6.3 —— 类型与死参收紧（D4）

- [ ] `server/ai/size-input.ts`：删除 `adviceFor` 的 `base?` 预留参数与 `void base`（无调用方使用）。
- [ ] `SizeAdvice`：`recommended: CanonicalSize | null`、`alternatives: CanonicalSize[]`。
- [ ] 验证：`bun run test -- src/server/ai/size-input.test.ts`

### 任务 6.4 —— 注释审计（按已定策略）

逐文件执行，判定标准：**这条注释是否记录了不读代码就无法得知的约束？** 是 → 保留；否 → 删除。

- [ ] 保留（示例，非穷举）：`keyword.ts` 的位置权重取值理由；`wishlist` 相关的 React 19 `getServerSnapshot` 引用稳定性约束（迁移至 `create-store.ts` 的接口文档后从组件内删除）；`embedder.ts` 中 ModelScope 网关强制 `encoding_format` 的外部系统怪癖；`openai-compat.ts` 中「惰性构造 OpenAI client」的理由；`next.config` / a11y 相关的安全与合规边界。
- [ ] 删除：`shopify-buy.ts` 顶部约 20 行数据来源史（压缩为一句 + 指向 `docs/adr`）；`product-filter-bar.tsx` 中 20 行 `baseRef` 论证（若该逻辑本身可收敛则优先收敛，否则压缩到 3 行）；`assistant-page-anchor.tsx` 中含自问自答（「…？No——」）的编辑残留；`events.ts` 中复述字段名的逐字段 JSDoc；各处 `规格 §x` / `决策 #n` 编号引用。
- [ ] 全仓清理被引用但已不存在的文档指针（`docs/superpowers/specs/...` 正在被裁剪）。
- [ ] 验证：`bun run verify`

### 任务 6.5 —— 建立领域词汇与 ADR（D6）

- [ ] 新建 `CONTEXT.md`：术语表 —— `CanonicalSize`（EU 整档 35–48，唯一存储形式）、`ProductView`、`Mode`、`CatalogAdapter`、`Guardrails`、`RetrievalResult`、`PageProductRef`、`SizeAdvice`。每项一句定义 + 不变量。
- [ ] 新建 `docs/adr/`，至少落 6 条（每条 ≤1 页：背景 / 决策 / 后果）：
  - `0001-canonical-eu-size-storage.md` —— 为什么 canonical 是 EU 整档而非 mm 或 US
  - `0002-dual-db-driver-thin-adapters.md` —— 为什么保留两份 repository 薄壳而不合并（对应本计划「不做 C1」）
  - `0003-zero-migration-idempotent-ddl.md` —— 为什么不用 drizzle-kit 迁移（对应「不做 C2」）
  - `0004-ai-never-emits-price.md` —— AI 卡片与 prompt 一律不带价的理由
  - `0005-shared-domain-layer.md` —— 为什么 `src/domain/` 存在，`server/` 不得被客户端非类型导入
  - `0006-bun-to-node-scope.md` —— 为什么包管理器层去 Bun 推迟到批次 7 独立执行（含入口条件与完整评估）
- [ ] `docs/implementation-report.md` 是 HEAD `83fd694` 的历史快照，其中「DB: SQLite via `bun:sqlite`」与「scripts bake in `bun --bun`」已与当前 HEAD 不符（`6c826b9` 已换成 `better-sqlite3`，CI 走 `bun run verify`）→ 顶部加时效标注，指明当前驱动以 `src/db/client.ts` 为准。
- [ ] 在 `docs/superpowers/plans/execution-notes.md` 追加本次批次记录表。

### 任务 6.6（可选）—— 重复 UI 基元收敛

- [ ] 心形 SVG path 在 `wishlist-button.tsx` / `product-result-card.tsx` / `saved-pairs.tsx` 出现 3 次 → 抽 `components/shop/wishlist-icon.tsx`。
- [ ] `error.tsx` 与 `not-found.tsx` 的外壳类名（3 组）完全重复 → 抽 `components/marketing/status-shell.tsx`。
- [ ] 图片包裹层类名（`product-card` / `gift-gallery` / `collection-cards`）重复 → 仅在改动其他内容时顺带处理，不单独开任务。

**回滚点：** `git commit -m "chore: prune dead seams, tighten types, audit comments, add CONTEXT and ADRs"`

---

## 批次 7：包管理器层去 Bun（独立执行，不属于本轮重构）

**为什么单独成批：** 批次 1–6 的验证模型是「代码改动 + 门禁不变 + 294 用例全绿 ⇒ 行为等价」。工具链迁移会改变传递依赖的解析版本 —— 若与重构混在一起，一旦变红就**无法归因**是重构错了还是运行时变了。本批把唯一的控制变量单独隔离，使失败只有一个可能来源。

**入口条件（全部满足才允许开工）：**

- [ ] 批次 1–6 全部落地并已 commit，工作区干净。
- [ ] `bun run verify` 与 `bun run build` 在干净工作区全绿，测试数 ≥ 294。
- [ ] 已在独立分支上：`git switch -c chore/de-bun-package-manager`。

### 任务 7.1 —— 选定包管理器并定稿 ADR

- [ ] 在 `docs/adr/0006-bun-to-node-scope.md` 补完「决策」段：**推荐 npm** —— `verify` 脚本已是 `npm run …`、CI 已装 Node、`engines.node` 已声明，迁移面最小且不引入新工具。
- [ ] 若选 pnpm：额外评估其严格 `node_modules` 是否会暴露幽灵依赖，或与 Next / Tailwind 4 生态摩擦。**没有明确理由就选 npm。**

### 任务 7.2 —— 生成新锁文件（本批最高风险步）

- [ ] 删除 `bun.lock`，执行 `npm install` 生成 `package-lock.json`（首次生成用 `install`，之后 CI 用 `ci`）。
- [ ] 立即核对 `git status`：本步只应有锁文件变更。
- [ ] **列出依赖版本漂移清单** —— 逐个对比 `vitest` / `next` / `eslint` / `typescript` / `better-sqlite3` / `tailwindcss`。任何 major/minor 漂移都必须单独说明，无法解释即回退。
- [ ] **原生模块实测**：`better-sqlite3` 走 N-API，确认 npm 安装的产物能跑通 DB 用例（`npm run test -- src/db src/server/search`）。
- [ ] 验证：`npm run verify` 全绿。

### 任务 7.3 —— `package.json` 去 bun 化

- [ ] `packageManager`: `bun@1.3.14` → `npm@<实测版本>`。
- [ ] 删除 bun 专有字段 `ignoreScripts` 与 `trustedDependencies` —— 它们的意图是「只允许 `sharp` / `unrs-resolver` 跑 postinstall」，而 npm 默认允许全部 postinstall。
- [ ] 若要在 npm 下复刻同一严格策略：CI 用 `npm ci --ignore-scripts` + 显式 `npm rebuild sharp unrs-resolver`；否则在 ADR 里记录「接受 npm 默认行为」这一安全权衡。
- [ ] **不要改动 `verify` 脚本本身**（批次 3 已定型）。

### 任务 7.4 —— CI 切换并补 Node 版本矩阵

- [ ] `.github/workflows/verify.yml`：删除 `oven-sh/setup-bun` 步骤；保留 `actions/setup-node@v6` 并加 `cache: npm`。
- [ ] `bun install --frozen-lockfile` → `npm ci`；`bun run verify` → `npm run verify`。
- [ ] 加 `node-version` 矩阵 `[20, 22, 24]` —— 这是本批**唯一真实的新增收益**：`engines` 声明了 `>=20.9.0` 却至今只在 Node 24 上验证过，矩阵能证明该声明成立，或暴露它是谎话。

### 任务 7.5 —— 文档同步

- [ ] `README.md`：前置要求段（Bun ≥ 1.3）改为 Node ≥ 20.9 + npm；安装命令 `bun install` → `npm ci`；命令表 8 行的 `bun run x` → `npm run x`（保留「Node runtime」的既有说明）。
- [ ] 全仓 `grep -rn "bun" README.md docs/ AGENTS.md`，确认残留只存在于历史报告、ADR 叙事与 `docs/superpowers/` 归档中。
- [ ] `docs/implementation-report.md` 的时效标注（批次 6.5 已处理）补一句包管理器现状。

### 任务 7.6 —— 归因证明与冷启动验证（本批的验收核心）

- [ ] **代码零改动证明**：`git diff --stat <重构基线>..HEAD -- src/` 必须为空。`src/` 无改动 + 测试全绿 = 迁移本身对行为无影响。
- [ ] **冷启动验证**：删除 `node_modules`，`npm ci` 从零安装，再跑 `npm run verify`。这是唯一能证明「未安装 Bun 的贡献者 clone 后能跑」的实验。
- [ ] 每个任务独立 commit（锁文件 / `package.json` / CI / 文档分开），便于单点回退。

**出口：** `npm ci` + `npm run verify` 从零冷启动全绿；CI 在 Node 20/22/24 矩阵全绿；`src/` 零改动。

**回滚：** 若锁文件重生带来无法解释的版本漂移，`git checkout bun.lock package.json` 退回本批起点，在 ADR 0006 记录「尝试过 + 放弃原因」，保留 Bun 作为安装层。

**回滚点：** `git commit -m "chore(toolchain): move package manager from bun to npm (isolated, src/ untouched)"`

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
