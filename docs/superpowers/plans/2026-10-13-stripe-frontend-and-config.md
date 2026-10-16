# Stripe 前端闭环、配置收口与文档 实现计划（切片 C）

> **面向 AI 代理的工作者：** 必需子技能：使用 subagent-driven-development（推荐）或 executing-plans
> 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在 Next 侧接上支付入口与 webhook 验签转发，放宽 TS 领域契约，更新支付相关文案与政策口径，并把 Stripe 相关配置、门禁与决策文档一次收口。

**架构：** Next 只做展示、代理与验签转发，不持有 `STRIPE_SECRET_KEY`、不碰数据库。前端拿到 `payments/session` 的 `redirect_url` 后跳转 Stripe 托管结账；返回页**只读真值**，查询参数仅控制提示横幅。共享契约类型放在 `src/domain/`。

**技术栈：** Next.js（App Router）、React、TypeScript、vitest、`stripe` npm 包（仅服务端路由用于验签）、`src/config.ts` 的 env 门面。

**规格：** `docs/superpowers/specs/2026-10-13-stripe-payments-design.md`（第 6.2、7.4、8、9、13 节）。规格是计划的论证依据，执行者两份都读。

**前置：** 切片 A（`2026-10-13-remove-shopify.md`）与切片 B（`2026-10-13-stripe-backend-payment-boundary.md`）已完成。

**本计划的偏离说明：** `AGENTS.md` 禁止在常驻文档写死源码行号，故本计划用**文件路径 + 符号名**定位。

## 全局约束

- Client Component **不得运行时导入 `src/server/**`**（`npm run check:boundary` 会拦）；共享类型放 `src/domain/`。
- `src/domain/**` 不得依赖 `src/server|db|app|components`（`npm run check:coupling` 会拦）。
- 新增 env 读取一律走 `src/config.ts` 的 `envStr`/`envFlag` 门面（缺失/空串/纯空白视为未设置），**不要裸读 `process.env`**。
- API 代理必须正确传递方法、状态码、内容类型、Cookie/会话与安全错误；不把内部堆栈或数据库连接信息返回浏览器。
- 不在没有证据时承诺支付结果；文案不得声称已付款而真值未付款。
- **默认不提交 Git commit。** commit 步骤只在用户已明确授权后执行。
- 每个任务结束时 `npm run verify` 必须绿。
- 不要在任何文档里写死测试数量或源码行号。

## 审查重点（Review Focus）

1. **`/orders/{id}?payment=success` 被手工伪造或书签复用**：页面必须显示真值，横幅不得声称已付款。这是最容易造成「用户以为付了、其实没付」的一条。
2. **Stripe 已启用但前端解析器仍是旧严格形态**：`payment_enabled=true` 或 `status='paid'` 必须被接受；同时**未知 status 仍必须被拒绝**（不能退化成 `string`）。
3. **浏览器缓存的旧 catalog 响应**：客户端仍可能拿到带额外字段的历史响应，解析必须容忍多余字段而不是抛错。
4. **webhook 路由被非 Stripe 来源直接 POST**：验签必须失败并返回 400，且**不得转发**给 Python。
5. **Python 侧返回非 2xx**（例如处理失败需要重投）：Next 必须把非 2xx 透传，**不能按既有惯例收敛为 `backend_unavailable`**。

---

### 任务 1：放宽 TS 领域契约

**文件：**
- 修改：`src/domain/commerce.ts`、`src/domain/commerce-response.ts`
- 创建：`src/domain/commerce-response.test.ts`

- [ ] **步骤 1：写失败的测试**

`src/domain/` 目前没有 `commerce-response.ts` 的直接测试（解析器只被组件测试间接覆盖）。本任务补上：

```ts
describe('parseOrderView', () => {
  it('accepts paid and refunded statuses', ...)
  it('accepts payment_enabled true', ...)
  it('rejects an unknown status', ...)          // 钉住审查重点 2
  it('rejects a non-boolean payment_enabled', ...)
  it('ignores unknown extra fields', ...)        // 钉住审查重点 3
})
describe('parsePaymentSessionView', () => {
  it('requires redirect_url when code is payment_ready', ...)
  it('rejects redirect_url when code is payment_disabled', ...)
  it('accepts the disabled shape returned today', ...)
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run src/domain/commerce-response.test.ts`
预期：FAIL —— `paid` 被 `parseOrderView` 拒绝，`parsePaymentSessionView` 不存在。

- [ ] **步骤 3：放宽类型与解析器**

`src/domain/commerce.ts`：

