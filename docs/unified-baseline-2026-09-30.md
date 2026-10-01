# 统一基线实施报告 — 2026-09-30

本报告描述 `F:/shoe-online-store-demo` 的本轮本地实现和验收，时区 Asia/Shanghai。用户要求根据项目文件继续推进更新；旧交接中的待办用于定位，不被当作提交、部署、真实支付或外部操作的独立授权。

## 1. 目标、事实与根因

目标是将已有 commerce 实现和分散的安全修复组合成一套可运行、可验证的本地工作树，先解除构建阻塞，再验证交易和安全边界。没有开展新的 SEO 内容或流量开发。

- 起点：分支 `sql-certificate-and-AI-stock`，HEAD `dd76ad81992a4dc1d95d6cdb7bbd6853b38ee867`。本轮没有 commit、fetch、push 或部署。
- 原有未提交内容：README 的交接入口、`HANDOVER.md`、`docs/从最小后端到交易闭环-图解教学-2026-09-30.md`。保留原交接正文和教学文件，仅补充当前状态及相关 README 内容。
- **构建阻塞已确认**：当前分支的 cart、checkout、orders 页面引用缺失的 `commerce-panel`；backend 目录虽然存在，但缺少 Python 源码，不能以目录或旧字节码存在推断后端完整。
- **整合缺口已确认**：交易功能、TLS、有界护栏、Session/IP、预算和业务异常修复位于不同本地提交，需要按文件和补丁组合；不是重写整个项目。
- **整合后新增问题已确认**：原子预算创建当日计数器时从零开始，遗漏同日已有 `ai_usage`。新增回归先复现，再让 SQLite 和 PostgreSQL 都从历史账本初始化计数器。

本轮仍未建立真实 PostgreSQL 服务或生产环境，相关完成度不能由 SQLite 测试、离线 SQL 或旧报告推导。

## 2. 代码来源及核心变化

### 已有工作整合

| 本地提交 | 整合内容 |
| --- | --- |
| `44a94e0` | Python commerce、迁移、到期释放、响应合同、测试和目录快照；Next 代理、购物车/订单组件、variant 购买控制及相关脚本 |
| `d005c04` | PostgreSQL TLS 服务器证书验证、显式 CA 配置及握手测试 |
| `c0e8980` | TTL 定期清理、容量/键/历史长度上限及有界护栏测试 |
| `8f1d7a6` / `b345188` | 服务端 Session、可信 peer IP 判断和带签名/过期时间的 AI Cookie |
| `89b610e` | 数据库原子预算预占、结算和释放 |
| `bbf781b` | 独立业务异常及 API 错误映射 |

按选定路径恢复并逐个核对补丁，未整树覆盖其他工作区；API 合并保留 Pydantic `response_model` 与函数作用域数据库依赖。未变更 package manifests、锁文件或安装大型依赖，未整合另一个工作区的 Fontsource 方案。

### 本轮补充修复

- `src/server/search/repository.ts`、`repository-postgres.ts`：预算日计数器首次写入包含已有用量，仍在事务和原子容量判断内执行。
- `src/server/guardrails/budget.test.ts`：已有用量 90、上限 100 时拒绝新增预占 20，允许 10。
- `src/server/ai/chat-budget.test.ts`：新增 provider 异常、超时、消费方中断释放，以及跨 UTC 日结算回归。
- `src/app/api/commerce/[...path]/route.ts` 及测试：上游 5xx 保留 HTTP 状态，但仅返回安全 `backend_unavailable`；拒绝路径也使用 `no-store`。测试确认伪造的内部密码内容不泄漏。
- `src/server/ai/chat.ts`、`backend/app/application/expiry.py`：普通错误日志不再打印原始异常或堆栈。完整结构化 request ID 观测仍是后续工作。
- `scripts/smoke-commerce.py`：支持 `--base-url`，增加跨会话订单拒绝和跨来源写入拒绝；原有重算价格、幂等、禁用支付及取消恢复库存验收保留。
- `eslint.config.mjs`：忽略本地 `.vitest` 产物；构建生成的 `next-env.d.ts` 由当前 Next.js 更新为生产类型路径。

其余核心恢复路径包括 `backend/app/{api,application,domain,infrastructure,schemas}`、`backend/tests`、`src/domain/commerce*`、`src/lib/commerce-client*`、`src/components/shop/commerce-panel*`、商品购买控制、AI 请求边界和数据库 TLS 测试。配置/文档同步于 `.env.example`、README、backend README、HANDOVER 和本报告。

## 3. 数据库、配置及边界

