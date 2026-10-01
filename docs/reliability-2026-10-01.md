# 可靠性更新与提交记录 — 2026-10-01

工作区 `F:/shoe-online-store-demo`，分支 `sql-certificate-and-AI-stock`，日期使用 Asia/Shanghai。用户明确授权“可以自行提交，继续推进”。本轮只创建本地提交，不 push、创建 PR 或部署。

## 1. 已提交基线与本轮范围

上一轮已验证的 commerce 与安全整合提交为 **`4177ec5` — `feat: integrate verified commerce MVP and security guardrails`**。包含交易源码、现有迁移、安全修复和交接记录，没有夹带数据库、日志、环境密钥或字节码变化。原先未跟踪的教学文档继续保留为未跟踪文件，未擅自纳入提交。

本轮继续完成可验证的生产可靠性准备：

- **安全/错误合同**：原有业务异常已有安全响应，但请求校验会带出 Pydantic 输入详情，未捕获异常缺少统一 JSON 和追踪。
- **可观测性**：原请求日志缺少跨服务 request ID，直接记录实际 URL 路径。
- **数据库验收入口**：本机未发现 PostgreSQL/Docker 可执行程序或相应服务。先增加隔离测试与 CI 服务，明确真实 PostgreSQL 尚未执行。

未改变交易状态机、价格/库存权威来源、真实支付限制或前台页面设计；不进行 SEO 扩展。

## 2. 修改文件与行为

| 文件 | 变化 |
| --- | --- |
| `backend/app/main.py` | 校验/HTTP/业务/未知异常统一安全错误；生成或验证内部 UUIDv4 请求 ID；记录路由模板、状态、错误码和耗时 |
| `backend/app/schemas/responses.py` | 新增 `ErrorResponse`，OpenAPI 显式描述错误合同 |
| `src/app/api/commerce/[...path]/route.ts` | Next 自行生成 request ID 并传到 Python，忽略浏览器伪造 ID；404/403/503 补齐稳定 code |
| 对应 Python/TypeScript 测试 | 校验输入不回显、无内部异常泄漏、关联 ID、405 Allow 保留、响应失败和业务失败完整回滚 |
| `backend/migrations/env.py` | 支持显式注入连接用于隔离验收，普通 CLI 仍走原数据库配置，并释放连接池 |
| `backend/tests/conftest.py`、`postgres_support.py`、`test_postgres_integration.py` | 可选 SQLite/PostgreSQL 双运行；独立 schema、目标防误用、升级/降级/一致性检查 |
| `.github/workflows/verify.yml` | 增加 PostgreSQL 16 临时服务 job；现有前端和 SQLite jobs 保留 |
| `scripts/smoke-commerce.py` | 增加 request ID/no-store/422 隐私检查 |

没有新增业务字段、Alembic revision 或依赖。新增的 `COMMERCE_TEST_POSTGRES_URL` **仅为测试进程变量**，默认不连接 PostgreSQL；已在 backend `.env.example` 注释及 README 中说明，不写入真实 `.env`。运行环境配置和原业务数据库保持原样。

错误接口继续保留 HTTP 状态及业务 `{code, detail}`。明确的兼容变化是 422 的 `detail` 从 Pydantic 明细数组改为安全字符串；依赖该数组的外部调用方需要更新。前台原有错误处理已通过测试。`X-Request-ID` 是诊断关联值，不是身份、Session 或幂等键。

API 的未知异常在函数作用域数据库依赖回滚之后被转换为 500，不再向服务器异常日志抛出原始私密消息。当前 commerce 是普通 JSON 响应；响应已开始后的流式/后台异常不在此保证内。

## 3. 实际验收

| 命令/验证 | 本轮结果 |
| --- | --- |
| `npm run verify` | 通过：格式、类型、边界、lint；**73 个文件 / 520 个测试** |
| `npm run build` | 通过；45 个静态页面 |
| `python -B -m pytest -q`（隔离 basetemp，见下文） | **62 passed、1 skipped**；保留 2 条第三方弃用警告 |
| `python -B -m ruff check app migrations tests ../scripts/smoke-commerce.py` | 通过 |
| `python -B -m ruff format --check app migrations tests ../scripts/smoke-commerce.py` | 通过 |
| `python -B -m mypy --cache-dir ../.vitest/reliability-20261001/mypy` | 20 个源文件通过 |
| `python -m compileall -q app migrations tests` | 通过；pycache 输出重定向到忽略目录 |
| 新隔离 SQLite：`alembic upgrade head`、`alembic check`、`app.seed` | 通过；没有检测到 schema 差异 |
| `python -B scripts/smoke-commerce.py --base-url http://127.0.0.1:3110` | 通过；包括交易、越权、幂等、取消、库存恢复和新增错误/追踪断言 |
| 真实两服务请求 ID | 前端响应及 Python 应用日志匹配同一个服务端生成 ID，伪造客户端 ID 被忽略 |
| 停止测试后端后再请求代理 | 503、`backend_unavailable`、合法请求 ID、`no-store` 均验证通过 |

