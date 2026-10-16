# 支付通道迁移：移除 Shopify，接入 Stripe — 设计规格

> **日期：** 2026-10-13 · **状态：** 待用户审阅 · **分支：** `feat/stripe-payments`
> **关联：** `docs/adr/0008-payment-channel.md`（随切片 C 与代码同提交编写）、
> `docs/agents/commerce-contract.md`、`docs/agents/quality-bar.md`、`docs/agents/open-issues.md`
> **性质：** 本文是**设计规格**，描述将要实现的行为与契约，不是现状报告。凡涉及代码现状的陈述，
> 都应以当场复核为准；复核方式见 `docs/agents/verification.md`。

## 1. 目标与成功标准

让 Stripe 支付在配置齐备后可用，并让未配置时的行为与今天逐字一致。

**成功标准**

1. 完成本文全部数据迁移与契约变更后，写入一份根目录 `.env`（含 Stripe 密钥）即可完成
   「创建订单 → 跳转 Stripe 托管结账 → 付款 → 订单变为 `paid`」的完整闭环，无需改代码。
2. 未设置 `STRIPE_ENABLED=true` 或密钥不齐时，全站行为与迁移前一致：`payments/session`
   返回机器可读的「支付未启用」，订单**不可能**变为 `paid`，库存释放逻辑不变。
3. Shopify 相关代码、配置、环境变量与文档全部移除，且不留下任何「第二购买通道」的死接口。
4. 订单状态、资金状态、库存预占三者在任何并发与失败路径下保持一致；不存在
   「已扣款但库存被释放」或「已释放但状态显示已售」的静默状态。
5. `npm run verify` 与 `npm run verify:python` 全绿；生产 preflight 能识别 Stripe 的半配置。

## 2. 非目标

以下内容明确不在本次范围，写在这里是为了避免实现时顺手扩张：

- 多币种结算。`SITE_MARKET` 表达的是展示市场，不改变结算币种。
- 订阅、分期、发票、税务与运费计算。订单总额仍只由商品行构成。
- Stripe Elements / Embedded Checkout。只做托管 Checkout + 跳转，站内不出现任何卡号表单。
- 客户账号体系。所有权仍由匿名会话 cookie 承担。
- 商品/库存/订单向 Stripe 的双向同步。Stripe 只承载一次付款动作。
- 邮件与通知。收据由 Stripe 发送。
- 发货与物流状态机。`paid` 之后不再细分履约状态。

## 3. 已确认决策

| # | 决策 | 被否决的选项与理由 |
| --- | --- | --- |
| D1 | Stripe SDK 与密钥**只存在于 Python 侧**（`backend/`） | 否决「Next 持有密钥」：与「Python 是价格、库存、订单、支付状态真值」的既有边界冲突，且把支付密钥扩散到第二个服务。否决「Python 直接暴露公网 webhook」：与现有 preflight 的「生产不得指向 loopback」规则组合后会引入一个新的公网入口，本次不解决该拓扑 |
| D2 | 结账形态为 **Stripe 托管 Checkout + 跳转** | 否决 Elements/Embedded：需要站内处理支付元素，PCI 面与前端状态机复杂度都显著上升，本 MVP 无收益 |
| D3 | 根目录 `.env` 成为**单一真源**，Python 也读它 | 否决「维持两套 env 只补文档」：`backend/.env` 目前不存在，且两套 env 是「写完 `.env` 就能用」这个目标的最大落差来源 |
| D4 | **自动退款 API**：提供 `POST /api/v1/orders/{id}/refund`，调用 Stripe Refund | 否决「仅人工处理」：`POLICY_RETURNS` 是 AI 客服与 PDP 共用的公开承诺，接真支付后必须可执行 |
| D5 | 移除 Shopify 与拆除 `getBuyUrl` 死接口**单独作为一个可回滚切片**先行 | 该切片不依赖任何 Stripe 决策，风险最低，可独立验证 |

## 4. 真值边界与三条正交状态轴

