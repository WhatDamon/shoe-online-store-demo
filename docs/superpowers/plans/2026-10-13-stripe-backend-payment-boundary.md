# Stripe 支付边界（Python 真值侧）实现计划（切片 B）

> **面向 AI 代理的工作者：** 必需子技能：使用 subagent-driven-development（推荐）或 executing-plans
> 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在 `backend/` 建立完整的 Stripe 支付边界：三条正交状态轴、金额换算、会话创建、webhook 驱动的支付确认、退款与补偿，并放宽响应契约。全流程在 Stripe 未启用时行为与今天逐字一致。

**架构：** Python 是价格、库存、订单与支付状态的唯一真值。Stripe 只作为支付通道被调用，出站与退款经一个薄网关协议（生产实现包裹 `stripe` SDK，测试用 fake）。所有状态变更都在既有会话锁 + 重读后判定的临界区内完成，且都是幂等的。

**技术栈：** FastAPI、Pydantic v2、SQLAlchemy 2、Alembic、pytest、httpx；`stripe` Python SDK；SQLite 与 PostgreSQL 双方言。

**规格：** `docs/superpowers/specs/2026-10-13-stripe-payments-design.md`（第 4–9、11 节）。规格是计划的论证依据，执行者两份都读。

**本计划的偏离说明：** `AGENTS.md` 禁止在常驻文档写死源码行号，故本计划用**文件路径 + 符号名**定位。

## 全局约束

- `requires-python = ">=3.12"`，本地已在 Python 3.14 验证通过；不修改 `pyproject.toml` 的版本下限。
- **默认不引入 Redis、Celery 或微服务拆分。** 补偿机制用「一张表 + 一个可重复执行的命令」。
- 本地默认 SQLite，但模型与迁移必须保持 PostgreSQL 兼容；正式 schema 由 Alembic 管理，**不用运行时 `create_all()`**。
- 新增配置必须同步 `backend/.env.example`、`README`、类型定义、安全默认值和测试；敏感配置不提交。
- 不使用异常堆栈、内部 URL、数据库错误、Token、Cookie 或订单敏感信息作为客户端返回或普通日志内容。
- 新增字段必须同步 ORM、Alembic、请求/响应模型、种子数据（如适用）与测试。
- Python 门禁入口：`npm run verify:python`；改动迁移后追加 `npm run db:migrate:python` 与 `npm run check:python:migrate`。
- **每完成一个数据库相关任务后必须跑双方言验证**：本地 SQLite；`COMMERCE_TEST_POSTGRES_URL` 存在时同一套测试也在 PostgreSQL 上跑。
- **默认不提交 Git commit。** commit 步骤只在用户已明确授权后执行。
- 每个任务结束时工作树必须可运行且 `npm run verify:python` 绿。

## 审查重点（Review Focus）

1. **`STRIPE_ENABLED=true` 但 `PUBLIC_SITE_URL` 是相对路径或 http**：必须启动即失败，而不是生成一个 Stripe 无法回调的坏地址。
2. **webhook 投递了一个本地找不到对应 payment 的会话**（测试模式与生产密钥混用、或跨环境重放）：必须记 `ignored` 并返回 2xx，**不能 500 让 Stripe 无限重投**。
3. **同一订单并发两次 `payments/session`**：只能产生一个 Stripe 会话；第二次必须复用第一次的 `redirect_url`，不能新建。
4. **金额为 `0.00` 或低于 Stripe 最小可付金额**（未来赠品或折扣会踩到）：必须在打 Stripe 之前拒绝。
5. **`checkout.session.completed` 与过期释放同时发生**：不得出现「订单可发货但库存已释放」，也不得静默吞掉已收到的钱；必须进入退款流程且资金状态可查。

---

### 任务 1：状态轴常量与数据库迁移

**文件：**
- 创建：`backend/app/domain/states.py`
- 创建：`backend/migrations/versions/<rev>_payment_states.py`（`<rev>` 由 alembic 生成）
- 修改：`backend/app/domain/models.py`
- 测试：`backend/tests/test_payment_states_migration.py`

