# PostgreSQL 实际验收 — 2026-10-01

工作区 `F:/shoe-online-store-demo`，分支 `sql-certificate-and-AI-stock`。在 `4177ec5`、`847e32e` 的统一基线上继续阶段 C；用户授权本地提交，未 push、部署或修改正式数据库。

## 范围与已确认问题

此前 PostgreSQL 测试只有入口，缺少实际执行证据。本轮启动独立的 loopback PostgreSQL，实际验证 commerce、预算和 TLS。真实并发暴露同一请求结算/释放时部分重试错误返回 false；为每个预算请求增加事务级 advisory lock，锁在提交/回滚时自动释放。日总量仍由条件 UPDATE 原子控制，锁不会代替日容量检查。

预占重试必须匹配日期和预占 token；结算必须沿用预占 UTC 日期。SQLite 同步这两个身份校验，不改变交易数据库或订单逻辑。`src/server/search/repository-postgres.integration.test.ts` 每次只创建/清理随机的自有 schema，拒绝非 loopback、非 `_test` 数据库和自定义 options。

`src/db/postgres-tls.integration.test.ts` 使用真实 PostgreSQL SSL 协商、真实应用客户端与 SELECT：生产不信任的证书失败；显式可信 CA 和正确 hostname 成功且 `pg_stat_ssl.ssl=true`；可信 CA 与错误 hostname 失败。现有模拟端点握手测试仍保留。新增测试 URL 仅在 `.env.example` 注释，不改真实环境文件。

`.github/workflows/verify.yml` 的 PostgreSQL job 现在同时运行 Python commerce 与 TypeScript 预算，并配置临时服务器 TLS 运行上述验收。没有新增依赖、业务字段或 Alembic revision。

## 独立服务来源

- PostgreSQL 16.4 Windows 官方分发包：`https://get.enterprisedb.com/postgresql/postgresql-16.4-1-windows-x64-binaries.zip`。
- 包大小 338727828 字节，SHA256 `3508D8F085BC3980F38211A82E3F31E5FCAE9952105D3DC2F8BE67B64A822BAA`。这是本次测试版本，不是最新生产版本推荐。
- 程序、测试 cluster、日志全部放在忽略目录 `.vitest/postgres-runtime/`，仅监听 `127.0.0.1:55439`，使用独立 `commerce_test` 数据库。
- 本地 disposable cluster 使用 trust 登录，TLS 用仓库公开测试证书；这些设置不可复制到生产。没有安装系统服务，没有使用业务数据。

## 实际命令与证据

从 backend 执行（完整测试同时覆盖 SQLite/PostgreSQL）：

```powershell
$env:PYTHONDONTWRITEBYTECODE='1'
$env:COMMERCE_TEST_POSTGRES_URL='postgresql+psycopg://postgres@127.0.0.1:55439/commerce_test'
.venv/Scripts/python.exe -B -m pytest -q --maxfail=2 `
  --basetemp ../.vitest/reliability-20261001/pytest-postgres-first `
  -o cache_dir=../.vitest/reliability-20261001/pytest-cache
```

结果 **112 passed，无 skip**。包含实际 PostgreSQL 升级/降级、schema 一致性、库存竞争、幂等、权限和失败回滚。三条警告：两条既有第三方弃用，另有 Windows 测试缓存权限提示，不影响测试通过。

从根目录执行：

```powershell
$env:AI_TEST_POSTGRES_URL='postgresql://postgres@127.0.0.1:55439/commerce_test'
$env:AI_TEST_POSTGRES_TLS_URL='postgresql://postgres@localhost:55439/commerce_test'
npm test -- src/db/postgres-tls.integration.test.ts `
  src/server/search/repository-postgres.integration.test.ts src/server/guardrails/budget.test.ts
npm run typecheck
```

结果 **3 文件 / 17 测试通过**；类型检查通过。预算包含独立连接竞争、重复预占/结算/释放、用量写入失败事务回滚、旧 ledger 初始化，以及日期/金额身份校验。TLS 的三项全部实际运行，没有以 skip 充当验收。

最终 `npm run verify` 通过：格式、类型、边界、lint 及 **75 文件 / 531 项测试**（包含上述真实 PostgreSQL 测试，无 skip）。`npm run build` 通过，生成 45 个静态页面。首次 verify 被既有 `backend/.pytest_cache` 的沙箱读取权限阻塞；同一命令在获准的权限环境重跑成功，没有删除缓存或降低规则。

远端 CI、生产托管证书轮换、线上发布、线上 SEO 和移动性能：**未执行**；本轮只具备本地独立服务，没有发布操作。

## 启动、限制与回滚

用户应用启动沿用 README：backend 完成独立库 Alembic/seed 后运行 Uvicorn 8000，根目录 `npm run dev`。浏览 variant → 购物车 → 后端重算 → pending_payment 订单 → 未开放支付 → 取消。此次没有前台设计或启动配置变化。

预算仍按字符估算而非 provider 账单；已识别流中断释放可能漏记费用、进程崩溃 pending 无恢复，作为下一步安全工作。Session/IP 内存状态仍限单实例，持续目录同步仍未实现，不能据此宣布阶段 C 全部完成。

监控日用量/预占、预算拒绝、provider 失败、数据库锁等待和事务回滚；请求 ID 不作高基数指标。Advisory lock 同哈希碰撞只增加等待，不会绕过日容量条件。没有业务 migration；代码回滚用独立提交的 revert，不能回退到旧 TLS 绕过。测试 schema 清理由测试自己执行；强制杀进程可能留下 schema，人工清理前必须确认名称与归属。
