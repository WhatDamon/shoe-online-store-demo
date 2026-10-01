# AI 预算恢复与流式边界 — 2026-10-01

工作区 `F:/shoe-online-store-demo`，分支 `sql-certificate-and-AI-stock`；在 PostgreSQL 修复提交 `128a762` 上继续阶段 C。用户已授权本地提交。此轮没有真实付费调用、push 或部署。

## 已确认的根因

1. 原 chat finally 会释放 provider 失败、超时和消费者中断的全部预算，尽管部分输出或服务端处理可能已经产生费用。
2. 进程崩溃后 pending 预占持久保留，没有可审计的恢复路径。
3. 完整回复超出预占且日 cap 不足时，结算会抛错，finally 又释放预占，漏掉已经完成的工作。
4. SSE 原 start 循环持续 enqueue，没有读取背压或显式取消。真实 SDK 默认自动重试两次，一份预占可能对应多次请求；其流式迭代器可以在取消/超时后静默结束，从而把部分输出当作完成。

## 实现与兼容性

| 核心文件 | 行为 |
| --- | --- |
| `src/server/search/repository.ts`、`repository-postgres.ts` | 原子 `abandonDailyBudget`；有界、按时间排序的恢复；结算照实保存完成用量，即使超出 admission cap；拒绝改变结算 token 总量的重试 |
| `src/server/guardrails/index.ts`、`budget.ts` | 每实例最多每分钟一次扫描，共享进行中的扫描；最多 100 项；最小年龄 max(5 分钟, 3×provider timeout+1 分钟)；数据库失败时拒绝新调用，下次重试 |
| `src/server/guardrails/budget-contract.ts`、`scripts/check-coupling.mjs` | 预算纯接口取代具体仓储类型依赖；新增循环/领域/护栏耦合门禁并加入 verify |
| `src/server/ai/chat.ts` | 区分 provider 已开始与未开始；失败前者保守计账，后者可释放；取消的回复不作为完整历史 |
| `src/app/api/ai/chat/route.ts` | 按 Web Stream pull 读取；取消终止生成器，关联请求 AbortSignal；不向已关闭流重复写错误 |
| `src/server/ai/provider.ts`、`openai-compat.ts` | 可选 signal，组合取消和截止时间，显式检查静默中断；关闭 SDK 自动重试和原始 SDK 日志 |
| `src/db/client.ts`、两个 schema | 新增 `(status, created_at, request_id)` 恢复索引，列不变 |
| `.env.example`、README、HANDOVER | 解释估算、保守计账、恢复触发、取消及测试证据 |

`abandoned` 为现有 text 状态的新值，不是完整回复。其 `actual_tokens` 存放本次保守计账量（等于 reserved estimate），不能解释为 provider 报告的精确用量。恢复只把 reserved 转为 used，绝不删除 ledger 或退还未知费用；日汇总包含这些量，`ai_usage` 仍只存完整回复。并发恢复/结算/释放由同请求事务锁串行化；已 abandoned 的工作不能再次结算或释放。

不增加业务字段、外部依赖或 Python Alembic revision。TS 展示/AI 库沿用当前 ADR 0003 的幂等 DDL，新索引在下次连接初始化建立，并在 ORM 双方定义同步；Python 交易库继续显式 Alembic。旧 ADR 假定临时空库，而当前预算需要持久性，这一生产约束必须另行评估，不能把函数临时 SQLite 文件当共享预算。

请求/响应 SSE 帧、签名 Cookie 和前台交互合同保留。自动重试改为由用户的新尝试触发，每次各自检查预算。保守失败计账可能更早触发预算拒绝，这是显式策略；不声称准确还原 provider 发票。

## 实际验证

定向预算测试命令（根目录，真实独立 PostgreSQL）：

```powershell
$env:AI_TEST_POSTGRES_URL='postgresql://postgres@127.0.0.1:55439/commerce_test'
npm test -- src/server/ai/chat-budget.test.ts src/server/guardrails/budget.test.ts `
  src/server/search/repository-postgres.integration.test.ts src/server/guardrails/index.test.ts `
  src/server/ai/chat.test.ts src/db/schema-parity.test.ts
```

结果 **6 文件 / 54 项通过**。覆盖恢复与结算/释放竞争、分批限制、 live pending 隔离、事务失败回滚、超额结算、恢复节流/失败重试、完整历史隔离和原聊天行为。首次一个测试错把 support 分支当本地确定性回复，实际 handler 会调用 provider；已改用真实 size-fit 分支验证未调用时释放，没有修改业务代码迎合错误断言。

`npm test -- src/app/api/ai/chat/route.test.ts src/server/ai/openai-compat.test.ts src/server/ai/chat-budget.test.ts` 验证路由读取上限、待处理读取取消、生成器清理及安全错误。SDK 测试使用真正安装的 SDK 和 loopback HTTP 网关，验证 500 单次请求、部分流取消/超时关闭连接、畸形 SSE 不输出私密内容，并贯穿 chat/数据库证明部分超时保守计账。所有测试网关在 finally 关闭，没有调用真实付费 API。