- [ ] **步骤 1：写失败的测试**

创建 `backend/tests/test_payment_states_migration.py`，钉住三条新约束与四列新增。测试用
`conftest.py` 的 `commerce_engine` fixture（已含 SQLite / PostgreSQL 双方言参数化）。

```python
def test_orders_accepts_paid_and_refunded(commerce_engine): ...
def test_payments_keeps_legacy_disabled_and_accepts_stripe_states(commerce_engine): ...
def test_reservations_accept_consumed(commerce_engine): ...
def test_rejects_unknown_states(commerce_engine): ...          # 写入 'weird' 必须 IntegrityError
def test_new_payment_columns_exist_and_are_nullable(commerce_engine): ...
```

`test_payments_keeps_legacy_disabled_and_accepts_stripe_states` 是本任务的核心：插入一行
`status='disabled'` 必须成功（钉住历史数据不被破坏），再插入 `'requires_payment'`、`'succeeded'`、
`'refund_pending'`、`'refunded'` 也必须成功。

- [ ] **步骤 2：运行测试验证失败**

运行：`npm run py -- -m pytest tests/test_payment_states_migration.py -q`
预期：FAIL —— 当前约束拒绝 `paid` / `consumed`，且新列不存在。

- [ ] **步骤 3：创建状态常量模块**

创建 `backend/app/domain/states.py`：

```python
ORDER_STATUSES: tuple[str, ...] = ("pending_payment", "paid", "cancelled", "refunded")
PAYMENT_STATUSES: tuple[str, ...] = ("disabled", "requires_payment", "succeeded", "refund_pending", "refunded")
RESERVATION_STATUSES: tuple[str, ...] = ("active", "consumed", "released")

OrderStatus = Literal["pending_payment", "paid", "cancelled", "refunded"]
PaymentStatus = Literal["disabled", "requires_payment", "succeeded", "refund_pending", "refunded"]
ReservationStatus = Literal["active", "consumed", "released"]

def sql_in(column: str, allowed: tuple[str, ...]) -> str: ...
```

`sql_in` 生成 `col IN ('a','b')` 形式的字符串，供 `CheckConstraint` 与迁移共用。`PAYMENT_STATUSES`
必须包含 `'disabled'`：历史行的取值就是它，新约束排除它会让有数据的库升级失败。

- [ ] **步骤 4：生成迁移并写入 ORM 变更**

运行：`npm run py -- -m alembic revision -m "payment states"`（手写 upgrade/downgrade，不用 autogenerate）

迁移 `upgrade` 在 `batch_alter_table` 下完成：
- 三张表的旧 `CheckConstraint` 先 drop 再按 `sql_in(...)` 重建（SQLite 必须走 batch 模式）
- `payments` 新增可空列：`provider_reference`、`payment_intent`、`amount`、`currency`、
  `created_at`、`succeeded_at`、`refunded_at`
- `payments.provider_reference` 加**唯一索引**（幂等复用与 webhook 反查的前提）
- `orders` 新增可空列：`paid_at`、`refunded_at`
- `webhook_events` 新增 `status`（非空，`server_default='received'`）、`attempts`
  （非空，`server_default='0'`）、`received_at`、`processed_at`

**新增的非空列必须带 `server_default`**，否则在有数据的表上迁移会因现有行无法满足非空约束而失败。

`downgrade` 在检测到任何新状态行时 `raise`，不删数据。

同步修改 `backend/app/domain/models.py`：三处 `CheckConstraint` 改用 `sql_in(...)`；`Order`、
`Payment`、`WebhookEvent` 加上对应映射列。`payments.provider` 的列默认值保持 `'mock'`。

- [ ] **步骤 5：运行测试与门禁验证通过**

运行：`npm run db:migrate:python && npm run check:python:migrate && npm run py -- -m pytest tests/test_payment_states_migration.py -q`
预期：PASS，`No new upgrade operations detected.`

运行：`npm run verify:python` 预期：PASS（既有测试在放宽后的约束下仍必须全绿）。

- [ ] **步骤 6：Commit（仅在已获提交授权时执行）**