**真值归属不变：** 价格、可售变体、库存、购物车、订单、支付状态的真值全部在 `backend/`。
Next 侧继续只做展示、代理与 AI。Stripe 是支付通道，不是真值来源；任何 Stripe 回调都必须
在 Python 侧被重新验证后才允许改变本地状态。

**本次最重要的结构性决定：不要把「钱」塞进 `orders.status`。**
当前 `orders` 一张表同时表达履约与支付，导致「已付款但订单已过期」无处安放。改为三条正交轴：

| 轴 | 载体 | 取值 |
| --- | --- | --- |
| 履约生命周期 | `orders.status` | `pending_payment` \| `paid` \| `cancelled` \| `refunded` |
| 资金状态 | `payments.status` | `disabled`（历史遗留，见 5.1）\| `requires_payment` \| `succeeded` \| `refund_pending` \| `refunded` |
| 库存预占 | `inventory_reservations.status` | `active` \| `consumed` \| `released` |

**不变量（必须可测试、可监控）**

1. `orders.status='paid'` ⇒ 存在 `payments.status='succeeded'` 记录，且该订单所有预占为 `consumed`。
2. `orders.status='cancelled'` ∧ 存在 `payments.status='succeeded'` ⇒ 资金状态必须转为
   `refund_pending` 或 `refunded`。**这是「需要退款的订单」这个信号的唯一来源**，因此不需要
   第 5 个订单状态。
3. `payments.status='succeeded'` ⇒ 该订单库存已从 `available` 真实扣减，绝不能被还回 `available`。
4. `orders.status='refunded'` ⇒ 资金状态为 `refunded`。
5. 同一订单最多一条 `payments` 行（现有唯一约束保持）。

> **更正（实现期发现，见 ADR 0008）。** 第 1 条的原文表述过强：资金轴单行无法同时为 `succeeded` 与
> `refund_pending`，而「退款处理中」是合法的已捕获状态。修正后的口径为：
> `orders.status='paid'` ⇒ 资金**已被捕获**，即 `payments.status ∈ {succeeded, refund_pending, refunded}`，
> 且该订单所有预占为 `consumed`。这也意味着「已付 + `refund_pending`」是**合法组合**，
> 客户端需要能读到资金轴才能区分「普通已付」与「已付但欠退款」。常驻契约见
> `docs/agents/commerce-contract.md` 的「三条状态轴与不变量」。
> 另：第 5 条已由现有唯一约束保证；第 2 条在实现中扩展为「资金为已结算即需退款记录」。

## 5. 数据模型与迁移

一次 Alembic 迁移完成，**只放宽约束与新增可空列，不改写既有数据**。

### 5.1 放宽 CheckConstraint

| 表 | 新约束 |
| --- | --- |
| `orders` | `status IN ('pending_payment','paid','cancelled','refunded')` |
| `payments` | `status IN ('disabled','requires_payment','succeeded','refund_pending','refunded')` |
| `inventory_reservations` | `status IN ('active','consumed','released')` |

`orders` 现有 `ix_orders_status_expires_at` 与 `total >= 0` 保持不变。

**`payments` 必须保留 `'disabled'` 这个合法取值。** 已存在的历史行写在支付未启用时期，
取值就是 `'disabled'`。若新约束不包含它，迁移会在有数据的库上直接失败；唯一的替代是改写或
删除这些行，而两者都不允许。保留它是零数据改写的唯一解，也顺带把「曾经尝试支付但支付未启用」
这个事实留在了数据里。

`payments.provider` 的列默认值保持 `'mock'` 不动，代码在两条路径上都显式写入 `'mock'` 或
`'stripe'`；默认值只作兜底，不再承载语义。

SQLite 无法原地改约束，迁移必须使用 batch 模式（`render_as_batch`），且在同一个迁移里验证
SQLite 与 PostgreSQL 双方言。downgrade 在检测到新状态行时**报错而不是删除数据**。

### 5.2 `payments` 新增列（全部可空）

