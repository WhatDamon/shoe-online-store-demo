# 移除 Shopify 兼容购买通道 实现计划（切片 A）

> **面向 AI 代理的工作者：** 必需子技能：使用 subagent-driven-development（推荐）或 executing-plans
> 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 从本仓库彻底移除 Shopify 兼容购买通道（Buy Button 客户端面、catalog stub、`getBuyUrl` 预留接口、相关 env/门禁/文档），不引入任何 Stripe 代码。

**架构：** 纯下线动作。目录运行时来源的选择逻辑收敛为只剩 `CATALOG_SOURCE=db|seed`；`CatalogAdapter` 契约移除 `getBuyUrl`；PDP 恢复单一的「Python 变体 + 加购」路径；客户端不再有第二个购买入口。

**技术栈：** Next.js（App Router）、React、TypeScript、vitest；Node 22+。

**规格：** `docs/superpowers/specs/2026-10-13-stripe-payments-design.md`（第 10 节「Shopify 移除清单」与第 12 节切片 A）。规格是计划的论证依据，执行者两份都读。

**本计划的偏离说明：** 本仓 `AGENTS.md` 禁止在常驻文档写死源码行号，因此本计划一律用
**文件路径 + 符号名**定位，不写行号。

## 全局约束

以下来自 `AGENTS.md` 与规格，每个任务的要求都隐含包含本节：

- 技术栈版本以 `package.json` 为准，不引入新的运行时依赖。
- 不重写前台、不做无关重构：本切片只删除，不顺手改样式、改文案风格或重组目录。
- 保留历史文档：带日期的报告与 `docs/archive/` **不改写**，只在 `docs/agents/open-issues.md` 登记。
- 删除导出后必须跑 `npm run check:slop`（死导出/未用 props 的机械判据）与 `npm run check:boundary`。
- **不要在任何文档里写死测试数量或源码行号**；需要数字时当场运行命令并引用输出。
- **默认不提交 Git commit。** 本计划的 commit 步骤只在用户已明确授权提交后执行；未授权时以
  「改动完成 + 门禁全绿」作为任务终点。
- 每个任务结束时工作树必须是**可编译且门禁全绿**的，不允许留红树给下一个任务。

## 审查重点（Review Focus）

规格隐含、但容易漏测的五类输入与失败模式，按伤害程度排序。除第 5 条是操作程序（备份后改本机文件）外，其余各行都已在对应任务里安排了钉住它的测试：

1. **存量 `SHOPIFY_ENABLED=true` 的环境**（别人本机或旧部署）：删掉代码后该键必须被完全忽略，目录选择只看 `CATALOG_SOURCE`，不得因为多了一个未知 env 而改变行为或报错。
2. **存量 `CATALOG_SOURCE=shopify`**：必须静默回落为默认 `db` 行为，不得抛错、不得给出空目录。
3. **旧的 catalog API 响应缓存**：客户端可能拿着含 `storeAvailable` 字段的历史响应或旧 Service Worker 缓存，解析必须容忍多余字段而不是抛错。
4. **删除 `getBuyUrl` 时漏改的测试替身**：任何 fake adapter / mock 仍实现旧契约会导致 `check:slop` 或 typecheck 失败；必须一起清理，而不是让契约悄悄变成可选。
5. **用户本机的 `.env.local`**：它是未跟踪文件且含真实值。改它之前先备份并确认，不得因为「清理陈旧键」而丢掉其他键。

---

### 任务 1：下线购买通道（代码面）

**文件：**
- 删除：`src/server/catalog/shopify-buy.ts`、`src/server/catalog/shopify-buy.test.ts`
- 删除：`src/server/catalog/shopify-stub.ts`
- 删除：`src/components/shop/shopify-buy-button.tsx`、`src/components/shop/shopify-buy-button.test.tsx`
- 删除：`src/components/shop/shopify-buy-host.css`、`src/components/shop/shopify-buy-options.json`
- 修改：`src/server/catalog/adapter-contract.ts`、`src/server/catalog/adapter-contract.test.ts`
- 修改：`src/server/catalog/adapter.ts`、`src/server/catalog/seed-adapter.ts`、`src/server/catalog/db-adapter.ts`
- 创建：`src/server/catalog/adapter.test.ts`
- 修改：`src/server/catalog/service.test.ts`
- 修改：`src/app/product/[handle]/page.tsx`
- 修改：`src/components/shop/product-actions.tsx`、`src/components/shop/product-actions.test.tsx`
- 修改：`src/app/api/catalog/route.ts`、`src/app/api/catalog/route.test.ts`
- 修改：`src/components/shop/saved-pairs.tsx`、`src/components/shop/saved-pairs.test.tsx`