```bash
git add backend/app/domain/states.py backend/app/domain/models.py backend/migrations backend/tests/test_payment_states_migration.py
git commit -m "feat(commerce): add payment/reservation state axes and columns"
```

---

### 任务 2：金额换算

**文件：**
- 创建：`backend/app/domain/money.py`
- 测试：`backend/tests/test_money.py`

- [ ] **步骤 1：写失败的测试**

```python
def test_to_minor_units_is_exact_for_two_decimals(): ...      # Decimal('98.00') -> 9800
def test_to_minor_units_rejects_sub_cent_precision(): ...     # Decimal('1.005') -> ValueError
def test_to_minor_units_rejects_unsupported_currency(): ...   # 'XYZ' -> ValueError
def test_to_minor_units_rejects_negative(): ...
def test_is_chargeable_enforces_stripe_minimum(): ...         # Decimal('0.00') / Decimal('0.49') -> False
def test_order_total_sums_unit_price_times_quantity(): ...    # 逐行 Decimal 求和，不经浮点
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm run py -- -m pytest tests/test_money.py -q`
预期：FAIL，`ModuleNotFoundError: app.domain.money`。

- [ ] **步骤 3：实现 `backend/app/domain/money.py`**

```python
SUPPORTED_CURRENCIES: dict[str, int] = {"USD": 2}
MINIMUM_CHARGE_MINOR: dict[str, int] = {"USD": 50}

def to_minor_units(amount: Decimal, currency: str) -> int: ...
def is_chargeable(amount: Decimal, currency: str) -> bool: ...
def order_total_from_items(items: Sequence[tuple[Decimal, int]]) -> Decimal: ...
```

`to_minor_units` 用 `quantize(Decimal("1"), rounding=ROUND_HALF_UP)` 后**断言与精确值相等**，
存在超出币种小数位的输入时 `raise ValueError`，不静默取整。`order_total_from_items` 接收
`(unit_price, quantity)` 序列，用 `Decimal` 累加，**不经过任何浮点**。

- [ ] **步骤 4：运行测试验证通过**

运行：`npm run py -- -m pytest tests/test_money.py -q` 预期：PASS

- [ ] **步骤 5：Commit（仅在已获提交授权时执行）**

```bash
git add backend/app/domain/money.py backend/tests/test_money.py
git commit -m "feat(money): add exact minor-unit conversion helpers"
```

---

### 任务 3：配置 —— 根 `.env` 单一真源与 Stripe 设置

**文件：**
- 修改：`backend/app/config.py`
- 修改：`backend/.env.example`、`.env.example`
- 测试：`backend/tests/test_config.py`

- [ ] **步骤 1：写失败的测试**

```python
def test_reads_root_env_file(monkeypatch, tmp_path): ...            # 根 .env 的键被读到
def test_backend_env_overrides_root_env(monkeypatch, tmp_path): ...  # backend/.env 覆盖根 .env
def test_site_url_accepts_both_names(monkeypatch): ...             # PUBLIC_SITE_URL 与 NEXT_PUBLIC_SITE_URL
def test_enabled_without_secret_key_fails_at_startup(): ...        # stripe_enabled=True 无 key -> ValueError
def test_enabled_with_relative_site_url_fails_at_startup(): ...    # 相对路径 / http（生产）-> ValueError
def test_disabled_ignores_missing_stripe_configuration(): ...      # 默认 False 时不校验、不报错
def test_stripe_ready_requires_all_pieces(): ...
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm run py -- -m pytest tests/test_config.py -q`
预期：FAIL —— `Settings` 尚无 Stripe 字段，且只读 `backend/.env`。

- [ ] **步骤 3：实现配置变更**

修改 `backend/app/config.py`：