```ts
export type OrderStatus = 'pending_payment' | 'paid' | 'cancelled' | 'refunded'
export type PaymentCode = 'payment_disabled' | 'payment_ready' | 'order_not_payable' | 'currency_unsupported'

export interface OrderView extends CartView {
  // …既有字段
  status: OrderStatus
  payment_enabled: boolean
}

export interface PaymentSessionView {
  code: PaymentCode
  payment_enabled: boolean
  provider: 'mock' | 'stripe'
  order_id: string
  order_status: OrderStatus
  redirect_url: string | null
  message: string
}
```

`src/domain/commerce-response.ts`：`parseOrderView` 的 `status` 改成**白名单校验**（接受四值、
拒绝其余），`payment_enabled` 改成 `typeof === 'boolean'`，`redirect_url` 用可空字符串校验。
新增 `parsePaymentSessionView`，并加一致性约束：`code === 'payment_ready'` 时有
`redirect_url`，否则必须为 `null`。

**不要**把 `status` 退化成 `text()` —— 今天「未知值直接抛错」的防线是资产。

- [ ] **步骤 4：运行测试与门禁验证通过**

运行：`npx vitest run src/domain/commerce-response.test.ts && npm run typecheck && npm run check:coupling && npm run test`
预期：PASS

- [ ] **步骤 5：Commit（仅在已获提交授权时执行）**

```bash
git add src/domain
git commit -m "feat(domain): widen order contract and add payment session parser"
```

---

### 任务 2：代理白名单与 commerce client

**文件：**
- 修改：`src/app/api/commerce/[...path]/route.ts`、`src/app/api/commerce/[...path]/route.test.ts`
- 修改：`src/lib/commerce-client.ts`

- [ ] **步骤 1：写失败的测试**

