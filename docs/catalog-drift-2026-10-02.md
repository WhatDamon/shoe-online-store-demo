# 目录漂移只读检查 — 2026-10-02

> 2026-10-03 更新：显式停售传播和恢复流程已实现，详见
> [目录停售传播报告](./catalog-availability-2026-10-03.md)。下方日期对应最初只读检查证据。

本轮为阶段 C 的目录边界增加了可重复的只读检查。展示目录来源是
`src/server/catalog/seed.ts` 及其供应商 JSON；Python commerce 使用提交在
`backend/data/catalog.json` 的导入快照，再由 `backend/app/seed.py` 建立商品、变体、媒体和演示库存。
检查不会启动服务、写入任何数据库，也不会修改库存、预占、订单或订单快照。

## 检查内容

`npm run check:catalog` 执行 `scripts/check-catalog-drift.mjs`，比较：

- 稳定 product `id`、`handle` 和商品集合的新增/缺失；
- 商品名、价格/货币、颜色及 canonical EU 尺码；
- 由 `evoloop/<handle>/<lowercase-color>/<size>` 组成的变体身份键，以及对应的 URL namespace UUIDv5；
- 没有尺码变体的商品，作为当前快照中的不可售款提示。

需要复核本地交易库时，可显式提供只读路径：

```powershell
$env:CATALOG_DRIFT_DATABASE = 'backend/commerce.db'
npm run check:catalog
Remove-Item Env:CATALOG_DRIFT_DATABASE
```

该模式额外比较运行时 `products`、`product_variants` 和 `inventory`，检查删除、稳定 UUID、价格、货币、缺失库存行，并报告 `available=0` 的变体。没有设置变量时不会尝试打开本地数据库。

2026-10-03 起，运行时模式要求先升级 availability 迁移，读取商品与变体的
`is_active`。缺失展示源的 active 记录仍报告漂移，inactive 历史记录保留并单独计数，
不要求物理删除。展示仍存在但交易端已停用的记录同样计入停售提示；展示资料不能绕过 Python 购买门禁。

本次快照输出为 **29/29 商品、968 个稳定变体键一致**。规范化展示与交易导入快照版本均为
`109c32e3464f7e96`；版本由商品核心字段和稳定变体键的 SHA-256 前 16 位组成。使用本地交易库的只读模式另外核对了 **29 个商品、968 个变体**；`evo-05`（Blush Slip）两边都没有尺码变体，因此报告为无可售尺码。

## 边界与未覆盖项

快照一致只说明导入输入没有漂移；Python 运行时仍是价格、库存、订单状态和所有权的唯一交易真值。默认检查不会读取运行中的
`commerce.db`，因此不会证明已部署数据库的库存数量、`reserved`、下架传播或历史订单同步。运行时模式只读本地 SQLite；PostgreSQL、正式部署和跨服务网络访问仍需独立环境与只读账号，不能用展示快照覆盖交易数据。

`npm run verify` 已包含此门禁。发现差异时命令以非零状态退出，并打印最多 30 条差异；修复应先更新明确的导入源和迁移/停售策略，再重新运行交易测试。

显式 `python -m app.sync_catalog` 与只读检查分开：前者用完整导出和计划版本在
Python 交易库原子停用缺失商品/变体，后者始终只读。同步默认不恢复停售项，不导入价格、
库存或订单；新增身份、改名、自动调度和 PostgreSQL 运行库只读漂移工具仍需后续独立设计。
