# TypeScript 数据库迁移报告 — 2026-10-03

本轮把展示目录和 AI 使用量数据库从 `src/db/client.ts` 的运行时内联 DDL 收敛为
Drizzle 版本化迁移。Python commerce 的 Alembic 目录和交易 schema 没有改动。

## 实现

- `src/db/schema.ts` 和 `src/db/schema-postgres.ts` 继续定义双方言表结构与索引。
- `drizzle/sqlite/0000_wakeful_major_mapleleaf.sql` 和
  `drizzle/postgres/0000_dusty_purifiers.sql` 是提交的初始迁移及其 metadata 快照。
- `createDb()` 使用 `drizzle-orm/better-sqlite3/migrator`；`ensurePgTables()` 使用
  `drizzle-orm/postgres-js/migrator`，失败时清除 WeakMap 状态以允许下一次重试。
- 初始 SQL 保留 `IF NOT EXISTS`，兼容历史 inline DDL 数据库；Drizzle metadata
  保证同一迁移只应用一次。
- `next.config.ts` 显式追踪两个 SQL 目录，避免生产运行时文件缺失。

## 验证

`src/db/migrations.test.ts` 已验证：

1. 空 SQLite 数据库创建五张表；
2. 同一文件重复打开保留商品数据，metadata 只有一条迁移记录；
3. 旧 inline DDL 创建的五张表可被接管，既有商品行保留且缺失索引被补齐。

PostgreSQL 迁移路径仍需在配置测试数据库的环境执行
`src/server/search/repository-postgres.integration.test.ts`；本机未配置独立 PostgreSQL
测试库时不能把 SQLite 结果当成 PostgreSQL 集成证据。