- [ ] **步骤 1：先把测试改成断言「不存在第二个购买入口」，确认它失败**

在 `src/components/shop/product-actions.test.tsx` 中删除 `storeLive` 相关的两个用例
（`hides demo pickers + demo buy bar when buyConfig is present`、`keeps demo UI when buyConfig is null`），
并新增一个用例，断言组件只接受现有 demo 形态：

```tsx
it('renders the demo buy bar with no store purchase channel', () => {
  render(<ProductActions product={multiColor} />)
  expect(screen.getByRole('button', { name: /add to cart/i })).toBeInTheDocument()
})
```

同时在 `src/app/api/catalog/route.test.ts` 中把 `expect(body[0].storeAvailable).toBeTypeOf('boolean')`
改为断言该字段不存在：

```ts
expect(body[0]).not.toHaveProperty('storeAvailable')
```

在 `src/components/shop/saved-pairs.test.tsx` 中把 `stubFetch([{ ...seedRow, storeAvailable: true }])`
那个用例改为**保留该字段**（模拟浏览器缓存里的历史响应），断言组件既不渲染 `· On the store`
标记也不抛错（钉住审查重点 3）。

创建 `src/server/catalog/adapter.test.ts`。`catalog()` 在首次调用时缓存实例，所以改变来源选择
必须先 `vi.resetModules()` 再动态导入：

```ts
it('falls back to the db adapter for a stale CATALOG_SOURCE value', async () => {
  vi.stubEnv('CATALOG_SOURCE', 'shopify')
  vi.resetModules()
  const { catalog } = await import('./adapter')
  expect(catalog().constructor.name).toBe('DbCatalogAdapter')
})
it('still selects the seed adapter for CATALOG_SOURCE=seed', async () => {
  vi.stubEnv('CATALOG_SOURCE', 'seed')
  vi.resetModules()
  const { catalog } = await import('./adapter')
  const { seedAdapter } = await import('./seed-adapter')
  expect(catalog()).toBe(seedAdapter)
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run src/components/shop/product-actions.test.tsx src/app/api/catalog/route.test.ts`
预期：FAIL。`product-actions.test.tsx` 因 `buyConfig`/`buyUrl` 变为必填或未知属性而报 TS 错误；
`route.test.ts` 因 `storeAvailable` 仍存在而断言失败。

- [ ] **步骤 3：删除文件并收紧契约**

删除步骤 1 列出的全部 `shopify-*` 文件。

在 `src/server/catalog/adapter-contract.ts` 中从 `CatalogAdapter` 接口移除 `getBuyUrl`。
在 `src/server/catalog/adapter-contract.test.ts` 中删除 fake adapter 的 `getBuyUrl` 实现。
在 `src/server/catalog/seed-adapter.ts` 与 `db-adapter.ts` 中删除 `getBuyUrl` 方法。
在 `src/server/catalog/service.test.ts` 中删除 `getBuyUrl null when no store configured` 用例。

在 `src/server/catalog/adapter.ts` 中删除 `shopifyEnabled()` 分支与 `shopifyStub` 导入，
来源选择只按 `CATALOG_SOURCE`（`seed` → seedAdapter，其余 → dbAdapter）。

- [ ] **步骤 4：改调用点，恢复单一购买路径**

在 `src/app/product/[handle]/page.tsx` 中删除 `shopifyBuyConfigFor` 导入、`buyConfig` 变量、
`catalog().getBuyUrl(product)` 调用（连同 `Promise.all` 的对应项）、以及 `buyConfig == null` 的
价格隐藏分支；`ProductActions` 只传 `product`。