在 `route.test.ts` 中新增：`POST orders/<uuid>/refund` 被允许；`POST orders/<uuid>/refund/extra`
被拒绝（白名单是锚定正则）；跨站来源的 refund 请求被拒绝（沿用既有同源断言写法）。

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run "src/app/api/commerce/[...path]/route.test.ts"`
预期：FAIL —— refund 路径返回 404 `not_found`。

- [ ] **步骤 3：扩展白名单与客户端**

在 `route.ts` 的 `allowed()` 中把 POST 分支扩展为
`cart/items` | `checkout/(preview|create-order)` | `orders/<uuid>/cancel` | `orders/<uuid>/refund` |
`payments/session`。**不要改动**同源校验、16 KiB 上限、生产 secret 长度检查与 20s 超时。

在 `src/lib/commerce-client.ts` 中把**异常型**错误码 `payment_not_refundable` 加入既有映射，
给一句面向用户的英文文案。`order_not_payable` 与 `currency_unsupported` 是
`payments/session` 在 HTTP 200 响应里的 `code`，**不走错误映射**，由
`parsePaymentSessionView` 的调用方按 `message` 展示（任务 1 与任务 4 已覆盖）。

- [ ] **步骤 4：运行测试与门禁验证通过**

运行：`npx vitest run "src/app/api/commerce/[...path]/route.test.ts" && npm run test` 预期：PASS

- [ ] **步骤 5：Commit（仅在已获提交授权时执行）**

```bash
git add "src/app/api/commerce" src/lib/commerce-client.ts
git commit -m "feat(proxy): allow refund route and map payment error codes"
```

---

### 任务 3：公开 webhook 路由（验签与转发）

**文件：**
- 创建：`src/app/api/webhooks/stripe/route.ts`、`src/app/api/webhooks/stripe/route.test.ts`
- 修改：`package.json`、`package-lock.json`

- [ ] **步骤 1：加入依赖**

```bash
npm install stripe
```

用官方 SDK 的 `webhooks.constructEvent` 做验签，而不是手写 HMAC：手写版本容易在容差窗口与
时间安全比较上写错，而这正是安全边界。该依赖只被这个服务端路由使用。

- [ ] **步骤 2：写失败的测试**

`route.test.ts` 用 `node:crypto` 按 Stripe 方案自造签名，覆盖：

```ts
it('rejects a request without a signature', ...)                 // 400，且未转发
it('rejects a request with a wrong signature', ...)              // 400，且未转发
it('rejects a stale timestamp outside the tolerance window', ...)
it('forwards only the minimal projection when the signature is valid', ...)
it('does not pass through raw payload fields', ...)              // 钉住审查重点 4
it('returns the upstream status so Stripe retries on failure', ...)  // 钉住审查重点 5
it('requires the internal proxy secret on the forward', ...)
```

转发用 `fetch` 打桩，断言请求体只含投影字段。

- [ ] **步骤 3：运行测试验证失败**

运行：`npx vitest run src/app/api/webhooks/stripe/route.test.ts`
预期：FAIL，模块不存在。

- [ ] **步骤 4：实现路由**

`src/app/api/webhooks/stripe/route.ts`：

- `export const runtime = 'nodejs'`、`export const dynamic = 'force-dynamic'`
- 用 `await request.text()` 取**原始 body** 后再验签（任何解析后的 body 都会破坏签名）
- 密钥经 `envStr('STRIPE_WEBHOOK_SECRET')` 读取；未配置时返回 503 而不是放行
- 验签通过后**只投影**：`id`、`type`、以及 Stripe 对象里的
  `client_reference_id`/`id`/`payment_intent`/`amount_total`/`currency`；**不透传原始载荷**，
  不记录事件内容
- 带 `X-Internal-Proxy-Secret` 与生成的 `X-Request-ID` 转发到 `${PYTHON_API_URL}/api/v1/webhooks/stripe`
- **上游状态码必须原样透传**（含 5xx），并在这段代码里注明这是刻意与 commerce 代理相反的
  重投信号；网络失败时返回 502 而不是通用不可用
- 不接入 `/api/commerce/[...path]` 代理，因此不受其同源校验约束（Stripe 是服务器到服务器调用，没有 `Origin`）

- [ ] **步骤 5：运行测试与门禁验证通过**

运行：`npx vitest run src/app/api/webhooks/stripe/route.test.ts && npm run verify`
预期：PASS（含 `check:boundary`、`check:coupling`、`check:slop`）。

- [ ] **步骤 6：Commit（仅在已获提交授权时执行）**

```bash
git add src/app/api/webhooks package.json package-lock.json
git commit -m "feat(payments): verified Stripe webhook ingress"
```

---

### 任务 4：前端支付闭环

**文件：**
- 修改：`src/components/shop/commerce-panel.tsx`、`src/components/shop/commerce-panel.test.tsx`（若不存在则创建）
- 修改：`src/app/orders/[id]/page.tsx`

- [ ] **步骤 1：写失败的测试**

```ts
it('shows a pay button only when payment is enabled and the order is pending', ...)
it('redirects to the Stripe url returned by the session', ...)          // window.location.assign 打桩
it('does not show a pay button when payment is disabled', ...)
it('never claims the order is paid from the success query parameter', ...)  // 钉住审查重点 1
it('shows the refunded state for a refunded order', ...)
it('shows a refund-in-progress notice for a refunded order', ...)
```

`never claims the order is paid from the success query parameter` 是本任务的核心：以
`paymentNotice='success'` 渲染、而回读到的订单仍是 `pending_payment`，断言页面上**不出现**
任何表示已付款的文案，只出现中性提示。

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run src/components/shop/commerce-panel.test.tsx`
预期：FAIL，无 Pay 按钮、无横幅。

- [ ] **步骤 3：实现闭环**

`src/components/shop/commerce-panel.tsx`：
- 新增 props：`paymentNotice?: 'success' | 'cancelled' | null`
- `order.status === 'pending_payment' && order.payment_enabled` 时渲染 `Pay now` 按钮；
  点击后 `commerceRequest('payments/session', parsePaymentSessionView, { method: 'POST', body: JSON.stringify({ order_id: order.id }) })`，
  `code === 'payment_ready'` 且 `redirect_url` 非空时 `window.location.assign(redirect_url)`，
  否则把 `message` 显示为提示
- 状态展示扩展：`paid` / `refunded` / 退款中；`payment_enabled === false` 时保留今天的
  「支付未开放」提示与自动释放入口

`src/app/orders/[id]/page.tsx`：接收 `searchParams`，把 `payment` 归一化为
`'success' | 'cancelled' | null` 后作为 `paymentNotice` 传入。**页面始终通过
`GET /api/commerce/orders/{id}` 回读真值**，查询参数只影响横幅。

- [ ] **步骤 4：运行测试与门禁验证通过**

运行：`npm run verify && npm run build`
预期：PASS（Route Handler 与 metadata 未改动，`build` 用于确认没有把服务端依赖带进客户端包）。

- [ ] **步骤 5：Commit（仅在已获提交授权时执行）**

```bash
git add src/components/shop/commerce-panel.tsx src/app/orders
git commit -m "feat(checkout): pay button and truth-reading return notice"
```

---

