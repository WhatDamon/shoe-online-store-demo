# 目录停售传播 — 2026-10-03

工作区 `F:/shoe-online-store-demo`，分支 `sql-certificate-and-AI-stock`，基于 `54c6fa7`。
这是阶段 C 的一个独立步骤：把展示导出中商品/颜色/尺码的缺失显式传播为 Python 交易端停售。
原有 seed 只插入商品，缺失或删除展示数据不会改变已经导入的变体，因此旧购物车仍可能继续购买。
本次用保留身份的停用标记实现传播，交易真值仍在 Python。

## 实现与边界

- `backend/app/domain/models.py` 和迁移 `c73a28f06b19`：商品与变体增加默认 true 的 `is_active`；不删除关系或历史记录。
- `backend/app/domain/catalog_identity.py`：seed 和同步共用稳定 UUIDv5 生成规则，没有更换现有 ID。
- `backend/app/schemas/catalog_snapshot.py`：严格验证完整快照的身份、颜色、尺码和重复值；CLI 限制文件大小并拒绝重复 JSON 字段。
- `backend/app/application/catalog_sync.py`、`backend/app/sync_catalog.py`：只读 dry-run、源版本与计划版本、显式 apply 和 restore；未知身份/改名要求另行导入或迁移。
- `backend/app/application/catalog.py`：共享商品锁与可售检查；购物车、checkout 和同步使用相同商品锁顺序。
- `backend/app/application/audit.py`：抽出共享审计写入函数，commerce 与同步互不导入，应用层不依赖 FastAPI。
- Python API 和 TypeScript 响应合同增加购物车 `sellable`；前台停售行保留移除入口，禁用数量修改和新订单，兼容旧响应与已有幂等重试。
- `scripts/check-catalog-drift.mjs`：运行时只读检查区分 active 漂移与 inactive 历史记录。

同步默认只把源中缺失的现有身份设为 inactive；再次导出/seed 不会复活，只有显式
`--restore-present` 才恢复。源版本是规范化商品/变体身份集合的哈希，不包含价格或文案。
应用前按商品 ID 排序加锁并重算计划，任何身份集合、可售状态或恢复模式
变化都会拒绝旧 `plan_version`。状态更新和每条审计记录在同一事务内提交，任一异常全部回滚。
SQLite 使用写锁；PostgreSQL 使用商品行锁。同步只锁商品再修改变体，下单按购物车、商品、
库存顺序，不建立反向锁依赖。

停售先提交时，后续加购和新订单拒绝；订单先提交时，同步随后停售且保留订单预占。
已有订单依赖价格快照，幂等重试返回原订单，取消/到期仍释放一次预占。同步不更改价格、
库存、订单、预占或支付状态。Mock payment 继续返回明确禁用结果，不扣款。

## 本地使用

在 `backend/` 执行迁移、seed 和启动命令，前端在另一个终端启动：

```powershell
cd F:/shoe-online-store-demo/backend
.venv/Scripts/python.exe -m alembic upgrade head
.venv/Scripts/python.exe -m app.seed
.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --no-access-log
```

```powershell
cd F:/shoe-online-store-demo
npm run dev
```

Python 与 Next 使用各自配置。前端 `PYTHON_API_URL` 指向内部 Python 服务；浏览器通过
`/api/commerce` 代理访问。选择颜色/尺码加入购物车后，预览、创建 `pending_payment` 订单，
页面明确提示支付未开放。审阅完整导出后，按如下流程传播停售：

```powershell
cd F:/shoe-online-store-demo/backend
.venv/Scripts/python.exe -m app.sync_catalog --catalog data/catalog.json
$reviewedPlan = 'copy-the-plan_version-from-the-preview'
.venv/Scripts/python.exe -m app.sync_catalog --catalog data/catalog.json --apply --expect-plan $reviewedPlan
```