```python
ROOT_ENV = Path(__file__).parents[2] / ".env"
BACKEND_ENV = Path(__file__).parents[1] / ".env"

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(ROOT_ENV, BACKEND_ENV), extra="ignore")
    stripe_enabled: bool = False
    stripe_secret_key: str = ""
    stripe_api_timeout_seconds: int = Field(default=10, ge=1, le=60)
    public_site_url: str = Field(
        default="http://localhost:3000",
        validation_alias=AliasChoices("PUBLIC_SITE_URL", "NEXT_PUBLIC_SITE_URL"),
    )

    @property
    def stripe_ready(self) -> bool: ...
```

读取顺序 `(ROOT_ENV, BACKEND_ENV)` 让 `backend/.env` 成为本地覆盖。`model_validator(mode="after")`
在 `stripe_enabled=True` 时要求 `stripe_secret_key` 非空、`public_site_url` 为绝对地址
（生产必须是 https），任一不满足即 `raise ValueError` —— **半配置必须在启动时失败**。
`stripe_ready` 是唯一的运行时判定源，`/health` 与订单响应都读它，不允许两处各判一次。

同步 `.env.example`（新增 Stripe 与 `PUBLIC_SITE_URL` 段落，注明密钥写在这里）与
`backend/.env.example`（同样新增，并注明根 `.env` 已是单一真源、本文件仅本地覆盖）。

- [ ] **步骤 4：运行测试与门禁验证通过**

运行：`npm run py -- -m pytest tests/test_config.py -q && npm run verify:python` 预期：PASS

- [ ] **步骤 5：Commit（仅在已获提交授权时执行）**

```bash
git add backend/app/config.py backend/tests/test_config.py .env.example backend/.env.example
git commit -m "feat(config): single-source root env and Stripe settings"
```

---

### 任务 4：放宽 Python 响应契约

**文件：**
- 修改：`backend/app/schemas/responses.py`、`backend/app/main.py`
- 修改：`backend/tests/test_response_contract.py`
- 测试：`backend/tests/test_payment_contract.py`

- [ ] **步骤 1：写失败的测试**

```python
def test_order_response_accepts_paid_and_refunded(): ...      # 构造 OrderResponse 成功
def test_health_reports_payment_enabled_from_stripe_ready(monkeypatch): ...
def test_payment_response_requires_redirect_url_when_ready(): ...  # payment_ready 且无 redirect_url -> 校验失败
def test_payment_response_forbids_redirect_url_when_disabled(): ...
def test_order_response_rejects_unknown_status(): ...
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm run py -- -m pytest tests/test_payment_contract.py -q`
预期：FAIL —— `OrderStatus` 仍是两值 `Literal`，`payment_enabled` 仍是 `Literal[False]`。

- [ ] **步骤 3：放宽模型**

在 `backend/app/schemas/responses.py` 中：
- `OrderStatus` 改为从 `app.domain.states` 导入
- `HealthResponse.payment_enabled` 改为 `bool`
- `OrderResponse.status` 用新 `OrderStatus`；`payment_enabled` 改为 `bool`
- `PaymentResponse` 改为：`code: Literal['payment_disabled','payment_ready','order_not_payable','currency_unsupported']`、
  `payment_enabled: bool`、`provider: Literal['mock','stripe']`、`order_id: str`、
  `order_status: OrderStatus`、`redirect_url: str | None`、`message: str`
- **移除 `charged` 字段**：在创建会话这一刻它恒为 `False`，不承载信息，且容易被误读为「没付款」。
  `redirect_url` 用 `model_validator` 约束：`payment_ready` 时必填，其余 code 必须为 `None`。

在 `backend/app/main.py` 的 `health` 中把 `payment_enabled` 改为 `settings.stripe_ready`。

更新 `backend/tests/test_response_contract.py` 里的响应模型登记表与既有断言（该文件用一张
`(path, method, model)` 登记表约束所有端点，新增字段会在这里被发现）。

- [ ] **步骤 4：运行测试与门禁验证通过**

运行：`npm run verify:python` 预期：PASS。既有 `payment_disabled` 用例仍必须通过，
因为 Stripe 默认关闭时行为未变。

- [ ] **步骤 5：Commit（仅在已获提交授权时执行）**

```bash
git add backend/app/schemas/responses.py backend/app/main.py backend/tests/test_response_contract.py backend/tests/test_payment_contract.py
git commit -m "feat(contract): widen payment contract for Stripe"
```