- Python commerce 使用 Alembic：恢复已有 `41e28c896353_initial_commerce` 和 `a682dde201b4_reservation_expiry`。没有另造 commerce revision；启动不使用 `create_all()` 建正式业务表。
- TypeScript 现有双数据库初始化机制新增 `ai_budget_days`、`ai_budget_reservations`；与原三张表合计五张。生产变更管理及 PostgreSQL 在线升级仍需单独验收。
- 本轮创建的是 `.vitest/unified-baseline-20260930/commerce-smoke.db` 和 `catalog-smoke.db`；没有迁移、改写或重置原 `backend/commerce.db`、`data/local.db`、`.env.local`。
- 新配置：`AI_SESSION_SECRET`（生产至少 32 字节私密签名材料）、`TRUSTED_PROXY_IPS`（精确可信直接 peer 列表）、`PG_SSL` / `PG_SSL_CA_FILE`、`PYTHON_API_URL`、`SHOPIFY_ENABLED=false`。不把示例值当作真实凭证。
- 生产 PostgreSQL 默认验证证书，禁止生产明文或关闭验证；系统信任根或显式 PEM CA 必须真实可信。
- 浏览器不决定交易金额、库存、所有权或订单状态；Python 重新计价，金额为 Decimal/字符串快照，库存和订单写入在事务内完成。Mock 支付只返回禁用状态，不扣款、不标记 paid。
- AI Cookie 带签名和期限；服务端控制 Session。没有可信 peer 时忽略客户端伪造 XFF，使用保守共享 IP 桶。实际部署代理必须提供可验证 peer 并清洗转发头。
- Rate/session/history 仍在单进程内，禁止宣称多实例安全。原子预算在数据库内，并不代表其余限制已共享。

## 4. 实际验证结果

运行环境：Windows、Node `24.20.0`、npm `11.19.0`、Python `3.12.14`、Next.js `16.3.4`。编辑 Route Handler、环境配置前已读取当前安装版本本地 Next.js 文档。

### 起始基线

| 检查 | 本轮起始实际结果 |
| --- | --- |
| `npm test` | 64 个文件、389 个测试通过 |
| `npm run lint` | 通过 |
| `npm run build` | 失败：cart、checkout、orders 引用缺失 commerce-panel |
| Python 基线 | 无法执行：当前树缺少源码，先恢复已有实现 |

Vitest/ESLint/Python 临时目录以及一次 Tailwind 构建在受限环境中遇到 Windows `EPERM`；授权执行后通过。权限错误与实际缺失模块的构建错误分别记录，不将前者冒充业务失败。

### 整合后的最终检查

| 实际命令或步骤 | 结果 |
| --- | --- |
| `npm run verify` | 通过；包括格式、类型、前后端边界、lint，**73 个测试文件 / 518 个测试** |
| `npm run build` | 通过；45 个静态页面，commerce 代理路由存在 |
| Python pytest（下列隔离命令） | **51 passed**；2 条第三方弃用警告，未屏蔽 |
| `ruff check app migrations tests ../scripts/smoke-commerce.py` | 通过 |
| `ruff format --check app migrations tests ../scripts/smoke-commerce.py` | 31 个文件通过 |
| `mypy --cache-dir ../.vitest/unified-baseline-20260930/mypy` | 20 个源文件通过 |
| `compileall -q app migrations tests` | 通过；pycache 重定向至 `.vitest`，不改旧跟踪字节码 |
| 独立 SQLite：`alembic upgrade head` / `alembic check` / `app.seed` | 通过；无新升级操作，已有库存不被 seed 重置 |
| PostgreSQL `alembic upgrade head --sql` | 离线 SQL 生成通过；**不等同于 PostgreSQL 运行时验收** |
| `python -B scripts/smoke-commerce.py --base-url http://127.0.0.1:3100` | 两服务 HTTP smoke 通过 |
| 浏览器人工操作 | 变色、选 US 8.5 / EU42、加购、数量改为 2、预览 USD118、建待支付订单、永久链接读取、取消全部通过 |
| 浏览器订单库存复查 | 同一 Ivory/EU42 变体从 10 → 8 → 10；取消页面明确显示已释放库存 |

Python 最终测试实际从 `backend` 执行：

```powershell
.venv/Scripts/python.exe -B -m pytest -q `
  --basetemp ../.vitest/unified-baseline-20260930/pytest-final `
  -o cache_dir=../.vitest/unified-baseline-20260930/pytest-cache-final
```

生产构建/本地 Next 服务使用进程级 `DB_DRIVER=sqlite`、`CATALOG_SOURCE=seed`、`AI_DISABLE_REAL=1`、`SHOPIFY_ENABLED=false` 和独立 `DATABASE_URL`。Next 监听 3100，Python 监听 8100，仅 loopback；测试 Session 签名材料只存在进程环境中，未写入文件或输出。

HTTP smoke 覆盖页面 200、HttpOnly 会话代理、购物车增改、拒绝伪造价格、后端重算、重复幂等键返回同订单、跨会话 404、跨来源 403、支付禁用、取消及库存恢复。

浏览器证据在本地忽略目录 `.vitest/unified-baseline-20260930/order-pending.png`、`order-cancelled.png`。这仅是本地演示数据库的测试订单，无真实交易。验收后已停止本轮启动的两个临时服务，使用下方命令可重新启动。