移除商品或颜色/尺码后，预览列出对应状态变化。已加入购物车的停售项仍显示，可移除；新的
加购/数量修改/checkout 被拒绝。传入部分导出会停用所有被遗漏的身份，必须审阅完整输入及计划。
需要恢复时，在预览和应用两条命令中同时加 `--restore-present`；先备份实际交易库。

## 实际验证

- `npm run verify`：格式、类型、客户端边界、耦合、目录、lint 全通过；76 个测试文件、561 项通过，15 项跳过。
- `npm run build`：Next.js 16.3.4 生产构建通过，45 个页面。
- `npm run check:coupling`：145 个生产模块、258 条运行时边，无循环或边界违规；Python 应用层未引入 FastAPI。
- `npm run check:catalog`：29/29 商品、968 个稳定变体键一致，版本 `109c32e3464f7e96`。
- Python SQLite/PostgreSQL 全量测试：159 项通过、1 项跳过，包含停售/下单并发、审计失败回滚、历史订单与双数据库迁移升级/降级保护；隔离 PostgreSQL 16.4 监听 `127.0.0.1:55439`。
- `.venv/Scripts/python.exe -m ruff check app migrations tests`、`ruff format --check app migrations tests`、`mypy`、`compileall -q app migrations`：通过。
- 临时 SQLite 库实际运行 Alembic upgrade/check、seed 与 CLI：dry-run 无数据写入；停用一个商品及 50 个变体，51 条状态审计；库存/订单/预占不变；旧计划拒绝；默认不复活；显式恢复与再次 Alembic check 通过。
- `scripts/smoke-commerce.py --base-url http://127.0.0.1:3103`：临时 Next 生产服务与 Python 服务通过真实 HTTP 的页面、Cookie/代理、购物车增改、后端计价、订单幂等、所有权、来源、禁用支付、取消和库存恢复。追加真实 HTTP 停售检查通过商品 404、旧购物车 `sellable=false`、购买拒绝与移除；两服务已停止。
- PostgreSQL TypeScript 预算/TLS 集成：本轮此前已通过 2 个文件、15 项测试。

全量 Python 验证使用以下命令，未指向业务库：

```powershell
cd F:/shoe-online-store-demo/backend
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:COMMERCE_TEST_POSTGRES_URL = 'postgresql+psycopg://postgres@127.0.0.1:55439/commerce_test'
.venv/Scripts/python.exe -B -m pytest -q --basetemp ../.vitest/catalog-availability-20261003/pytest-final -o cache_dir=../.vitest/catalog-availability-20261003/pytest-cache
```

初次统一 verify 发现 JSX 格式差异，按 Prettier 修正后通过。Python 首次系统临时目录权限失败，
改为仓库内隔离目录；一次目录父级未创建，创建后重跑。这些是命令/环境问题，未修改无关业务。
最终 Python 测试仍有现有 Starlette/httpx/anyio 弃用警告，本次不改变依赖路线。

## 兼容、回滚与后续

先升级 schema 再启动当前代码；迁移保持现有数据，未增加环境配置或依赖。TypeScript 可解析
旧购物车响应，新的停售信息必须来自已升级 Python。现有 Cookie/所有权、金额、幂等与支付
边界继续由原实现校验，新增商品和改名不在本次同步范围。

存在 inactive 数据时迁移 downgrade 明确拒绝；更早的购买代码会忽略停售字段，因此不能在
停售存在时直接回退旧代码。优先前向修复并保留门禁；确实要恢复销售时，用完整可信快照和
显式恢复计划，再评估 schema 降级。不得通过删除历史数据或手动改库存绕过保护。

同步是人工显式命令，未实现定时自动双写、价格同步、商品改名迁移、硬删除或管理 UI。
本轮未执行正式部署、线上 URL 复测、浏览器人工验收或负载测量；本地 HTTP 与组件测试证据不代表生产上线。
继续关注停售变更审计数量、`variant_unavailable` 拒绝、锁等待、5xx、库存冲突及长期预占。
后续按阶段 C 继续完善可靠性证据与目录更新合同，再进入查询/缓存/流量阶段。