| 列 | 类型 | 用途 |
| --- | --- | --- |
| `provider_reference` | `String(200)`，唯一索引 | Stripe Checkout Session id；webhook 反查与幂等复用 |
| `payment_intent` | `String(200)` | 退款调用所需的 PaymentIntent id |
| `amount` | `Numeric(12,2)` | 创建会话时冻结的金额，用于对账 |
| `currency` | `String(3)` | 创建会话时的币种 |
| `created_at` / `succeeded_at` / `refunded_at` | `DateTime(timezone=True)` | 时间线 |

### 5.3 `orders` 新增列

| 列 | 类型 | 用途 |
| --- | --- | --- |
| `paid_at` | `DateTime(timezone=True)`，可空 | 支付确认时间 |
| `refunded_at` | `DateTime(timezone=True)`，可空 | 退款完成时间 |

`orders.expires_at` 在转为 `paid` 时置 `NULL`（预占不再有期限）。

### 5.4 `webhook_events` 新增列

现有 `UniqueConstraint(provider, external_id)` 是幂等的基础，但只有唯一约束不够：处理失败后
重试会被当成「重复投递」而丢单。因此补上处理状态。

| 列 | 类型 | 用途 |
| --- | --- | --- |
| `status` | `String(20)`，默认 `'received'` | `received` \| `processed` \| `failed` \| `ignored` |
| `attempts` | `Integer`，默认 0 | 重试计数 |
| `received_at` / `processed_at` | `DateTime(timezone=True)` | 时间线 |

新增的非空列必须带**数据库级默认值**（`server_default`），否则在有数据的表上迁移会因现有行
无法满足非空约束而失败。

`payload` 保持 `JSON`（双方言同构是既有规范）。**写入前必须裁剪载荷**，只保留事件 id、类型、
金额与币种、以及 Stripe 对象 id；丢弃付款方式摘要、邮箱、账单地址等个人数据。

### 5.5 状态常量单点定义

在 `backend/app/domain/` 下新增状态常量模块，`models.py` 的 `CheckConstraint`、`responses.py`
的 `Literal`、以及迁移文件共同引用它。目的是消除「改了 Literal 忘了约束」这类重复事故。

## 6. 接口契约

### 6.1 Python 侧

**`POST /api/v1/payments/session`（语义扩展，路径不变）**

请求体保持 `{order_id}`。响应新形态：

```
code:          'payment_disabled' | 'payment_ready' | 'order_not_payable' | 'currency_unsupported'
payment_enabled: bool
provider:      'mock' | 'stripe'
order_id:      str
order_status:  OrderStatus
redirect_url:  str | None
message:       str
```

变更说明：

- `provider` 从 `Literal['mock']` 放宽为 `'mock' | 'stripe'`。
- 新增 `redirect_url`：仅 `code='payment_ready'` 时非空。
- **移除 `charged` 字段。** 在创建会话这一刻它恒为 `False`，不承载任何信息；「是否已扣款」
  由订单的 `status` 与资金状态表达，客户端不需要第二个来源。移除它是为了避免出现
  「会话创建成功但 `charged=false`」这种容易被误读为「没付款」的字段。
- `order_not_payable` 覆盖：订单不属于当前会话、已过期、已 `paid`、已 `cancelled`、已 `refunded`。
- Stripe 未启用时行为与今天一致：`code='payment_disabled'`、`payment_enabled=false`、HTTP 200。

**`POST /api/v1/orders/{id}/refund`（新增）**

- 所有权校验与 `cancel` 一致（订单必须属于当前会话），否则 404。
- 仅允许 `status='paid'` 且未发货的订单。
- 幂等：已是 `refunded` 直接返回当前视图；已是 `refund_pending` 不重复调用 Stripe。
- 调用 Stripe 时携带由订单 id 派生的幂等键。
- Stripe 调用失败 → 资金状态置 `refund_pending`，返回明确的业务错误码，不返回 5xx 掩盖原因。

