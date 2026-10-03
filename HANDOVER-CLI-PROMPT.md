# Aider 自动推进交接提示词

把下面整段作为后续 Aider 会话的初始提示词。它描述的是当前仓库事实和已授权的推进方式；执行前仍以实际代码、测试输出和 Git 状态为准。

建议从仓库根目录启动 Aider，并让它先读取维护规则和交接事实：

```powershell
cd F:\\shoe-online-store-demo
aider --no-auto-commits --read AGENTS.md --read README.md --read HANDOVER.md --read HANDOVER-CLI-PROMPT.md
```

在 Aider 会话中只用 `/add` 加入本次小步需要编辑的文件；不要加入或删除用户的教学文档。使用 `/run` 或 Aider 的 PowerShell 执行能力运行验证命令，但把 Git 暂存和提交留到验证通过之后手动完成。

```text
你是 Aider，会在 F:\\shoe-online-store-demo 中作为长期维护 Agent 工作。继续推进当前项目，不要从头重写，不要只给方案。用户已经授权你在本地小步修改、运行检查和创建 Git commit；不要重复请求这些权限。不要 push、部署、删除数据、重置工作区或安装改变技术方向的大型依赖。

Aider 工作方式：
- 开始时先执行 `git status --short --branch`、`git log -5 --oneline`，并阅读 `AGENTS.md`、`README.md`、`HANDOVER.md` 和本提示词。
- 用 `/add` 只加入当前小步的目标文件；用户已有的 `docs/从最小后端到交易闭环-图解教学-2026-09-30.md` 不加入上下文、不编辑、不删除、不提交。
- 先说明本步目标、根因、文件范围、验证和回滚，再编辑。不要停在计划阶段。
- 修改后先执行受影响测试，再执行本提示词要求的门禁。测试失败时先判断是代码、依赖、环境还是可选集成缺失；不要为了掩盖失败改写测试。
- 不使用 Aider 的自动提交；验证通过后用 PowerShell 明确执行 `git diff --cached --check`、`git diff --cached` 和 `git commit`。每次只提交一个范围清楚的小步。
- 每次提交后复核 `git status --short`、`git log -1 --oneline`，确认没有把用户文档、`.env`、数据库、缓存或构建产物带入提交。

【当前目标】
按阶段 C 的生产可靠性路线完成可验证的小步：先把现有 PostgreSQL/AI/交易边界验证完整，再处理有证据的缺口；每个小步都要实现、测试、更新交接证据并提交。不得用 SEO、页面美化或局部新发现掩盖交易、安全、数据一致性问题。

【当前工作区事实】
- 工作目录：F:\\shoe-online-store-demo
- 分支：sql-certificate-and-AI-stock
- 当前基准 HEAD（生成本提示词时）：a8208e0；Aider 启动时必须以 `git log` 的实际 HEAD 为准。
- 最近相关提交：
  - a8208e0 fix: serialize PostgreSQL schema migrations
  - d22ab62 chore: require explicit production environment preflight
  - ab3ab33 fix: bound trusted proxy IP input
  - 4aedf09 fix: lock Python production environment mode
  - ffc474f feat: version TypeScript database migrations
- 当前不 push、不部署。工作区中用户已有的未跟踪文件
  docs/从最小后端到交易闭环-图解教学-2026-09-30.md 必须保留，不能暂存或删除。
- 不要把历史报告中的旧分支、旧 SHA、旧测试数量当成当前事实。

【已经实现的边界】
1. Python commerce 是价格、库存、订单、变体可售状态和支付状态的真值；TypeScript 展示目录、客户端和 AI 不能决定这些值。
2. 真实支付未启用。MockPaymentProvider 不扣款、不把订单改为 paid；Shopify 兼容入口默认关闭。
3. Python 生产 PostgreSQL 必须使用显式主机名和 sslmode=verify-full；SQLite 和弱 TLS 仅限开发/测试。NODE_ENV=production 不能把 APP_ENV 降级到 development。
4. 根目录 scripts/preflight.ps1 在生产模式要求显式 APP_ENV=production，并检查 PostgreSQL、TLS、AI_SESSION_SECRET、COMMERCE_PROXY_SECRET、非回环 PYTHON_API_URL 和 Shopify 关闭。Pester 覆盖缺失、错误、正确 APP_ENV。
5. AI 请求体、输出、回合、预算、Session、可信代理 IP 和内存护栏已有边界；进程内限流/Session/history 仍只支持单实例，不能宣称多实例安全。
6. TypeScript 展示/AI 五张表已有 drizzle/sqlite 和 drizzle/postgres 版本化迁移；Python commerce 交易表仍只由 Alembic 管理。
7. src/db/client.ts 的 ensurePgTables() 已改为 postgres.js 单 client.begin 事务：先执行 pg_advisory_xact_lock(hashtextextended('evoloop:postgres-schema-migrations', 0))，再创建/读取 drizzle 迁移表、执行 readMigrationFiles 返回的 SQL、写入 marker。事务失败会回滚，WeakMap pending 会清理以便重试。
8. 目录停售传播、稳定 variant_id、购物车/库存预占、pending_payment 订单、取消释放库存、响应模型、内部代理认证和目录漂移检查已有实现与报告；不要重复重写。

【当前优先顺序】
第一步：在实际可用的专用 PostgreSQL 测试库上验收 TypeScript 迁移锁。
- 只使用独立、可删除、名称以 _test 结尾的数据库；不能使用业务数据库。
- 设置 AI_TEST_POSTGRES_URL 后运行：
  npm test -- --run src/server/search/repository-postgres.integration.test.ts
- 需要补充或扩展真实并发用例时，至少验证两个独立 client 同时 ensurePgTables() 只完成一份迁移，失败事务能重试，锁会在提交/回滚后释放。
- 没有该环境时不要伪造通过：保留当前 fake-client 证据，并在报告中写“真实 PostgreSQL 并发未执行”。不要为了这一步临时引入 Redis 或替换迁移框架。

第二步：根据实际测试结果修复迁移边界。保持 SQL 双方言、生产文件追踪和旧 inline DDL 数据接管；不要改 Python Alembic 交易迁移，不要把展示库当交易真值。

第三步：扩大验证范围。按影响范围运行前端 verify/build；涉及 backend/commerce 时运行 Python compileall、ruff、format、mypy、alembic check、pytest 和对应 smoke。每次都运行 npm run check:coupling，并记录模块数、运行时边数、循环和边界违规结果。

第四步：只有有容量证据时才评估共享限流/Session/预算状态。当前不引入 Redis、Celery 或微服务；若未来确有多实例需求，先提交容量数据、接口、fail-open/fail-closed、迁移、回滚和监控方案。

【强制工作流程】
1. 定位：先读 AGENTS.md、README.md、HANDOVER.md、相关 ADR/报告和目标代码；执行 git status --short --branch、git log -5 --oneline。确认实际分支和未跟踪文件。
2. 分级：把目标归为阻塞、安全、数据一致性、功能、性能或 SEO/GEO；先处理高优先级且与当前小步直接相关的项。
3. 计划：编辑前列出目标行为、文件边界、兼容性、迁移/回滚、测试和观测方式。不要顺带修 unrelated 的局部问题。
4. 实现：沿用现有 Drizzle、Alembic、FastAPI、Next Route Handler、Pydantic、Zod/解析器和仓库接口。Application 层不能导入 FastAPI；Client Component 不能运行时导入 src/server/**。
5. 验证：先跑受影响测试，再跑 typecheck、format、lint、build、backend 检查、耦合检查和必要的集成/并发测试。失败时区分代码失败、环境缺失和可选集成未配置。
6. 复核：检查客户端是否提交了价格/库存/订单状态、事务是否完整提交/回滚、订单是否幂等、所有权是否验证、日志是否泄露 Token/Cookie/连接串/个人数据、查询是否有 N+1、缓存是否隔离。
7. 文档：在 docs/ 写简短日期报告，记录事实、修改、命令、实际结果、未执行项目、风险、监控和回滚。更新 HANDOVER.md 顶部索引，但不要改写旧历史为今天通过。
8. 提交：只暂存本次明确文件；先 git diff --cached --check 和 git diff --cached，确认没有 .env、数据库、缓存、构建产物和用户教学文档，再创建一个说明行为的本地 commit。提交后复核 git status；不要 push。

【常用验收命令】
前端：
  npm run verify
  npm run build
  npm run check:coupling
  npm test -- --run <受影响测试>
生产配置：
  $env:APP_ENV = 'production'
  npm run preflight -- -Environment production
  pwsh -NoProfile -Command "Invoke-Pester -Script scripts/preflight.test.ps1 -EnableExit -PassThru"
后端：
  backend/.venv/Scripts/python.exe -m compileall app
  backend/.venv/Scripts/python.exe -m ruff check app migrations tests
  backend/.venv/Scripts/python.exe -m ruff format --check app migrations tests
  backend/.venv/Scripts/python.exe -m mypy
  backend/.venv/Scripts/python.exe -m alembic check
  backend/.venv/Scripts/python.exe -m pytest -q

【禁止越过的边界】
- 不让客户端、AI 或展示目录决定价格、库存、可售状态、订单状态、支付结果、Session 所有权或资源所有权。
- 不用运行时 create_all() 代替 Python 正式迁移；不手工删除迁移 marker；不把真实支付或 Shopify 打开。
- 不把本地 fake、SQLite、测试文件数量或本地 build 当成线上部署证明。
- 不因一次局部发现重写目录、支付、AI 或数据库架构；不默认增加共享基础设施。
- 不记录密码、Token、Cookie、完整连接串、证书内容、内部异常堆栈或不必要的订单个人数据。
- 不 reset、clean、checkout --、删除用户文件；发现用户改动时与其共存。

【每步交付格式】
用中文简要说明：当前问题与根因；修改文件和技术实现；数据库/配置/兼容性影响；实际运行的命令和结果；未执行及原因；安全、事务、所有权、性能、SEO/GEO 影响；已知风险、监控、回滚 commit；下一步唯一优先事项。不要只汇报失败列表，也不要把未验证内容写成已完成。
```

本提示词只负责把后续 CLI Agent 带回正确路线；真实环境、数据库、证书、代理和部署状态仍必须通过命令重新验证。
