# 验收命令与环境基线

> 由 `AGENTS.md` 外移而来，并改为平台中立写法。
> 原章节使用 `cd F:\shoe-online-store-demo` 与 `.venv\Scripts\python.exe`，在 macOS/Linux 上无法执行；
> `npm run preflight` 曾依赖 `pwsh`，使该门禁在非 Windows 上不可执行，且 CI 从未调用它——现在是纯 Node 脚本。
> 现在所有入口都是 npm script，**命令在三个平台逐字相同**，平台差异只存在于 `scripts/py.mjs`。

## 入口

| 命令 | 作用 |
| --- | --- |
| `npm run verify` | 展示/前端侧全套：`format:check` → `typecheck` → 边界 → 耦合 → 目录漂移 → `lint` → 单测 |
| `npm run verify:python` | Python 全套：ruff format → ruff check → mypy → compileall → alembic check → pytest |
| `npm run verify:all` | 以上两者串联 |
| `npm run preflight` | 部署前环境预检；加 `-- --environment production`（旧写法 `-Environment production` 仍可用） |
| `npm run py -- -m <module> …` | 任意 Python 命令；解释器由 `scripts/py.mjs` 解析 |
| `npm run build` | Next.js 生产构建 |
| `npm run test:watch` | vitest 交互模式 |

**解释器解析顺序**（`scripts/py.mjs`）：`PYTHON` → `backend/.venv/bin/python`（POSIX）→
`backend/.venv/Scripts/python.exe`（Windows）→ PATH 上的 `python3` / `python`（并打印告警）。
相对路径参数以 `backend/` 为工作目录解析；`PY_CWD=root` 可改为在仓库根目录执行。

## 按影响范围追加

| 改动类型 | 追加 |
| --- | --- |
| commerce / AI / 数据库 / 事务 / 并发 | 对应的集成、所有权、并发、失败回滚测试；`scripts/smoke-commerce.py`、`scripts/smoke-ai.mjs` |
| metadata / Route Handler / 缓存 | 先读 `node_modules/next/dist/docs/` 对应文档，再 `npm run build` |
| 迁移 | `npm run db:migrate:python` 之后 `npm run check:python:migrate` |
| 线上 SEO | 必须对正式 URL 实际复测（验收清单见 `docs/seo-geo-plan.md`） |

## 基线纪律

- 先记录当前分支、工作区改动、环境文件和已有进程。**不得覆盖或回滚用户未授权的改动。**
- 基线失败时，先区分「阻塞本次任务的问题」与「已有但无关的问题」；只修前者，并在交付报告里
  写出原始失败与修复后的实际结果。
- 不要把测试文件数量、通过数量或本地草稿的存在，当成线上功能已生效的证明。
- **不要在任何文档里写死测试数量。** 需要数字时当场运行 `npm run verify` / `npm run test:python`
  并引用输出；快照只出现在交付报告或带日期的 `docs/*-YYYY-MM-DD.md` 报告里，不写进常驻文档。
- 未执行的检查必须在交付报告里明确写「未执行」和原因。

## 环境限制与回退路径

- Python 门禁需要先按 `backend/README.md` 建好 `backend/.venv` 并安装锁定依赖。未建环境时
  `scripts/py.mjs` 会回退到 PATH 解释器并打印告警，缺依赖则以 `ModuleNotFoundError` 失败——
  这是**环境**问题，不是代码失败。
- PostgreSQL 运行时集成与跨服务 smoke test 需要单独环境，默认本地只有 SQLite。
- CI（`.github/workflows/verify.yml`）在 `ubuntu-latest` 上跑 `npm run verify` + `npm run build`
  与 Python 全套，并使用 Node 双版本矩阵；CI 直接用系统解释器，不建虚拟环境。
