# 0008 — 支付通道改用 Stripe，真值留在 Python

**状态：** 已采纳 · **日期：** 2026-10-13

## 背景

本项目的购买通道原先保留着一个 Shopify 兼容入口（`SHOPIFY_ENABLED=false` 默认关闭，以及一个
Buy Button 的 PDP 接管路径），而真正的结账走 `MockPaymentProvider`：它只写一行
`Payment(status='disabled')` 与一条 `payment_disabled` 事件，永远返回「支付暂未开放」，
不扣款、不把订单改成 `paid`。

Shopify 入口在实际上线前被移除（见 `docs/superpowers/plans/2026-10-13-remove-shopify.md`）：
它是一套需要额外商品/库存同步的电商后台，与「本仓库自持商品目录与交易边界」的定位冲突，
而且 Buy Button 会把结账语义交给外部系统，与 AGENTS.md 的交易边界相矛盾。

移除之后需要一条**真实可用的支付通道**，同时不能破坏三条既有边界：价格/库存/订单/支付状态
的真值在 Python；客户端不得决定任何金额或状态；不引入 Redis/Celery/微服务。

## 决策

1. **支付真值留在 Python。** `backend/` 是价格、可售变体、库存、购物车、订单与支付状态的
   唯一真值。`STRIPE_SECRET_KEY` 只被 Python 读取，Next 侧永远不持有它——因此浏览器包与
   Next 服务端都拿不到能扣款的凭据。结账金额由 Python 从 `OrderItem` 行用 `Decimal` 重新
   计算，再经 `to_minor_units()` 转成整数最小单位交给 Stripe；客户端只提交 `order_id`。
2. **使用 Stripe 托管 Checkout，不自建卡表单。** 卡号与 3-D Secure 都留在 Stripe 的页面上
   （`redirect_url`），本项目不接触卡数据，也就不落 PCI 范围。前端拿到 URL 后跳转，返回页
   只读真值。
3. **根 `.env` 是本地配置的单一真源。** Python 的 `Settings` 读取**根 `.env`**，
   `backend/.env` 降级为可选的本地覆盖。Python 的交易库键也随之改为 `COMMERCE_DATABASE_URL`：
   它与 Next 展示库的 `DATABASE_URL` 曾是同名不同义的键，共用一个键会让两侧指向同一个
   SQLite 文件，破坏「展示目录不是交易真值」的边界。
4. **退款走 Stripe 的 Refund API**，并配一个可重复执行的补偿命令
   （`python -m app.refund_pending`）而不是队列。不引入 Redis/Celery 意味着失败重试必须是
   「有持久记录 + 可重跑的命令」，而不是内存中的任务。

**默认关闭语义。** 只有 `STRIPE_ENABLED=true` 且密钥齐备时支付才启用；半配置（只填一个密钥）
在启动期与预检期都必须**失败**，因为半配置会让人以为支付已开，而实际结账必然失败。
未启用时行为与迁移前的 `MockPaymentProvider` 等价：不扣款、不把订单改为 `paid`、
`payments/session` 返回明确的「支付暂未开放」机器可读结果。

**两条正交状态轴。** 订单的履约轴（`orders.status`）与资金轴（`payments.status`）分开记录，
因此「已付款但已释放库存」可以表示，而不必发明第五种订单状态。这一点取代了早期文档里
「已付款 ⇒ 资金为 succeeded」的过强表述：合法的组合还包括资金处于 `refund_pending`。

## 后果

- 未启用支付的部署必须保持与迁移前一致；`payment_enabled` 表达的是**部署级能力**，
  不是单个订单的可付状态（后者由 `status` 与 `payment_status` 共同表达）。
- 本仓库的支付路径**离线不可验证的部分**必须在交付报告里写明：真实 Stripe 调用、
  生产网络出站、PostgreSQL 方言的约束变更都无法在本地证明。
- 生产部署新增两项硬要求：出站可达 Stripe，以及一个公网可达的 webhook 入口
  （`/api/webhooks/stripe`，由 Next 验签后带内部代理密钥转发给 Python）。该入口是
  唯一必须把上游 5xx **原样透传**的端点，因为那正是 Stripe 的重投信号。
- 托管 Checkout 要求会话至少 30 分钟有效，因此预占窗口必须显著长于它，否则「下单后立刻支付」
  这条最普通的流程会被自己的过期策略拒绝。
- MVP 只支持卡支付（`allowed_payment_method_types=["card"]`）。

## 证据

规格与计划：`docs/superpowers/specs/2026-10-13-stripe-payments-design.md`、
`docs/superpowers/plans/2026-10-13-stripe-backend-payment-boundary.md` 与
`docs/superpowers/plans/2026-10-13-stripe-frontend-and-config.md`。
复核入口见 `docs/agents/open-issues.md`（支付真值边界与响应契约放宽两条）与
`docs/agents/quality-bar.md`（webhook 验签、重复投递、付款晚于释放、重复退款幂等、
未知状态拒绝）。