---

### 任务 5：支付网关与支付提供者

**文件：**
- 创建：`backend/app/application/payments.py`
- 创建：`backend/app/infrastructure/stripe_gateway.py`
- 修改：`backend/app/application/commerce.py`（移出 `MockPaymentProvider`）
- 修改：`backend/app/application/errors.py`
- 修改：`backend/app/api/v1/routes.py`
- 修改：`backend/tests/conftest.py`（新增共享的 Stripe 网关测试替身）
- 修改：`backend/tests/test_commerce.py`、`backend/tests/test_expiry.py`、`backend/tests/test_catalog_availability.py`
- 测试：`backend/tests/test_payment_session.py`

- [ ] **步骤 1：写失败的测试**

```python
def test_disabled_provider_keeps_machine_readable_disabled_result(commerce): ...
def test_session_requires_owned_order(commerce, variant): ...          # 他人订单 -> 404
def test_session_rejects_expired_order(commerce, variant): ...         # 已过期 -> order_not_payable
def test_session_rejects_already_paid_order(commerce, variant): ...
def test_session_recomputes_total_and_rejects_mismatch(commerce, variant, monkeypatch): ...
def test_session_rejects_non_chargeable_amount(commerce, variant, monkeypatch): ...
def test_session_reuses_existing_open_session(commerce, variant, fake_gateway): ...   # 审查重点 3
def test_session_clamps_stripe_expiry_to_reservation_deadline(commerce, variant, fake_gateway): ...
def test_session_creates_no_stripe_call_when_disabled(commerce, variant, monkeypatch): ...
```

`fake_gateway` / `failing_gateway` 是本切片的关键测试设施：实现 `StripeGateway` 协议的假实现，
记录调用并返回可控结果，让全部支付逻辑在**无网络**的条件下可测。它们放在
`backend/tests/conftest.py` 中供任务 5、6、7、8 共享，不要在每个测试文件里各写一份。

- [ ] **步骤 2：运行测试验证失败**

运行：`npm run py -- -m pytest tests/test_payment_session.py -q`
预期：FAIL，`ModuleNotFoundError: app.application.payments`。

- [ ] **步骤 3：定义网关协议与支付者**

创建 `backend/app/application/payments.py`：

```python
@dataclass(frozen=True)
class PaymentSession:
    code: str
    payment_enabled: bool
    provider: str
    order_id: str
    order_status: str
    redirect_url: str | None
    message: str

class StripeGateway(Protocol):
    def create_checkout_session(self, *, order_id: str, currency: str, line_items: list[dict],
                                expires_at: datetime, success_url: str, cancel_url: str,
                                idempotency_key: str) -> CheckoutSession: ...
    def retrieve_checkout_session(self, session_id: str) -> CheckoutSession | None: ...
    def refund(self, *, payment_intent: str, idempotency_key: str) -> str: ...

class MockPaymentProvider: ...      # 从 commerce.py 原样移入
class StripePaymentProvider: ...
def create_payment_session(db: Session, session_id: str, order_id: str, *, gateway: StripeGateway | None = None) -> PaymentSession: ...
```

创建 `backend/app/infrastructure/stripe_gateway.py`：`SdkStripeGateway` 包裹 `stripe` SDK，
用 `settings.stripe_api_timeout_seconds` 设超时，密钥只从 `settings.stripe_secret_key` 读，
不记录任何请求体。

`create_payment_session` 的顺序固定为：`lock_cart` → 读订单 → `expire_if_due` → 校验归属与
`pending_payment` → 用 `order_total_from_items` 重算并与 `order.total` 比对 → 校验
`is_chargeable` → 复用或新建会话 → 写 `payments` 行。**Stripe 未启用时直接返回
`payment_disabled`，不得有任何出站调用。**

可付窗口：传给 Stripe 的 `expires_at` 取 `clamp(order.expires_at, now+30min, now+24h)`；若
`order.expires_at` 距现在不足 30 分钟则直接返回 `order_not_payable`（审查重点 1 的行为面）。

