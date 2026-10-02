# 目录漂移只读检查 — 2026-10-02

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

本次快照输出为 **29/29 商品、968 个稳定变体键一致**。使用本地交易库的只读模式另外核对了 **29 个商品、968 个变体**；`evo-05`（Blush Slip）两边都没有尺码变体，因此报告为无可售尺码。

## 边界与未覆盖项

快照一致只说明导入输入没有漂移；Python 运行时仍是价格、库存、订单状态和所有权的唯一交易真值。默认检查不会读取运行中的
`commerce.db`，因此不会证明已部署数据库的库存数量、`reserved`、下架传播或历史订单同步。运行时模式只读本地 SQLite；PostgreSQL、正式部署和跨服务网络访问仍需独立环境与只读账号，不能用展示快照覆盖交易数据。

`npm run verify` 已包含此门禁。发现差异时命令以非零状态退出，并打印最多 30 条差异；修复应先更新明确的导入源和迁移/停售策略，再重新运行交易测试。
