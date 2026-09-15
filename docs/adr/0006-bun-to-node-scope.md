# 0006 — 包管理器层从 Bun 迁移到 npm

**状态：** 已完成（批次 7，分支 `chore/de-bun-package-manager`）· **日期：** 2026-09-15

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

- ~~Bun 的包管理器层继续存在~~ → 已在批次 7 移除，见下方执行结果。

**批次 7 允许以「不做」结束。** 退出条件是：冷启动 `npm ci` + `npm run verify` 全绿、
CI 在 Node 20/22/24 矩阵上全绿、且 `src/` 相对重构基线 `git diff` 为空。
若漂移无法解释，则回退 `bun.lock` 与 `package.json`，保留 Bun 作为安装层，并把放弃原因记录于本文件。

## 执行结果（批次 7，已完成）

选择 **npm**。退出条件的三个判据全部达成：

1. **冷启动**：`rm -rf node_modules && npm ci` 后 `npm run verify` 绿（63 文件 / 375 用例）、
   `npm run build` 绿（42/42 静态页）。
2. **CI 矩阵**：Node 20/22/24 三档。
3. **代码零改动**：`git diff --stat <批次 7 基点>..HEAD -- src/` 为**空**。
   迁移改动只落在 6 个文件：锁文件、`package.json`、CI、README、本报告。

### 版本漂移审计（对照迁移前 bun 安装的实测 714 包）

结论：**无一处无法解释的漂移。**

- **直接依赖无 major 变动。** `next 16.3.4` / `react 19.2.8` / `better-sqlite3 13.0.3` /
  `typescript 5.9.3` / `tailwindcss 4.3.3` / `eslint 9.39.5` / `drizzle-orm 0.45.2` 全部不变；
  有变化的均在声明的 `^` 范围内取 patch/minor。
- **8 处表面 major 漂移是度量假象。** `js-yaml` / `lru-cache` / `magic-string` / `picomatch` /
  `strip-ansi` / `tsconfig-paths` / `json5` / `globals` 的旧 major **仍原样留在顶层**，
  新 major 只出现在另一个消费方的嵌套目录下（例如 `lru-cache` 顶层仍是 5.1.1，
  11.5.2 只在 `jsdom` 下）。两个 major 共存是合法的，不是升级。
- **4 处移除是净收益。** `uuid` / `@types/uuid` / `@types/bun` / `bun-types` 全仓 0 引用，
  当前依赖树里也没有任何包依赖 `uuid`。其中 `bun-types` / `@types/bun` 是 **Bun 自动注入**的
  类型包，本就不该出现在 npm 锁文件里。

### 意外发现：npm 12 默认阻止 install script

这是本批最重要的意外发现，它使计划给出的一大段讨论失去前提。

计划写「npm 默认允许全部 postinstall」，并据此给了两条路：接受 npm 默认，或用
`npm ci --ignore-scripts` + 手工 `npm rebuild` 复刻 Bun 的严格策略。
**实测 npm 12 的默认行为恰好相反：默认阻止全部 install script**，要显式 `allowScripts`
白名单才放行 —— 这正是 `trustedDependencies` 的 npm 等价物：

```text
npm warn install-scripts 5 packages had install scripts blocked because they are not
covered by allowScripts: esbuild@0.28.2, esbuild@0.25.12, esbuild@0.18.20,
unrs-resolver@1.12.2, fsevents@2.3.3
```

因此计划的选项二（`--ignore-scripts`）已无意义（默认即此），而选项一实际指向的是一套
**比 Bun 允许名单更严格**的策略。

**决定：不添加 `allowScripts`，直接采用 npm 12 默认。** 依据是实测而非推断 ——
被阻止的脚本在本项目并非必需：

- `better-sqlite3@13` 自带**全平台 N-API 预编译产物**（`prebuilds/darwin-arm64.node` 等），
  运行时可加载。**计划列为「最高风险」的 node-gyp 重编译风险因此并未发生。**
- `sharp` / `lightningcss` 经 `optionalDependencies` 分发平台二进制
  （`@img/sharp-darwin-arm64`、`lightningcss-darwin-arm64`），install script 只是回退路径。
- `esbuild` / `unrs-resolver` 同理经 `optionalDependencies` 解析平台包。
- `fsevents` 是 darwin 专用可选依赖，仅 watch 模式需要，CI 上不会安装。

即**默认姿态比迁移前更严格**（Bun 允许 `sharp`/`unrs-resolver` 跑脚本，npm 12 连它们也拦），
且未削弱任何已验证能力。

### 另一个发现：锁文件的 registry 会被写死

`package-lock.json` 记录 `resolved` URL。本机全局配置的是 `registry.npmmirror.com`，
若照此生成，锁文件会把第三方 CDN 写进去、让 CI 也走该镜像。因此改用官方 registry 生成，
983 条 `resolved` 全部指向 `registry.npmjs.org`。
顺带实测到镜像当时严重降速（二进制 36 KB/s 且 90s 未下完，官方 1.38 MB/s；
`next` 元数据镜像 60s 超时、官方 9.3s），相差约 38 倍 —— 这是必须走官方源的第二个理由。

## 相关

本计划批次 7 · `package.json` · `.github/workflows/verify.yml` · `docs/implementation-report.md`