**`POST /api/v1/webhooks/stripe`（新增）**

- 与其余 `/api/v1/*` 同样受 `internal_proxy` 保护（`X-Internal-Proxy-Secret`），因为它只接受
  本仓 Next 服务的转发，不直接面向 Stripe。
- 请求体为 Next 侧转发过来的已验签事件的最小投影（事件 id、类型、关键字段），不是原始 Stripe
  载荷的透传。Python 侧据此变更本地状态。
- **处理失败必须返回非 2xx**，以便 Next 侧返回非 2xx 让 Stripe 重投；这是全仓唯一一处
  「不把 5xx 收敛为 `backend_unavailable`」的接口。
- `GET /health` 的 `payment_enabled` 从 `Literal[False]` 改为 `bool`，值来自同一配置源。
- `OrderResponse.status` 放宽为新 `OrderStatus`；`payment_enabled` 放宽为 `bool`。

### 6.2 Next 侧

**新增公开路由 `src/app/api/webhooks/stripe/route.ts`**

- `export const runtime = 'nodejs'`。
- **用 `await request.text()` 取原始 body 做签名验证。** 任何经框架解析后的 body 都会破坏签名。
- 只持有 `STRIPE_WEBHOOK_SECRET`（验签与投影），**不持有 `STRIPE_SECRET_KEY`**。
- 验签失败 → 400，不转发、不落库。
- 验签通过 → 投影出最小字段集，带 `X-Internal-Proxy-Secret` 转发到 Python 的
  `POST /api/v1/webhooks/stripe`。
- 转发失败或 Python 返回非 2xx → **返回非 2xx**，并在代码中显式注释这是刻意的重试信号。
- 不接入 `/api/commerce/[...path]` 代理，因此该代理的路径白名单、同源校验与 16 KiB body
  上限都不适用于此路由。Stripe 是服务器到服务器调用，没有 `Origin`。

**`/api/commerce/[...path]` 代理**

`payments/session` 已在白名单内，无需改动。`orders/{id}/refund` 需要新增到 POST 白名单。
`orders/{id}` 的 GET 已在白名单内。

**返回地址**

- `success_url` = `{PUBLIC_SITE_URL}/orders/{id}?payment=success`
- `cancel_url` = `{PUBLIC_SITE_URL}/orders/{id}?payment=cancelled`

复用既有 `/orders/[id]` 页面，不新增成功页路由。查询参数**只控制提示横幅，不参与状态判定**：
页面始终用 `GET /api/commerce/orders/{id}` 回读真值。Stripe 的 `success_url` 可被用户手工访问，
不能作为「已付款」的证据。

**TS 领域类型（`src/domain/`）**

- `OrderView.status` 放宽为四值联合；`payment_enabled` 改为 `boolean`。
- `parseOrderView` 同步放宽，**但对未知 `status` 仍必须拒绝**。不能退化为 `string` 校验，
  今天这道「未知值直接抛错」的防线是资产。
- 新增 `PaymentSessionView` 与对应解析器（当前 TS 侧完全没有解析 `payments/session` 响应的代码）。

## 7. 关键流程

### 7.1 创建支付会话

1. 取会话锁（`lock_cart`），读取订单，先跑 `expire_if_due`。
2. 断言订单仍 `pending_payment`、未过期、属于当前会话。
3. **重算金额**：由订单行 `unit_price × quantity` 求和，必须等于 `order.total`；不等则拒绝创建
   会话（不打 Stripe）。Stripe 的金额只能来自后端算出的值，绝不接受客户端传入。
4. 校验币种受支持、金额不低于 Stripe 的最小可付金额。
5. **可付窗口对齐**（见 7.4）。
6. 生成或复用会话：
   - 若已存在 `requires_payment` 且 `provider_reference` 非空的记录，向 Stripe 取回该会话；
     仍处于可支付状态则直接返回其 `redirect_url`，不新建。
   - 否则创建 Stripe Checkout Session：`mode='payment'`、`client_reference_id=order.id`、
     `payment_intent_data.metadata.order_id`、`line_items` 来自订单行、幂等键由订单 id 派生。