在 `src/components/shop/product-actions.tsx` 中删除 `buyUrl` 与 `buyConfig` 两个 props、
`storeLive` 变量、`ShopifyBuyButton` 导入与渲染分支，以及那段「已明文延后的商店直购通道」注释。
组件签名收敛为只接收 `product` 与 `children`。

在 `src/app/api/catalog/route.ts` 中删除 `shopifyBuyConfigFor` 导入、`storeAvailable` 字段与
相关的注释；在 `src/components/shop/saved-pairs.tsx` 中删除 `· On the store` 标记；
在 `src/components/shop/saved-pairs.test.tsx` 中从 `seedRow` 夹具里删除 `storeAvailable` 字段声明，
并保留步骤 1 改写的那个「历史响应仍带该字段」用例。

- [ ] **步骤 5：运行测试与门禁验证通过**

运行：`npm run typecheck && npm run check:boundary && npm run check:coupling && npm run check:slop && npm run test`
预期：全部通过。`check:slop` 报告 0 项阻塞（若报死导出，说明还有 `getBuyUrl` 或组件残留）。

运行：`grep -rn -i shopify src scripts` 预期：无输出。

- [ ] **步骤 6：Commit（仅在已获提交授权时执行）**

```bash
git add -A src
git commit -m "refactor(catalog): remove Shopify compatibility purchase channel"
```

---

### 任务 2：移除配置、门禁与 secrets 面

**文件：**
- 修改：`scripts/preflight.mjs`、`scripts/preflight.test.ts`
- 修改：`.env.example`
- 修改：`.env.local`（本地未跟踪文件，见步骤 3 的安全要求）
- 修改：`.gitleaks.toml`

- [ ] **步骤 1：写失败的测试**

在 `scripts/preflight.test.ts` 中删除 `SHOPIFY_ENABLED` 相关的两个用例
（`SHOPIFY_ENABLED=false` 的通过用例、以及循环断言 `failures.join('\n')` 包含 `SHOPIFY_ENABLED`
的用例），并从 `evaluatePreflight` 的入参里去掉该键。新增一条断言：未知的 `SHOPIFY_*` 键
**不产生任何失败项**（钉住审查重点 1）：

```ts
it('ignores stale SHOPIFY_* keys', () => {
  const failures = evaluatePreflight(
    { SHOPIFY_ENABLED: 'true', SHOPIFY_BUY_TOKEN: 'x' },
    'development',
  )
  expect(failures).toEqual([])
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run scripts/preflight.test.ts`
预期：FAIL —— `SHOPIFY_ENABLED=true` 仍触发那条 `outside this MVP` 失败项。

- [ ] **步骤 3：删除门禁规则并清理 env 模板**

在 `scripts/preflight.mjs` 的 `evaluatePreflight` 中删除 `SHOPIFY_ENABLED` 检查块与其文案。

在 `.env.example` 中删除 `SHOPIFY_ENABLED` / `SHOPIFY_DOMAIN` / `SHOPIFY_STOREFRONT_TOKEN` /
`SHOPIFY_BUY_DOMAIN` / `SHOPIFY_BUY_TOKEN` / `SHOPIFY_BUY_MONEY_FORMAT` 段落，并把
`CATALOG_SOURCE` 的说明改为只描述 `db`（默认）与 `seed`（测试/兜底）。

在 `.gitleaks.toml` 中改写注释：删除「a public Shopify storefront token」这一理由，但
**保留 `\.env\.local$` 的 allowlist 与「该文件被 .gitignore 覆盖、不会进仓库」的说明**
（根 `.env` 的 allowlist 扩展属于切片 C，不要在这里做）。

改 `.env.local` 前先备份（审查重点 5）：

```bash
cp .env.local .env.local.bak
```

然后只删除 `SHOPIFY_DOMAIN` / `SHOPIFY_STOREFRONT_TOKEN` 两个键及其注释段落，
**不得改动该文件里的其它任何键**。完成后用 `git check-ignore -v .env.local` 确认它仍被忽略，
并提示用户 `.env.local.bak` 可自行删除。