`payments/session` 的四种结果是 **HTTP 200 的机器可读结局**，不是异常：
`payment_disabled`（Stripe 未启用）、`payment_ready`、`order_not_payable`（订单已
paid/cancelled/refunded、已过期、剩余可付窗口不足 30 分钟、或金额不可扣）、
`currency_unsupported`。**归属失败沿用既有语义**（`owned_order` 抛 `OrderNotFound` → 404），
不要为它新增异常类，也不要用 409 泄露某个订单是否存在。因此本任务与任务 4 都不在
`errors.py` 新增异常类；异常化只用于退款失败（任务 7 的 `PaymentNotRefundable`）。

在 `commerce.py` 中删除 `MockPaymentProvider` 并改为从 `payments` 重新导出，避免引用点全改。
在 `routes.py` 中让 `payments/session` 调用 `create_payment_session`，保持
`response_model=PaymentResponse` 与 HTTP 200。

- [ ] **步骤 4：运行测试与门禁验证通过**

运行：`npm run verify:python` 预期：PASS。既有断言 `code == 'payment_disabled'` 的用例
（`test_commerce.py`、`test_expiry.py`、`test_catalog_availability.py`）必须继续通过。

- [ ] **步骤 5：Commit（仅在已获提交授权时执行）**

```bash
git add backend/app backend/tests
git commit -m "feat(payments): add Stripe session creation behind a gateway protocol"
```

---

### 任务 6：支付确认与释放护栏

**文件：**
- 修改：`backend/app/application/payments.py`（`confirm_payment`）
- 修改：`backend/app/application/commerce.py`（`release_order` 护栏）
- 测试：`backend/tests/test_payment_confirmation.py`

- [ ] **步骤 1：写失败的测试**

```python
def test_confirmation_consumes_reservation_and_keeps_stock_out_of_available(commerce, variant, paid_order): ...
def test_confirmation_sets_paid_and_clears_expiry(commerce, paid_order): ...
def test_confirmation_is_idempotent_on_repeat_delivery(commerce, paid_order): ...
def test_confirmation_after_release_moves_payment_to_refund_pending(commerce, variant, monkeypatch): ...
def test_confirmation_after_release_never_restores_buyable_order(commerce, variant): ...
def test_release_order_refuses_a_paid_order(commerce, paid_order): ...        # 护栏
def test_release_order_refuses_a_refund_pending_order(commerce, refund_pending_order): ...
def test_expired_sweep_cannot_release_a_paid_order(commerce, paid_order): ...
```

`test_confirmation_consumes_reservation_and_keeps_stock_out_of_available` 是本切片最重要的
断言：付款成功后 `inventory.available` **不得回升**，`inventory.reserved` 减去对应数量，
预占状态为 `consumed`。

- [ ] **步骤 2：运行测试验证失败**

运行：`npm run py -- -m pytest tests/test_payment_confirmation.py -q`
预期：FAIL，`confirm_payment` 不存在，`release_order` 无护栏。

- [ ] **步骤 3：实现确认事务与护栏**

在 `backend/app/application/payments.py` 中实现：

```python
@dataclass(frozen=True)
class ConfirmOutcome:
    status: str            # 'paid' | 'refund_pending' | 'already_paid' | 'ignored'
    order_id: str

def confirm_payment(db: Session, *, order_id: str, provider_reference: str,
                    payment_intent: str | None) -> ConfirmOutcome: ...
```

在 `lock_cart` 之后重读订单并穷举分支：`pending_payment` 且未过期 → 正常转移；已 `cancelled`
→ 资金状态置 `refund_pending` 并写 `PaymentEvent('payment_after_release')`；已 `paid` → 幂等返回；
其它 → `ignored`。**任何分支都不得把订单改回可发货状态。**

在 `backend/app/application/commerce.py` 的 `release_order` 开头加护栏：存在
`succeeded` 或 `refund_pending` 的资金记录时 `raise RuntimeError`，让调用方事务回滚。
该函数已由过期扫描与客户取消共用，护栏因此覆盖两条既有路径（审查重点 5）。