### 任务 5：文案与政策口径

**文件：**
- 修改：`src/lib/store-policy.ts`
- 修改：`src/components/shop/commerce-panel.tsx`
- 修改：`backend/app/application/commerce.py`（`order_view` 的 `message`）

- [ ] **步骤 1：写失败的测试**

在 `src/lib/store-policy.test.ts`（若不存在则创建）中：断言 `POLICY_RETURNS` 含「付款后未发货
可取消退款」这一例外，且 `STORE_POLICY_FACTS` 包含它。在 `commerce-panel.test.tsx` 中断言
`payment_enabled === false` 时仍显示「支付未开放」文案。

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run src/lib/store-policy.test.ts` 预期：FAIL

- [ ] **步骤 3：改文案与政策**

`src/lib/store-policy.ts` 的 `POLICY_RETURNS` 补上退款例外（定制印刷缺货/未发货时可按申请退款，
或客户在付款后未发货前可取消退款），措辞与 `POLICY_CARE` 的既有不可退条款保持一致，不出现
自相矛盾的两句话。改这一处会同时生效于 AI 客服与 PDP 手风琴（两处共用该常量）。

`src/components/shop/commerce-panel.tsx`：把无条件的「Payments are not available yet.」改为按
`payment_enabled` 分支；已付款/已退款订单给出对应的中性说明。

`backend/app/application/commerce.py` 的 `order_view` 中，`message` 不再硬编码
「Payments are not available yet.」：改为按 `settings.stripe_ready` 与订单状态给出对应文案，
关闭支付时仍返回同一句话以保持既有测试断言语义。

- [ ] **步骤 4：运行两侧门禁验证通过**

运行：`npm run verify && npm run verify:python` 预期：PASS

- [ ] **步骤 5：Commit（仅在已获提交授权时执行）**

```bash
git add src/lib/store-policy.ts src/components/shop/commerce-panel.tsx backend/app/application/commerce.py
git commit -m "docs(policy): align payment and refund wording with Stripe"
```

---

### 任务 6：配置、门禁与 secrets 收口

**文件：**
- 修改：`scripts/preflight.mjs`、`scripts/preflight.test.ts`
- 修改：`.env.example`、`.gitleaks.toml`、`README.md`

- [ ] **步骤 1：写失败的测试**

```ts
it('fails when Stripe is enabled without a secret key', ...)          // 半配置
it('fails when Stripe is enabled without a webhook secret in production', ...)
it('fails when Stripe is enabled with a relative public site url', ...)
it('passes with Stripe disabled and no Stripe keys', ...)
it('allows the root .env to be scanned away', ...)                     // 见步骤 3
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run scripts/preflight.test.ts` 预期：FAIL，Stripe 相关检查不存在。

- [ ] **步骤 3：实现检查与配置收口**

`scripts/preflight.mjs`：新增 `STRIPE_ENABLED=true` 时的必需项检查（`STRIPE_SECRET_KEY`、
生产环境下的 `STRIPE_WEBHOOK_SECRET`、`PUBLIC_SITE_URL` 必须是绝对 https）。**半配置必须失败**
——只填一个密钥比不填更危险，它会让人以为支付已开。

`.env.example`：新增 Stripe 段落（`STRIPE_ENABLED`、`STRIPE_SECRET_KEY`、
`STRIPE_WEBHOOK_SECRET`、`PUBLIC_SITE_URL`），并注明根 `.env` 是单一真源、`backend/.env` 仅作本地覆盖。

`.gitleaks.toml`：把 allowlist 从 `\.env\.local$` 扩展为同时覆盖根 `.env`（根 `.env` 已被
`.gitignore` 的 `.env*` 与显式 `.env` 覆盖，不进仓库；但 secrets 扫描只放行了 `.env.local`，
真密钥写进根 `.env` 会被反复报为阻塞项）。

`README.md`：env 表新增上述四行；启动步骤改为「复制根 `.env.example` 为根 `.env`」并说明
Python 也读同一个文件。

- [ ] **步骤 4：运行门禁验证通过**

运行：`npx vitest run scripts/preflight.test.ts && npm run check:slop && npm run preflight -- --environment production`
预期：PASS（生产预检在缺少必需项时报明确失败，在配置齐备时通过）。

- [ ] **步骤 5：Commit（仅在已获提交授权时执行）**

```bash
git add scripts/preflight.mjs scripts/preflight.test.ts .env.example .gitleaks.toml README.md
git commit -m "chore(config): preflight checks and single-source env for Stripe"
```

---

### 任务 7：决策记录与常驻文档同步

**文件：**
- 创建：`docs/adr/0008-payment-channel.md`
- 修改：`AGENTS.md`、`docs/agents/quality-bar.md`、`docs/agents/commerce-contract.md`、`docs/agents/open-issues.md`、`CONTEXT.md`、`backend/README.md`

- [ ] **步骤 1：写 ADR**

创建 `docs/adr/0008-payment-channel.md`，按既有 ADR 格式（状态 / 日期 / 背景 / 决策 / 后果），
记录规格第 3 节的四项决策与理由：Stripe 密钥只在 Python、托管 Checkout、根 `.env` 单一真源、
自动退款 API；并记录本文档同时取代了 Shopify 兼容购买通道（指向切片 A 的计划）。
`docs/adr/` 下的历史 ADR **不修改**，新决策用新 ADR 表达。

- [ ] **步骤 2：改边界条款**

`AGENTS.md` 第 1 节把「本 MVP 不接入真实支付。**只能使用** `MockPaymentProvider`：不得扣款、
不得把订单改为 `paid`，支付接口必须返回明确的『支付暂未开放』结果」改写为默认关闭语义：
仅当 `STRIPE_ENABLED=true` 且密钥齐备时启用；**未启用时不得扣款、不得把订单改为 `paid`，
支付接口必须返回明确的『支付暂未开放』结果**。原护栏降级为「未启用路径的守护要求」，
而不是删除。

`docs/agents/quality-bar.md`：把「Mock 支付不变更为 paid」改写为「未启用支付时不得变更为
`paid`」，并补入规格 11.2 要求的覆盖面（webhook 验签与重复投递、付款晚于释放的竞态、
重复退款幂等、未知状态的契约拒绝）。

`docs/agents/commerce-contract.md`：同步三条状态轴与 5 条不变量、新端点
（`payments/session` 新形态、`orders/{id}/refund`、`webhooks/stripe`）、幂等键策略与
「释放路径唯一」的约束。

`docs/agents/open-issues.md`：登记「支付真值边界变更：由 Mock 改为 Stripe（默认关闭）」
与「响应契约放宽」，写明复核方式，不写测试数量。

- [ ] **步骤 3：更新词汇与后端说明**

`CONTEXT.md`：新增履约/资金/预占三轴的区分，以及「支付通道」与「可付窗口」两个词的定义；
说明 `payment_enabled` 表达的是部署级能力，不是单个订单的可付状态。
`backend/README.md`：把「No real payment … external webhook … refunds …」这句更新为：默认关闭
的 Stripe 支付、webhook 与退款已实现，仍未实现的是登录、物流与队列。

- [ ] **步骤 4：验证文档与门禁**

运行：`grep -rn -i "只能使用 MockPaymentProvider" AGENTS.md docs` 预期：无输出
运行：`npm run verify && npm run verify:python` 预期：PASS

- [ ] **步骤 5：Commit（仅在已获提交授权时执行）**

```bash
git add docs AGENTS.md CONTEXT.md backend/README.md
git commit -m "docs: record payment channel decision and sync contracts"
```

---

## 上线复测（人工验收，无自动化测试）

规格 11.3 要求的上线前复测无法写成单元测试，实现完成后逐条执行并记录实际观察结果：

1. **测试模式闭环**：用 Stripe 测试密钥与测试卡走完「创建订单 → 跳转托管结账 → 付款 → 回到
   `/orders/{id}`」。核对页显状态为已付款，且 `orders` / `payments` / `inventory_reservations`
   三表的状态组合满足规格第 4 节的五条不变量。
2. **重放**：用 Stripe CLI 或控制台重放同一 `checkout.session.completed` 事件，确认只有一次
   状态变更，且 `webhook_events` 里有且只有一行。
3. **付款晚于释放**：手工把订单 TTL 调短（例如 `RESERVATION_TTL_SECONDS` 设到最小），在过期
   释放后再触发 `checkout.session.completed`，确认资金进入 `refund_pending`、订单不可发货、
   退款补偿命令能把它推到 `refunded`。
4. **未启用回归**：清掉 Stripe 密钥重启，确认全站行为与迁移前一致，订单不可能变成已付款。
5. **伪造返回地址**：直接访问 `/orders/{id}?payment=success`（未付款订单），确认页面只显示
   中性提示、不声称已付款。

> 上述复测需要真实 Stripe 测试账户，本地无法离线完成；未执行时必须在交付报告里明确写「未执行」
> 与原因，不得把它当成已通过的证据。