**未执行**：真实 PostgreSQL 迁移/事务/并发集成、真实数据库 TLS 连接、云端 CI、部署、正式 URL/SEO 复测、Lighthouse/移动端性能量化、真实 AI provider 计费验证。原因是本轮未建立或授权对应外部环境；本地 TLS 握手测试使用模拟端点。

## 5. 本地启动与完整流程

以下命令使用新演示数据库，避免修改已有业务文件；已安装本轮验证所需环境时不必重新安装。首次缺少虚拟环境/依赖时按 backend README 的锁定版本安装。

终端一：

```powershell
cd F:/shoe-online-store-demo
New-Item -ItemType Directory -Force .vitest/manual-commerce | Out-Null
cd backend
$env:DATABASE_URL = 'sqlite:///F:/shoe-online-store-demo/.vitest/manual-commerce/commerce.db'
$env:PYTHONDONTWRITEBYTECODE = '1'
.venv/Scripts/python.exe -m alembic upgrade head
.venv/Scripts/python.exe -m app.seed
.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

终端二：

```powershell
cd F:/shoe-online-store-demo
$env:DB_DRIVER = 'sqlite'
$env:DATABASE_URL = './.vitest/manual-commerce/catalog.db'
$env:CATALOG_SOURCE = 'seed'
$env:PYTHON_API_URL = 'http://127.0.0.1:8000'
$env:SHOPIFY_ENABLED = 'false'
$env:AI_DISABLE_REAL = '1'
npm run dev
```

访问本地 `/product/dc-1001`，选颜色和明确尺码 → 加入购物车 → 修改数量 → 结账预览 → 创建 `pending_payment` 订单 → 查看“支付暂未开放” → 取消并核对库存。订单链接只在所属购物会话内可读。

终端三执行可重复 HTTP 验收：

```powershell
cd F:/shoe-online-store-demo
backend/.venv/Scripts/python.exe -B scripts/smoke-commerce.py --base-url http://127.0.0.1:3000
```

`npm run build` / `npm run start` 属于生产模式，必须另行提供合格的私密 `AI_SESSION_SECRET`；不要提交或复制示例固定密钥。开发模式的临时签名材料会随进程重启失效。

## 6. 未实现内容、风险和下一阶段

1. **生产可靠性门禁尚未完成**：建立真实 PostgreSQL 环境，验证迁移、预算并发、库存锁、幂等冲突、失败回滚、CA/主机名拒绝和连接池行为。离线 SQL 与 SQLite 不替代这些测试。
2. **预算恢复**：用量仍是估算，不是 provider 账单；已测试正常失败/超时/中断释放，但进程崩溃后的遗留 reservation 回收尚未实现。
3. **部署边界**：Python 必须保持内部访问；匿名 UUID 是 bearer 凭证，不是公网 API 身份系统。共享限流、共享回合状态和多实例到期任务协作仍需设计，当前不引入 Redis。
4. **目录和金额政策**：展示目录与 Python 目录是显式快照关系，尚无持续同步/差异传播。演示价和 10 件初始库存不是实际经营数据；税、运费、优惠和真实支付未实现。
5. **观测和错误合同**：业务异常、成功响应和前端解析已覆盖；完整 request ID、所有 422/500 的统一合同、审计运营看板仍待补齐。监控应包含 5xx/P95、预算拒绝和遗留预占、库存冲突、到期释放失败及护栏容量拒绝。
6. **性能/SEO**：目录列表仍有逐商品查询优化空间，移动端及关键接口负载未量化；未修改既有 SEO 页面或宣布线上收录问题解决。
7. **仓库卫生**：HEAD 中原有已跟踪数据库、旧 pycache/日志仍存在；新增忽略规则不会自动移除已跟踪文件。本轮不删除用户数据，后续应单独审查备份和移出版本管理。
8. **界面微调**：桌面闭环可用；订单状态两个文本操作之间的视觉间距较紧，可在后续可访问性/移动端检查中一并调整。

## 7. 回滚和交接

当前结果是同一分支中的**未提交工作树**，可直接审查差异。本轮没有修改部署或原业务数据库，因此无需对原业务数据执行降级。临时测试库保留测试订单及审计记录，不以删除数据作为回滚步骤。

回滚前先备份完整当前工作树及初始未提交文档；按本报告文件组逐项撤回本轮补丁/新增源文件，README 和 HANDOVER 只撤回本轮增量，保留原交接入口及正文。不要使用 `git reset --hard`、`git clean` 或直接降级用户数据库；没有 commit 时，单一 Git 反向提交无法完整恢复初始脏工作树。

可快速降级真实 AI 调用为 `AI_DISABLE_REAL=1`，但不得通过放松 TLS、关闭所有权检查或开启真实支付来“恢复可用”。后续从本报告的真实 PostgreSQL 门禁继续，不再将旧 HANDOVER 历史段落中的“源码缺失”当作当前状态。
