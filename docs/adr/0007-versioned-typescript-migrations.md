# 0007 — TypeScript 展示库使用版本化 Drizzle 迁移

**状态：** 已采纳 · **日期：** 2026-10-03

## 背景

TypeScript 展示/AI 数据库原先在 `src/db/client.ts` 中维护 SQLite 和 PostgreSQL
两份运行时内联 DDL。这个形态能让空库启动，但无法记录 schema 版本，也不能安全地
接管已经保留数据的数据库。Python commerce 的交易表已经由 Alembic 管理，不能把两套
业务边界混成一个迁移系统。

## 决策

保留 Drizzle 双方言 schema 作为表结构真源，使用 `drizzle-kit` 生成并提交：

- `drizzle/sqlite`：`better-sqlite3` 运行时迁移；
- `drizzle/postgres`：`postgres.js` 运行时迁移；
- `src/db/client.ts`：`createDb()` 使用 SQLite migrator；`ensurePgTables()` 使用
  PostgreSQL 单事务 runner，并在同一连接上取得 advisory transaction lock；
- `drizzle` 元数据表记录已应用迁移，重复打开不会重复执行。

初始迁移的表、索引和唯一索引使用 `IF NOT EXISTS`，因此旧版内联 DDL 已创建的表和
数据可以被新版本接管。基线迁移不包含删除或重建数据的语句。后续 schema 变化必须
同时更新双方言、生成双方言迁移，并补充迁移升级/兼容测试。

PostgreSQL migrator 不直接使用 Drizzle 默认实现，因为该实现会在事务外读取最后
一个 marker；多实例同时启动时可能重复执行同一迁移。自定义 runner 在
`pg_advisory_xact_lock` 后于同一事务内读取 marker、执行文件和写入 marker，失败时由
数据库回滚并释放锁。真实 PostgreSQL 并发测试仍需专用 `_test` 数据库。

Next.js 的 `outputFileTracingIncludes` 显式包含两个 SQL 目录，确保 standalone 或
托管部署的服务器运行时能读取迁移文件。运行时仍自动初始化空库，开发环境不需要
额外手工迁移步骤。

## 边界和回滚

这些迁移只负责五张 TypeScript 展示/AI 表：`products`、`product_embeddings`、
`ai_usage`、`ai_budget_days` 和 `ai_budget_reservations`。价格、库存、订单和支付
仍以 Python commerce 与其 Alembic 迁移为准。若后续迁移需要破坏性变更，先提交向前
修复、备份和回滚方案；不得用运行时 `create_all()` 或手工 SQL 替代版本记录。

## 证据

`src/db/migrations.test.ts` 覆盖空库五表初始化、重复打开的单次应用、旧内联 DDL
数据保留和索引接管；`src/db/postgres-migrations.test.ts` 覆盖 advisory lock 顺序和
marker 写入；`npm run build` 还需检查生产 trace 是否包含两个 SQL 目录。
