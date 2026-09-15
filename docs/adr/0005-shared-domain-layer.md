# 0005 — 共享领域层 `src/domain/`，`server/` 不得被客户端运行时导入

**状态：** 已采纳 · **日期：** 2026-09-15（重构期决策）

## 背景

重构前，被客户端**运行时**导入的类型与纯计算散落在 `src/server/catalog/` 之下：

- `src/server/catalog/types.ts` 是**全仓 fan-in 最高的模块**（28 个导入方），其中包含
  `'use client'` 的 `use-chat-stream`（经 `server/ai/events.ts`）；
- `size-charts.ts` 的换算函数被 `components/assistant/assistant-panel.tsx` 导入；
- `size-fixture.ts` 的 `sizeRows` 被 `lib/my-size.ts` 导入。

于是 `src/server/` **名义上是服务端专属，实际不是**。这个误标是危险的：`server-only` 约定、
打包边界、以及「哪些代码会被送进浏览器」的判断全都建立在一个假前提上。而目录位置本身**不携带**
这个约束 —— 没有任何机制会告诉你「你刚刚把服务端模块拉进客户端 bundle 了」。

## 决策

建立 `src/domain/` 作为同构层，并把边界变成可执行的检查。

- `src/domain/` 持有两端共享的东西：`product.ts`（`Product` / `ProductView` / `CatalogAdapter` 除外
  的领域类型）、`size.ts`（换算 + 脚长推导）、`size-fixture.ts`、`search-text.ts`、
  `chat-events.ts`（SSE 线协议）。
- `src/server/` 持有真正只在服务端的：适配器与 DB、AI provider、guardrails、repository。
- **`CatalogAdapter` 刻意留在 `src/server/catalog/adapter-contract.ts`**：它是服务端适配器契约
  （`getBuyUrl` + DB/seed/Shopify 三种实现），不是领域概念。放进 domain 会迫使 domain 知道适配器。
- 新增 `scripts/check-server-boundary.mjs`，接进 `verify`（`npm run check:boundary`，位于
  `typecheck` 与 `lint` 之间）：**扫出任何从 `'use client'` 文件对 `@/server/**` 的非类型导入。**

## 后果

#### 正面

- 边界从「约定」变成「构建失败」。它无 allowlist，且被证明有判别力（用临时违规探针验证过会报错）。
- `import type` 与全内联 `type` 子句都被识别为类型擦除，因此既守住了运行时边界，
  又不妨碍类型引用。
- 客户端 bundle 不再意外包含服务端代码，`server-only` 的语义恢复为真。

#### 负面 / 需要持续承担

- 新增共享代码时要判断「这属于 domain 还是 server」。判据是：**是否会被 `'use client'` 运行时导入**，
  而不是「是否看起来像领域概念」。
- 边界检查是**基于路径**的静态扫描，不看 re-export 链的传递性之外的东西；绕过方式是明显的
  （`@/server` 的别名再导出），但那种绕过在评审里一眼可见。
- `size.ts` 允许依赖 `src/lib/market.ts`（domain → lib 的方向），而 `lib/market.ts` 只依赖
  `@/config` 与 `@/domain/product`，故不成环。这条依赖方向是**有意**的，不是疏忽。

## 相关

`CONTEXT.md` 的「目录层」一节 · `scripts/check-server-boundary.mjs` · `src/domain/` ·
本计划批次 3（域边界重组）
