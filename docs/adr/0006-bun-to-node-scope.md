# 0006 — 包管理器层去 Bun，推迟到独立分支执行

**状态：** 已采纳（延期执行）· **日期：** 2026-09-15

## 背景

项目最初全栈构建在 Bun 上。2026-09-07 的部署失败诊断（见 spec 决策日志与
`docs/implementation-report.md`）已经**把运行时那一半去掉了**：

- `dev` / `build` / `start` 去掉 `bun --bun`，Next 一律由 Node 执行 —— `bun --bun next build`
  会让 Next 跑在 Bun 运行时上并以 SIGILL 崩溃（编译全过，纯 Bun 崩溃）；
- `bun:sqlite` 换成 `better-sqlite3`（Node 原生、Vercel 友好、Bun 经 N-API 亦可用）；
- `verify` 脚本**本来就**委托给 `npm run format:check && npm run typecheck && npm run lint && npm run test`；
- CI 同时安装 Bun 与 Node 24。

也就是说：**`src/` 与 `scripts/` 中已不存在任何 Bun 专有 API**（经扫描确认），运行时零 Bun 依赖。

**只剩包管理器与锁文件层**：`package.json` 的 `packageManager: bun@1.3.14`、Bun 专有的
`ignoreScripts` / `trustedDependencies` 字段（`sharp` / `unrs-resolver`），以及 313KB 的文本
`bun.lock`。

## 决策

承认这一层值得清理，但不在本轮重构里做。

理由：这是**零运行时收益**的纯工具链替换，而它的成本正落在本轮重构最脆弱的地方 ——
「294 个测试保持绿色 = 行为未变」这个等价性证明。

- 重生成锁文件会**移动传递依赖的解析结果**。任何一处 minor 漂移都会在迁移故障时与重构改动
  混在一起，使归因变得不可能。
- 一次 mid-refactor 的 `bun.lock` → `package-lock.json` 切换会让每个后续批次的 diff
  都夹带锁文件噪音。

因此：**推迟到批次 7，在独立分支 `chore/de-bun-package-manager` 上执行，前置条件是批次 1–6
已全部落地并提交、工作区干净、verify 与 build 全绿。** 推荐 npm（`verify` 已经 shell 到 npm，
CI 已经装 Node）。

## 后果

#### 正面

- 重构期的等价性证明保持完整：src/ 一行未动，测试数只增不减。
- 批次 7 的失败与批次 1–6 的失败在时间与分支上**可归因**。

#### 负面 / 需要持续承担

- Bun 的包管理器层继续存在，`bun install` 仍是文档中的默认安装方式。
- 批次 7 有一次性的锁文件漂移需要逐项审阅（vitest / next / eslint / typescript /
  better-sqlite3 / tailwindcss），并需重新验证 `better-sqlite3` 的 N-API 原生模块重建。

**批次 7 允许以「不做」结束。** 退出条件是：冷启动 `npm ci` + `npm run verify` 全绿、
CI 在 Node 20/22/24 矩阵上全绿、且 `src/` 相对重构基线 `git diff` 为空。
若漂移无法解释，则回退 `bun.lock` 与 `package.json`，保留 Bun 作为安装层，并把放弃原因记录于本文件。

## 相关

本计划批次 7 · `package.json` · `.github/workflows/verify.yml` · `docs/implementation-report.md`