最终 `npm run verify` **通过**：格式、typecheck、服务端边界、耦合门禁、lint 及 **76 文件 / 553 项测试**。按用户后续要求完成预算接口解耦后，实际重新执行完整 verify 和 build。执行时同时设置 `AI_TEST_POSTGRES_URL` 与 `AI_TEST_POSTGRES_TLS_URL`，真实 PostgreSQL 预算和 TLS 项全部运行，无 skip。`npm run build` **通过**，生成 45 个静态页面；`git diff --check` 通过。耦合审计范围与保留风险见 [独立报告](./coupling-audit-2026-10-01.md)。

双服务 `backend/.venv/Scripts/python.exe -B scripts/smoke-commerce.py --base-url http://127.0.0.1:3110` **通过**：页面、加购、重算、幂等、所有权、Origin、禁支付、取消和库存恢复。隔离脚本 `.vitest/user-demo-20261001/smoke-ai.mjs` **通过**：实际 Next SSE、HttpOnly 签名 Cookie、忽略客户端 Session、完整预算结算；SQLite EXPLAIN 实际选择 recovery 索引。两者都只使用独立演示库。

首次开发服务 GET `/` 为 500，Turbopack 日志确认它被既有 `backend/pytest-cache-files-*` 目录的沙箱读取权限阻塞。停止本轮自建服务并在获准的权限环境重启后，同一 smoke 成功；没有修改页面或删除缓存来掩盖失败。

此轮 Python 源码未修改，沿用同轮此前独立 PostgreSQL/SQLite 的 **112 passed** 证据，不虚构额外执行。远端 CI、生产负载、线上部署和 SEO：**未执行**。

OpenAI 官方 libraries 文档的两个官方入口实际请求均返回 403；未据此宣称获取最新官方行为。SDK 的重试默认值、取消和日志配置由仓库已安装 7.10.x 的 README、类型、源码及上述实际运行确认。当前 Next.js 16.3.4 Route Handler 与环境变量本地文档已阅读。

## 使用、监控与回滚

本地启动继续使用 README 双服务命令：backend 独立库先 Alembic/seed，再 Uvicorn 8000；根目录设置 `PYTHON_API_URL`、`SHOPIFY_ENABLED=false`、`AI_DISABLE_REAL=1`，运行 `npm run dev`。商品 → variant → cart → preview → pending_payment → 取消闭环不变；聊天取消/失败仍展示现有安全文案。未接支付或 Shopify。

本轮另保留可直接体验的 loopback 服务：`http://127.0.0.1:3110/shop`，后端 `http://127.0.0.1:8110/health`。独立 SQLite 文件为 `.vitest/user-demo-20261001/storefront.db` 和 `commerce.db`；前端强制 Mock，Shopify 关闭，未覆盖真实 `.env`。后端 migration/seed 实际执行成功。停止这些服务后，重启对应端口的命令如下（分别在 backend 和根目录终端）：

```powershell
# backend 终端
$env:DATABASE_URL='sqlite:///F:/shoe-online-store-demo/.vitest/user-demo-20261001/commerce.db'
.venv/Scripts/python.exe -B -m uvicorn app.main:app --host 127.0.0.1 --port 8110 --no-access-log

# 根目录另一个终端
$env:DB_DRIVER='sqlite'
$env:DATABASE_URL='F:/shoe-online-store-demo/.vitest/user-demo-20261001/storefront.db'
$env:PYTHON_API_URL='http://127.0.0.1:8110'
$env:AI_DISABLE_REAL='1'
$env:SHOPIFY_ENABLED='false'
npm run dev -- --hostname 127.0.0.1 --port 3110
```

交付时 Next launcher/server PID 为 33676/42832，Python launcher/server PID 为 43576/27076；仅本机本次记录，后续停止前仍要核对归属。PostgreSQL 55439 临时验收 cluster 已通过 `pg_ctl -m fast -w stop` 停止，忽略目录产物保留供复核。

观测 pending 年龄/数量、abandoned 量、used/reserved、预算拒绝、provider 失败、数据库锁等待，以及安全日志 `[ai/budget] recovered uncertain reservations` 和 finalization failed。日志只带安全事件/批量数量，不输出 Session、内容、Cookie、内部地址或 SDK 原始异常。数据库不可用导致 finalization 失败时保留 pending，后续恢复；没有将失败伪装为释放成功。

预算仍以字符估算，并未读取 provider 精确 usage；embedding 调用尚不由这份聊天预算覆盖。限流和 Session 仍是有界单实例内存状态，未实现多实例共享。恢复是按请求触发，闲置期间不会扫描；迟于恢复窗口的调用结果被拒绝重新结算，保留较保守的账。历史审计行不自动删除。持续目录同步、真实部署 TLS/代理验证和性能指标仍待后续阶段 C 工作。

需要止损时先 `AI_DISABLE_REAL=1` 并重启，使预算恢复与安全代码继续生效。代码变更可用本轮独立提交 revert，但回滚后不能重新开启会退款未知费用的旧 provider 路径。保留已有日 counters 与 abandoned 行，不能删账本或把 used 清零；新增索引保留兼容，无需 downgrade。正式 TS 持久库备份/版本迁移仍需独立部署设计。