- [ ] **步骤 4：运行测试与门禁验证通过**

运行：`npx vitest run scripts/preflight.test.ts && npm run check:slop && npm run verify`
预期：全部通过；`npm run preflight` 在 development 下不报 Shopify 相关失败。
运行：`grep -rn -i shopify .env.example .gitleaks.toml scripts` 预期：无输出。

- [ ] **步骤 5：Commit（仅在已获提交授权时执行）**

```bash
git add scripts/preflight.mjs scripts/preflight.test.ts .env.example .gitleaks.toml
git commit -m "chore(config): drop Shopify env keys and preflight rule"
```

---

### 任务 3：常驻文档与文档登记

**文件：**
- 修改：`AGENTS.md`、`CONTEXT.md`、`README.md`、`backend/README.md`
- 修改：`docs/agents/quality-bar.md`、`docs/agents/open-issues.md`
- 删除：`docs/shopify-store-setup.md`

- [ ] **步骤 1：删除专文并登记差异**

删除 `docs/shopify-store-setup.md`。

在 `docs/agents/open-issues.md` 中新增一条已完成的差异记录：Shopify 兼容购买通道已按
`docs/superpowers/specs/2026-10-13-stripe-payments-design.md` 第 10 节移除；
`CATALOG_SOURCE` 不再有 `shopify` 取值；存量 `SHOPIFY_*` env 被忽略；`getBuyUrl` 已从适配器
契约移除。写明复核方式（`grep -rn -i shopify src scripts` 应无输出），**不写测试数量**。

- [ ] **步骤 2：更新边界与词汇文档**

`AGENTS.md`：删除第 1 节中「**Shopify 只保留兼容入口且默认关闭**」那一段（含「关闭时 Shopify
不得成为购买入口」）；删除第 4 节里「`SHOPIFY_ENABLED=false` 时 Shopify 不得成为购买入口」
这半句，保留该条其余关于「不要把内部 Python 地址写死到浏览器」的要求。

`CONTEXT.md`：把适配器实现列举改为两种（`DbCatalogAdapter` 默认、`SeedAdapter` 测试用），
删除 `getBuyUrl` 恒为 `null` 的那一条不变量，并把「真实购买通道是独立的 Buy Button」整段删除。

- [ ] **步骤 3：更新 README 与质量要求**

`README.md`：删除 env 表中的 `SHOPIFY_ENABLED` / `SHOPIFY_DOMAIN, SHOPIFY_STOREFRONT_TOKEN` /
`SHOPIFY_BUY_DOMAIN, SHOPIFY_BUY_TOKEN` 三行；把 `CATALOG_SOURCE` 行改为只描述 `db` 与 `seed`；
删除「Shopify remains a compatibility path and requires explicit…」段与「Store buy channel
(2026-09)」整节；更新目录树注释里 `catalog/` 那行的「+ Shopify Buy map」字样；
把「keep `SHOPIFY_ENABLED=false`, set …」这句启动指引改为不引用 Shopify。

`backend/README.md`：把「No real payment, Shopify sync, external webhook, login, refunds,
logistics or queue.」这句中的 `Shopify sync` 与 `external webhook` 去掉，保留其余未实现项
（本切片不引入支付与 webhook，二者是切片 B 的内容）。

`docs/agents/quality-bar.md`：从 TypeScript 最低覆盖清单里删除「Shopify 默认关闭」这一项。

- [ ] **步骤 4：验证无残留引用**

运行：`grep -rn -i shopify AGENTS.md CONTEXT.md README.md backend/README.md docs/agents`
预期：无输出（`docs/agents` 下若 `open-issues.md` 的差异记录含该词，则允许该条命中）。

运行：`npm run verify` 预期：通过（文档改动不应影响门禁，此步用于确认没有误改被工具读取的文件）。

- [ ] **步骤 5：Commit（仅在已获提交授权时执行）**

```bash
git add -A AGENTS.md CONTEXT.md README.md backend/README.md docs
git commit -m "docs: remove Shopify purchase channel references"
```