7. 写入 `payments` 行（`provider='stripe'`、`status='requires_payment'`、冻结金额与币种、
   `provider_reference`），写 `PaymentEvent` 与 `audit`。

### 7.2 支付确认（`checkout.session.completed`）

同一临界区内（会话锁 + 重读订单）穷举分支，**不静默成功**：

| 订单现状 | 处理 |
| --- | --- |
| `pending_payment` 且未过期 | 预占 `active → consumed`；`inventory.reserved -= qty`，**不动 `available`**；`orders.status='paid'`、`paid_at` 写入、`expires_at=NULL`；`payments.status='succeeded'`、记录 `payment_intent`；写 `PaymentEvent` 与 `audit` |
| 已 `cancelled`（过期或客户取消，库存已释放） | `payments.status='refund_pending'`；写 `PaymentEvent('payment_after_release')` 与 `audit`；尝试自动退款；**绝不把订单改回可发货状态** |
| 已 `paid` | 幂等返回，不做任何状态变更 |
| 已 `refunded` | 忽略，记 `ignored` |

### 7.3 退款

- 入口一：客户在订单页点击退款（仅 `paid` 且未发货）。
- 入口二：7.2 中「付款晚于释放」的自动补偿。
- 入口三：`python -m app.refund_pending` 扫描 `payments.status='refund_pending'` 补做。
  这是**不引入 Redis/Celery 的最小可用补偿**：一张表加一个可重复执行的命令。
- 成功：`payments.status='refunded'`、`orders.status='refunded'`、`refunded_at`、写
  `PaymentEvent('refund_succeeded')` 与 `audit`。
- 失败：保持 `refund_pending`，记 `attempts`，写结构化日志（不含密钥与个人数据）。

### 7.4 可付窗口与释放路径的唯一性

预占 TTL 默认 30 分钟，Stripe Checkout 的会话有效期最长 24 小时、最短 30 分钟。两者不一致会
产生「客户仍能付款但库存已释放」。处理方式不是「对齐两个超时」，而是三层收敛：

1. **创建会话前先 `expire_if_due`**；剩余可付时间不足 Stripe 最小窗口的订单直接拒绝创建会话，
   提示客户重新下单。这样 Stripe 永远拿不到比预占更长的可付窗口。
2. **创建会话时显式传入 `expires_at`**，取 `clamp(order.expires_at, now+30min, now+24h)`，并把
   订单 id 写入会话 metadata 作为对账锚点。
3. **释放路径保持唯一**：库存释放仍然只由过期扫描与客户取消触发。`checkout.session.expired`
   事件只记录不释放，避免出现第二条释放路径。

### 7.5 释放路径的硬护栏

`release_order` 在开始处检查该订单是否存在 `succeeded` 或 `refund_pending` 的资金记录；存在则
直接 `raise`（事务回滚 + 结构化日志）。即使将来出现一条本文未预料到的释放路径，也不可能把
已付款订单的库存还回 `available`。

### 7.6 金额换算

在 Python 侧建立唯一的换算函数 `to_minor_units(Decimal, currency) -> int`：

- 用定点量化到整数最小单位（USD 为分），并**断言精确相等**；存在超出 2 位小数的数据时报错，
  不静默取整。
- 订单行求和与订单总额的比较发生在换算之前，且比较基于 `Decimal`，不经过浮点。
- 展示层 `Price.amount` 的浮点值不得参与任何换算（`docs/agents/open-issues.md` 已登记的既有
  边界）。

## 8. 环境变量与配置

根目录 `.env` 成为单一真源。Python 的 `Settings` 改为按顺序读取
`(仓库根/.env, backend/.env)`，后者仅作本地覆盖；现有「`backend/.env` 只影响 Python」的说明
随之更新。Python 侧读取站点地址时同时接受 `PUBLIC_SITE_URL` 与既有的 `NEXT_PUBLIC_SITE_URL`
（该值本身就是公开的，不存在两个来源）。

