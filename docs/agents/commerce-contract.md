# Commerce MVP 契约：数据、接口与事务

> 由 `AGENTS.md` 外移而来。本文件描述**必须成立什么**，不是实现状态快照；
> 实现状态见 `docs/commerce-mvp-report.md`，已知缺口见 `open-issues.md`。
> 阅读路由见 `task-routing.md`，验收命令见 `verification.md`。

当修复当前阻塞问题后，继续以以下闭环为最小业务合同；已有功能先验证，缺失功能再小步补齐：

```text
浏览商品 -> 选择明确颜色/尺码和 variant_id -> 加入购物车
-> Python 后端重新读取价格 -> 预览总价和库存
-> 事务内检查并锁定库存 -> 创建 pending_payment 订单
-> 显示订单编号；支付通道关闭时显示“支付暂未开放”，启用时给出托管结账入口
```

### 三条状态轴与不变量

订单状态由**三条正交轴**回答三个不同问题，任何一条都不能推出另一条：履约轴 `orders.status`
（`pending_payment` / `paid` / `cancelled` / `refunded`）、资金轴 `payments.status`
（`disabled` / `requires_payment` / `succeeded` / `refund_pending` / `refunded`）、
预占轴 `inventory_reservations.status`（`active` / `consumed` / `released`）。

必须成立的不变量：

1. `orders.status='paid'` ⇒ 资金已被捕获（`payments.status ∈ {succeeded, refund_pending, refunded}`），
   且该订单**所有**预占为 `consumed`。这不是「资金为 `succeeded`」——退款处理中同样是已捕获。
2. `orders.status='cancelled'` 而资金已捕获 ⇒ 必须有退款记录（`refund_pending` 或 `refunded`）。
   这是「欠退款」的唯一信号。
3. `payments.status='succeeded'` ⇒ 库存**真的被扣过**，而不是退回 `reserved`。
4. 「已付但库存已释放」（付款晚于过期释放）是**合法组合**，必须可表示；不得用第五种订单状态
   或改回 `pending_payment` 掩盖。
5. **释放路径唯一且必须先确认无已结算资金**：过期扫描与用户取消都走同一条释放路径；
   该路径开始时若发现该订单已有已结算资金，则事务回滚并记结构化 ERROR 日志，
   绝不静默释放（静默释放会把同一份库存卖两次）。

### 数据和迁移

至少维护 `products`、`product_variants`、`product_media`、`carts`、`cart_items`、`inventory`、`inventory_reservations`、`orders`、`order_items`、`payments`、`payment_events`、`webhook_events`、`audit_logs` 的真实关系；实际代码已有其他模型时先兼容并核对迁移。

- 每个颜色/尺码组合有稳定 `variant_id`，不能用颜色数组下标识别。
- `order_items` 保存下单时商品名、SKU、尺码、颜色、货币和价格快照。
- 库存至少区分 `available` 和 `reserved`；预占、扣减、释放必须在明确事务中完成。
- Python 交易库的结构变化通过 Alembic migration；检查升级、降级或前向修复策略，不得用运行时 `create_all()` 代替正式迁移。
- TypeScript 展示/AI 数据库**不在此列**：它使用版本化 Drizzle 迁移加幂等运行时 DDL，见 `task-routing.md` 的「数据库双轨」与 ADR 0003、0007。不可据上一条移除该侧的运行时初始化。

### API 和所有权

目标接口包括：

```text
GET    /health
GET    /api/v1/catalog/products
GET    /api/v1/catalog/products/{handle}
GET    /api/v1/cart
POST   /api/v1/cart/items
PATCH  /api/v1/cart/items/{item_id}
DELETE /api/v1/cart/items/{item_id}
POST   /api/v1/checkout/preview
POST   /api/v1/checkout/create-order
GET    /api/v1/orders/{order_id}
POST   /api/v1/orders/{order_id}/cancel
POST   /api/v1/orders/{order_id}/refund
POST   /api/v1/payments/session
POST   /api/v1/webhooks/stripe
```

`payments/session` 的**四种结局都是 HTTP 200**（机器可读结果，不是错误）：`payment_disabled` /
`payment_ready` / `order_not_payable` / `currency_unsupported`。只有 `payment_ready` 带
`redirect_url`（https）；客户端只导航到这个 URL，不得自行构造。取消已付款/已退款订单返回
**409 `order_not_cancellable`**（不是 500，也不是静默 200）。

`webhooks/stripe` 是**唯一的服务端到服务端入口**：它不经过 `/api/commerce` 代理，因此不受同源
规则约束，而必须由验签保护（Next 侧用官方 SDK 对**原始 body** 验签，密钥缺失时 fail closed）。
它是**唯一必须原样透传上游 5xx** 的端点——那正是 Stripe 的重投信号；把 5xx 收敢为通用
不可用会默默丢掉一笔支付。

允许匿名购物会话，但必须通过安全 Cookie 或明确的服务端会话 ID 管理。每次读取/修改购物车、订单、支付和库存都验证会话/用户所有权。客户端只提交 `variant_id`、数量和必要的幂等键，不提交价格、库存、订单状态或支付结果。

### 事务、幂等和异常

- 创建订单：校验输入 -> 读取权威价格和库存 -> 锁定/原子更新库存 -> 写入订单、订单项、支付占位和 audit log -> 在所有写入成功后提交；任何失败回滚全部业务写入。
- 取消订单：验证所有权和可取消状态 -> 释放尚未使用的库存预占 -> 写入状态变更和 audit log -> 提交。
- 创建订单必须要求幂等键；相同会话、相同业务键重复请求返回同一结果或明确冲突，不能产生两个订单。
- webhook 幂等依靠 `(provider, external_id)` 唯一约束加 `ON CONFLICT DO NOTHING`：
  **重复投递只能变更一次状态**。已处理的事件再投递返回 2xx 且不再执行业务动作；业务写入用
  savepoint 隔离，失败时回写 `failed` 与尝试次数并返回**非 2xx** 以触发重投。
- 未知订单/未知会话的事件记为「已忽略」并返回 2xx（Stripe 收到 2xx 即停止重投），
  不得当成错误。
- 退款幂等：同一订单的重复退款请求不得重复扣款；退款失败保留「欠退款」状态并交给可重跑的
  补偿命令，不得伪造成成功。退款意图必须在**调用外部退款之前**持久化，否则外部已退、本地无记录。
- 状态迁移必须有允许的前置状态；客户端不能跳过 `pending_payment` 伪造 `paid`。
- 数据库异常和第三方异常不能原样暴露；边界层记录 request ID，返回稳定的错误 code。
- 日志使用结构化字段且不得写入密码、Token、Cookie 或支付敏感信息（含 Stripe 对象原文；
  SDK 自带 logger 也必须被抑制）。