- [ ] **步骤 4：运行测试与门禁验证通过**

运行：`npm run verify:python` 预期：PASS。既有 `test_expiry.py` 全部用例必须继续通过。

- [ ] **步骤 5：Commit（仅在已获提交授权时执行）**

```bash
git add backend/app/application backend/tests
git commit -m "feat(payments): atomic payment confirmation with release guard"
```

---

### 任务 7：退款与补偿命令

**文件：**
- 修改：`backend/app/application/payments.py`（`refund_order`、`refund_pending_payments`）
- 创建：`backend/app/refund_pending.py`
- 修改：`backend/app/api/v1/routes.py`、`backend/app/application/errors.py`
- 测试：`backend/tests/test_refunds.py`

- [ ] **步骤 1：写失败的测试**

```python
def test_refund_requires_ownership(commerce, other_session): ...        # 404，不泄露存在性
def test_refund_rejects_unpaid_order(commerce, variant): ...            # payment_not_refundable
def test_refund_is_idempotent(commerce, paid_order): ...                # 第二次不再调网关
def test_refund_marks_order_and_payment_refunded(commerce, paid_order): ...
def test_refund_gateway_failure_leaves_refund_pending(commerce, paid_order, failing_gateway): ...
def test_refund_pending_command_retries_and_is_repeatable(commerce, refund_pending_order): ...
def test_refund_uses_deterministic_idempotency_key(commerce, paid_order, fake_gateway): ...
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm run py -- -m pytest tests/test_refunds.py -q`
预期：FAIL，`refund_order` 不存在，`POST /orders/{id}/refund` 返回 404。

- [ ] **步骤 3：实现退款与补偿**

在 `payments.py` 中：

```python
def refund_order(db: Session, session_id: str, order_id: str, *, gateway: StripeGateway | None = None) -> dict: ...
def refund_pending_payments(db: Session, *, limit: int = 100, gateway: StripeGateway | None = None) -> int: ...
```

`refund_order` 校验归属与 `paid` 状态，已是 `refunded` 直接返回当前视图，已是 `refund_pending`
不重复调用网关；调网关用**由订单 id 派生的确定性幂等键**。成功写
`payments.status='refunded'`、`orders.status='refunded'`、`refunded_at`、
`PaymentEvent('refund_succeeded')` 与 `audit`；失败保持 `refund_pending` 并递增 `attempts`，
抛业务错误（不是 500）。

创建 `backend/app/refund_pending.py` 作为可重复执行的入口（模式对齐既有 `app/expire_orders.py`），
批量处理 `refund_pending` 并返回处理数量，供运维手动补偿。

在 `errors.py` 新增 `PaymentNotRefundable`（409）。在 `routes.py` 新增
`POST /orders/{order_id}/refund`，所有权与 `cancel` 一致。

- [ ] **步骤 4：运行测试与门禁验证通过**

运行：`npm run verify:python` 预期：PASS
运行：`npm run py -- -m app.refund_pending` 预期：在无待退款数据时输出处理数为 0 且退出码 0。

- [ ] **步骤 5：Commit（仅在已获提交授权时执行）**

```bash
git add backend/app backend/tests
git commit -m "feat(payments): add refund API and repeatable compensation command"
```

---

### 任务 8：Webhook 摄取与幂等

**文件：**
- 创建：`backend/app/application/webhooks.py`
- 修改：`backend/app/schemas/commerce.py`（`StripeEventProjection`）
- 修改：`backend/app/api/v1/routes.py`
- 测试：`backend/tests/test_webhooks.py`

- [ ] **步骤 1：写失败的测试**

```python
def test_completed_event_marks_order_paid(commerce, paid_order): ...
def test_duplicate_delivery_changes_state_once(commerce, paid_order): ...
def test_unknown_session_is_ignored_and_returns_success(commerce): ...   # 审查重点 2
def test_failed_event_is_retryable(commerce, monkeypatch): ...
def test_projection_rejects_oversized_or_malformed_ids(commerce): ...
def test_payload_keeps_no_personal_data(commerce, paid_order): ...      # 落库内容不含 email/付款方式
def test_unsupported_event_types_are_recorded_as_ignored(commerce): ...
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm run py -- -m pytest tests/test_webhooks.py -q`
预期：FAIL，端点与 `ingest_event` 均不存在。