新增配置项：

| 变量 | 归属 | 默认 | 说明 |
| --- | --- | --- | --- |
| `STRIPE_ENABLED` | Python | `false` | 唯一启停开关 |
| `STRIPE_SECRET_KEY` | Python | 空 | 已启用时必填 |
| `STRIPE_WEBHOOK_SECRET` | **Next** | 空 | 仅用于 webhook 路由验签。Python 不需要它：Python 只接受本仓 Next 的转发，信任模型与其余 commerce 端点一致（内部代理密钥） |
| `PUBLIC_SITE_URL` | Python | `http://localhost:3000` | 构造 `success_url`/`cancel_url`；已启用时必填且必须是绝对 https URL（本地开发允许 http） |
| `STRIPE_API_TIMEOUT_SECONDS` | Python | 有界默认值 | 出站调用超时，避免请求堆积 |

配置纪律：

- **半配置必须失败得明显。** `STRIPE_ENABLED=true` 而任一密钥缺失时，启动即报明确错误，
  preflight 也报错。当前的 `payment_enabled` 语义改为「Stripe 已正确启用」，而不是「有人填了
  一个密钥」。
- 运行时的展示值从同一处派生：`/health` 与订单响应读同一个配置判定，不允许两处各判一次。
- `backend/.env.example` 必须新增 Stripe 与 `PUBLIC_SITE_URL` 段落（当前完全没有）。
- 根 `.env.example` 保留 Stripe 段落占位，并交叉引用 `backend/.env` 的说明改为「已不再需要，
  统一写在根 `.env`」。
- `preflight.mjs` 删除 `SHOPIFY_ENABLED=true` 失败规则；新增 Stripe 半配置检测，以及生产环境下
  `STRIPE_ENABLED=true` 时对密钥、`PUBLIC_SITE_URL`、`STRIPE_WEBHOOK_SECRET` 的检查。
- **`.gitleaks.toml` 的 allowlist 需要从 `\.env\.local$` 扩展为同时覆盖根 `.env`**，并清掉其中
  关于 Shopify token 的陈旧注释。根 `.env` 已被 `.gitignore` 覆盖（`.env*` 与显式 `.env` 两条），
  不会进仓库；但本地的 secrets 扫描只放行了 `.env.local`，真密钥一旦写进根 `.env` 会被反复报为
  阻塞项。

## 9. 安全边界

- `STRIPE_SECRET_KEY` 只出现在 Python 进程的运行时环境中，不进入任何 Next 客户端或服务端模块。
- Next 公开 webhook 路由只做验签与投影转发，不写数据库、不做状态判定。
- 投影后的事件载荷只保留事件 id、类型、金额、币种、Stripe 对象 id。个人数据不落库、不写日志。
- 日志继续遵守既有纪律：不打印异常堆栈、连接串、Token、Cookie 或订单敏感信息。Stripe 出站
  失败只记录错误类型与订单 id。
- 所有改变订单、资金、库存的接口都在明确的事务边界内，且都是会话锁 + 重读后再判定。
- 所有权一律以会话 cookie 为准。`payments/session` 与退款接口都必须先校验归属。
- 客户端不得传入金额、币种或订单状态。Stripe 金额由后端重算。

## 10. Shopify 移除清单

移除范围以当场复核为准（复核命令见 11.1），至少包含：

- 代码：`src/server/catalog/shopify-buy.ts`、`shopify-stub.ts`、`shopify-buy.test.ts`、
  `src/components/shop/shopify-buy-button.tsx` 及其测试、`shopify-buy-host.css`、
  `shopify-buy-options.json`。
- 注入点：`src/server/catalog/adapter.ts` 的来源选择分支、`adapter-contract.ts` 的 `getBuyUrl`
  及其全部实现、`src/app/product/[handle]/page.tsx` 的购买配置与价格隐藏、
  `src/components/shop/product-actions.tsx` 的 `storeLive` 分支与相关 props、
  `src/app/api/catalog/route.ts` 的 `storeAvailable` 字段、`src/components/shop/saved-pairs.tsx`
  的店铺标记。