Python 完整验收实际从 backend 执行：

```powershell
.venv/Scripts/python.exe -B -m pytest -q `
  --basetemp ../.vitest/reliability-20261001/pytest-final `
  -o cache_dir=../.vitest/reliability-20261001/pytest-cache
```

初始新增测试有两类准备问题：首次未创建 basetemp 父目录；回滚断言误把 seed 的既有审计记录当作零。已分别创建隔离父目录、改为比较操作前后数量；最终整套测试通过。测试并未通过删除审计记录来消除差异。

**唯一 skip** 是真实 PostgreSQL 升降级/一致性测试，原因为没有 `COMMERCE_TEST_POSTGRES_URL` 和本地服务。此时共享 commerce 测试只运行 SQLite；配置测试 URL 后会额外运行 PostgreSQL 版本。尚未执行 GitHub 新 job，不把 CI 文件存在当作通过。

**未执行**：真实 PostgreSQL 事务/库存并发/迁移、生产 TLS 端到端、PostgreSQL AI 预算并发、远端 CI、线上部署与 SEO、移动端性能量化。没有相应运行环境或本轮发布操作。

## 4. 可复现启动与使用

沿用 [上一轮报告的独立数据库启动流程](./unified-baseline-2026-09-30.md#5-本地启动与完整流程)。终端一在 backend 启动：

```powershell
.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --no-access-log
```

终端二在根目录设置 `PYTHON_API_URL=http://127.0.0.1:8000`、`SHOPIFY_ENABLED=false`、`AI_DISABLE_REAL=1` 后执行 `npm run dev`。独立库配置和迁移/seed 命令见链接，避免直接修改已有业务库。

选择 variant → 加购 → 修改数量 → 创建待付款订单 → 查看支付未开放 → 取消恢复库存。排查错误时使用响应头 `X-Request-ID` 对照 Python 的结构化日志。启动加 `--no-access-log`，避免 Uvicorn 默认访问日志另行记录原始 URL/query；外部代理日志仍需执行同样的隐私策略。

本轮联调用独立库 `.vitest/reliability-20261001/commerce-smoke.db`，Next/Python 分别在 loopback 3110/8110。两个测试服务均已停止；没有触碰其他已有进程。

## 5. PostgreSQL 测试入口与限制

完整操作见 [backend README](../backend/README.md#postgresql-integration-tests)。测试 URL 只能指向数据库名以 `_test` 结尾的 PostgreSQL，拒绝用户传入 search-path options。每个测试生成新的 `commerce_test_<UUID>` schema，通过真实 Alembic 迁移和 seed 准备，完成后只清理该 schema；不会 drop 数据库/角色。连接安全参数如 `sslmode=verify-full` 保留。

PostgreSQL CI job 使用独立临时服务和示例测试凭证。它覆盖共享 commerce 的库存竞争、同幂等键、权限和失败回滚，并新增升级/降级验收；不覆盖真实支付、生产 TLS 或 TypeScript AI 预算。进程被强制结束可能留下测试 schema，需要人工确认后清理。

下一次首要工作是在可用 PostgreSQL 环境实际运行此 job/测试，按失败修复，不直接宣告阶段 C 完成。AI 遗留预算预占恢复、多实例共享状态、持续目录同步和性能工作仍未实现。

## 6. 影响、监控与回滚

- 安全：禁止回显验证输入、原始异常和内部地址；结构化应用日志使用路由模板，不包含请求体、Cookie、查询字符串或真实资源路径。
- 事务：本轮没有更改下单/取消逻辑；新增与更新的回归验证了 500 和响应校验失败后库存、订单项、预占与审计增量完整回滚。
- 性能：每次请求增加一次 UUID/小型 JSON 日志，没有增加业务查询；未执行负载量化。
- SEO/支付：未修改 SEO 页面，没有接入真实支付或开启 Shopify。
- 监控：按 `code`、`route`、`status` 汇总 5xx、校验/权限拒绝与耗时；request ID 仅用于检索关联，不作为指标高基数标签。
- 回滚：本轮可靠性改动作为独立后续提交，可在干净审查分支 `git revert` 该提交；无新业务 migration，无需降级业务数据库。基线 `4177ec5` 与本轮提交分开，便于独立审查。

保留原有未提交教学文档，不使用 reset/clean 清理工作区；临时验收数据库保留用于审查。