- [ ] **步骤 3：实现摄取**

在 `backend/app/schemas/commerce.py` 中新增投影模型（**只收最小字段集**，不是 Stripe 原始载荷）：

```python
class StripeEventProjection(BaseModel):
    id: Annotated[str, Field(min_length=1, max_length=200)]
    type: Annotated[str, Field(min_length=1, max_length=80)]
    order_id: UUID | None = None
    checkout_session_id: Annotated[str, Field(max_length=200)] | None = None
    payment_intent: Annotated[str, Field(max_length=200)] | None = None
    amount_total: int | None = None
    currency: Annotated[str, Field(pattern=r"^[a-z]{3}$")] | None = None
```

在 `backend/app/application/webhooks.py` 中：

```python
@dataclass(frozen=True)
class IngestResult:
    status: str    # 'processed' | 'duplicate' | 'ignored' | 'failed'

def ingest_event(db: Session, projection: StripeEventProjection) -> IngestResult: ...
```

流程：先 `INSERT ... ON CONFLICT DO NOTHING` 写 `webhook_events`（`provider='stripe'`、
`external_id=projection.id`，载荷只保存投影字段）。`rowcount == 0` 时读现有行：`processed` →
返回 `duplicate`；`received` 或 `failed` → 允许重试。找不到对应订单或会话 → 记 `ignored`。
`checkout.session.completed` → 调 `confirm_payment`；`checkout.session.expired` **只记录不释放**
（释放路径保持唯一，见规格 7.4）。处理失败 → `status='failed'`、尝试数 +1、**返回非 2xx**。

在 `routes.py` 新增 `POST /webhooks/stripe`（与其余端点同为 `internal_proxy` 保护）。
**这是全仓唯一一处 5xx 语义必须透传给调用方以便重投的接口**，需要在这段代码里写明理由。

- [ ] **步骤 4：运行测试与门禁验证通过**

运行：`npm run verify:python` 预期：PASS

- [ ] **步骤 5：Commit（仅在已获提交授权时执行）**

```bash
git add backend/app backend/tests
git commit -m "feat(payments): idempotent Stripe webhook ingestion"
```

---

### 任务 9：依赖与门槛收口

**文件：**
- 修改：`backend/pyproject.toml`、`backend/requirements-dev.lock`、`backend/README.md`
- 修改：`backend/tests/test_proxy_auth.py`（若需覆盖新端点的鉴权）

- [ ] **步骤 1：加入依赖并同步锁文件**

在 `backend/pyproject.toml` 的 `dependencies` 中加入 `stripe`（带版本下限，与既有条目的写法一致）。
把 `stripe` 及其传递依赖写入 `backend/requirements-dev.lock`（该文件是平铺的固定版本列表，
**尚无生成脚本 —— 顺手把生成方式写进 `backend/README.md`**，否则 CI 的
`python -m pip install -r requirements-dev.lock` 不会装到 Stripe，CI 会直接红）。

- [ ] **步骤 2：写失败的测试**

在 `backend/tests/test_proxy_auth.py` 中新增：`POST /api/v1/webhooks/stripe` 与
`POST /api/v1/orders/{id}/refund` 在配置了 `COMMERCE_PROXY_SECRET` 时缺少
`X-Internal-Proxy-Secret` 必须被拒绝。

- [ ] **步骤 3：运行测试验证通过**

运行：`npm run py -- -m pip install -r backend/requirements-dev.lock && npm run verify:python`
预期：PASS，且 `import stripe` 可用。

- [ ] **步骤 4：Commit（仅在已获提交授权时执行）**

```bash
git add backend/pyproject.toml backend/requirements-dev.lock backend/README.md backend/tests/test_proxy_auth.py
git commit -m "build(backend): add stripe dependency and document lock generation"
```