- 配置：`.env.example` / `.env.local` 中的全部 `SHOPIFY_*` 键、`.gitleaks.toml` 的相关注释、
  `CATALOG_SOURCE=shopify` 语义。
- 门禁：`scripts/preflight.mjs` 的 `SHOPIFY_ENABLED` 规则与其测试用例。
- 文档：删除 `docs/shopify-store-setup.md`；更新 `README.md`、`CONTEXT.md`、`backend/README.md`、
  `AGENTS.md`。带日期的历史报告与 `docs/archive/` **不改写**，按既有做法在
  `docs/agents/open-issues.md` 登记差异。
- `getBuyUrl` 一并移除。它三个实现全部返回 `null`，调用方的对应 props 从未被消费。留着它就是
  一个「未使用的公开接口」，会误导后来者以为存在第二条购买通道。

## 11. 测试与验收

### 11.1 复核命令

```bash
npm run verify
npm run verify:python
npm run check:python:migrate
npm run preflight -- --environment production
npm run build
```

Python 门禁需要先按 `backend/README.md` 建好 `backend/.venv` 并安装锁定依赖；本机当前无
Python 3.12 与 `uv`，开工前需要先解决该环境前置条件。

### 11.2 必须覆盖的测试面

不在此处写死用例数量。要求覆盖以下行为，每一类都要有能证伪的实现（断言行为，不断言实现细节）：

- **迁移**：upgrade/downgrade 在 SQLite 与 PostgreSQL 双方言可执行；已有数据的库升级后不丢行；
  downgrade 在存在新状态行时按设计失败而不是删数据。
- **未启用 Stripe**：`payments/session` 仍返回 `payment_disabled`；订单在任何操作后都不可能变为
  `paid`。这条是既有安全护栏的守护测试，必须保留。
- **会话创建**：金额由订单行重算并比对；订单行与总额不一致时拒绝且不打 Stripe；重复调用不产生
  第二个会话；过期订单、非本人订单、已 `paid`/`cancelled` 订单分别被正确拒绝。
- **webhook**：验签失败被拒绝且不落库；重复投递只造成一次状态变更；处理失败返回非 2xx；
  `payload` 中不含个人数据。
- **竞态**：`checkout.session.completed` 到达时订单已被释放 → 资金进入退款流程、订单绝不回到
  可发货状态；`release_order` 遇到已付款订单时抛错并回滚。
- **金额**：`to_minor_units` 的精度与拒绝非两位小数输入；低于最小可付金额被拒绝。
- **退款**：非本人拒绝；非 `paid` 拒绝；重复退款幂等；Stripe 失败进入 `refund_pending` 且可被
  补偿命令重试。
- **契约**：Python 响应模型与 TS 解析器对同一组新状态一致；TS 解析器接受四值状态、拒绝未知状态、
  拒绝非布尔 `payment_enabled`。
- **代理**：`payments/session` 仍受同源校验约束；`orders/{id}/refund` 进入白名单；新增 webhook
  路由不经过 commerce 代理且不要求 `Origin`。
- **边界**：`check:boundary`（client 模块不得运行时 import `src/server/**`）与 `check:coupling`
  保持绿色。任何新的共享契约类型放在 `src/domain/`。

### 11.3 上线复测

- 用 Stripe 测试模式密钥跑通完整闭环，并核对 `orders`/`payments`/`inventory_reservations` 三表的
  状态组合与不变量。
- 用 Stripe CLI 或测试工具重放同一事件，确认只有一次状态变更。
- 手工构造「付款晚于释放」场景，确认资金进入退款流程且订单不可发货。

## 12. 分阶段切片与回滚

| 切片 | 内容 | 依赖 | 回滚方式 |
| --- | --- | --- | --- |
| **A** | 移除 Shopify 与 `getBuyUrl`，同步文档、配置与 preflight 规则；不引入任何 Stripe 代码 | 无 | 直接 revert。行为回到今天，无数据变化 |
| **B** | Python 交易边界：迁移、状态常量模块、金额换算、`StripePaymentProvider`、会话创建、webhook 处理、退款与补偿命令、契约放宽 | 环境前置条件 | 迁移 downgrade + revert。未启用 Stripe 时行为与今天一致，所以 revert 不需要数据修复 |
| **C** | 前端闭环、文案与政策口径、env 单一真源、preflight Stripe 检查、ADR 与文档同步 | A、B | revert；`payment_enabled` 回到 `false` 后前端自动回到只读提示 |

切片 A 可以先独立合入并验证。

## 13. 文档同步（与代码同一提交）

- **新增 `docs/adr/0008-payment-channel.md`**：记录 D1–D4 与理由。接口决策不能只体现在代码里。
- **`AGENTS.md` §1** 的边界条款改写：从「本 MVP 不接入真实支付，只能使用 MockPaymentProvider」
  改为「默认关闭；仅当 `STRIPE_ENABLED=true` 且密钥齐备时启用；未启用时不得扣款、不得把订单
  改为 `paid`，支付接口必须返回明确的『支付暂未开放』结果」。原护栏降级为「未启用路径的守护
  要求」，而不是删除。
- **`docs/agents/quality-bar.md`**：「Mock 支付不变更为 paid」改写为「未启用支付时不得变更为
  `paid`」，并补入本文第 11.2 的竞态、幂等、退款覆盖面要求。
- **`docs/agents/commerce-contract.md`**：同步三条状态轴、不变量、新端点与幂等语义。
- **`docs/agents/open-issues.md`**：登记「Shopify 已移除」「支付真值边界变更」两条差异记录。
- **`README.md` / `backend/README.md` / `CONTEXT.md`**：更新 env 表、启动步骤、领域词汇（新增
  履约/资金/预占三轴的区分，以及「支付通道」一词）。
- **`src/lib/store-policy.ts`**：`POLICY_RETURNS` 补上退款例外（付款后未发货可取消退款），并同步
  进 `STORE_POLICY_FACTS`。该常量被 AI 客服与 PDP 共用，改一处生效两处。
- 前端文案：`commerce-panel.tsx` 的「Payments are not available yet.」分支改为按
  `payment_enabled` 与订单状态分支；订单页支持显示 `paid` / `refunded` / 退款中。

## 14. 未决与风险

| 项 | 影响 | 现状 |
| --- | --- | --- |
| Python 门禁环境 | 无 3.12 与 `uv`，切片 B 无法验证 | **开工前需要解决** |
| 依赖锁生成方式 | `backend/requirements-dev.lock` 无生成脚本，新增依赖需要同步更新，否则 CI 不装 Stripe | 切片 B 前补上并写进 `backend/README.md` |
| Python 出站访问 Stripe | 生产网络策略可能阻断出站 | 需要部署侧确认；本地无法验证 |
| 生产公网入口 | webhook 需要 Next 服务对 Stripe 可达 | 需要部署侧确认；与现有 preflight 的 loopback 规则无关（入口在 Next，不在 Python） |
| 币种 | 结算币种固定 USD，`SITE_MARKET` 表达展示市场 | 本次只收口，不做多币种 |
| 历史 `payments.status='disabled'` 行 | 保留为合法历史取值，不做数据改写 | 迁移必须包含该取值，否则有数据的库升级失败 |
| secrets 扫描 | 根 `.env` 未被 gitleaks allowlist 覆盖 | 与 env 单一真源同一切片处理 |
| 发货与物流 | 「未发货」目前无独立字段，`paid` 即视为未发货 | 若将来引入发货状态，退款条件需要同步调整 |
| 税务与发票 | 订单总额不含税与运费 | 非目标，但需要在政策文案中保持不承诺 |
