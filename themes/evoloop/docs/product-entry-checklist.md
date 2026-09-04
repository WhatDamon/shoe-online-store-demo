# Evoloop — 商品录入清单（Next seed 16 鞋型 → Shopify）

> 对应主题：themes/evoloop（Shopify Horizon 4.1.5 二次开发）。数据源：
> Next demo 的 src/server/catalog/seed.ts。录入按行建 Product + Variants +
> Metafields。尺码以 EU 整档作 variant 选项值（与设计 spec #9 canonical 一致）。
> 价格 USD。3D 打印鞋推荐全部指派模板 product.3d-shoes。

## 速查表

| Title (handle) | Collection | Sizes (EU) | USD | Pattern | Palette | Accent |
|---|---|---|---|---|---|---|
| Daily Drift (daily-drift) | everyday, comfort | 40, 41, 42, 43, 44, 45 | 128 | lattice | #e8e6e0 / #d8d4cb | #b87333 |
| Cloudwalk Slip (cloudwalk-slip) | comfort, everyday | 38, 39, 40, 41, 42, 43 | 108 | wave | #dcd6cf / #c9c2b8 | #5f6f52 |
| Packable Loafer (packable-loafer) | travel | 39, 40, 41, 42, 43, 44 | 118 | lattice | #d9d2c5 / #c4bbaa | #8a6d3b |
| Overnighter (overnighter) | travel | 40, 41, 42, 43, 44, 45 | 138 | honeycomb | #cfd2d6 / #b9bec4 | #4a5d6e |
| Gate Runner (gate-runner) | travel | 40, 41, 42, 43, 44, 45, 46 | 148 | wave | #e2dfda / #cfcac2 | #9c4a2f |
| Transit Knit (transit-knit) | travel | 39, 40, 41, 42, 43, 44 | 128 | lattice | #d7d3cf / #c3bdb6 | #6d6a5e |
| Morning Glory (morning-glory) | comfort | 38, 39, 40, 41, 42, 43 | 118 | wave | #f0e4d6 / #e3cfbb | #c96f4a |
| Soft Step (soft-step) | comfort | 39, 40, 41, 42, 43, 44, 45 | 128 | honeycomb | #e7e2dc / #d5cdc4 | #7a5c3e |
| Lounge Line (lounge-line) | comfort | 38, 39, 40, 41, 42, 43 | 98 | honeycomb | #efe7de / #e2d5c8 | #b08d57 |
| Pillow Slip (pillow-slip) | comfort | 38, 39, 40, 41, 42, 43, 44 | 108 | wave | #eae3f0 / #d9cfdd | #6e5d8a |
| Quiet Minimal (quiet-minimal) | minimal | 40, 41, 42, 43, 44, 45 | 158 | lattice | #f4f4f1 / #e8e8e3 | #2f2f2e |
| Monochrome (monochrome) | minimal | 40, 41, 42, 43, 44, 45, 46 | 148 | wave | #2b2b2b / #3d3d3c | #8a8a87 |
| Stone Gray (stone-gray) | minimal | 40, 41, 42, 43, 44, 45 | 168 | honeycomb | #b9b6b0 / #a3a099 | #57544e |
| Sage Lite (sage-lite) | minimal | 39, 40, 41, 42, 43, 44 | 178 | lattice | #d7ddd0 / #c2cbb4 | #5c7352 |
| Commuter One (commuter-one) | everyday | 40, 41, 42, 43, 44, 45, 46 | 132 | wave | #d8d5cf / #c5c1b9 | #3f6c6b |
| Second Skin (second-skin) | everyday | 39, 40, 41, 42, 43, 44, 45 | 128 | lattice | #e4e2dd / #d2cfc8 | #7c8a99 |

## 每个商品需要建的条目

| 类别 | 怎么填 |
|---|---|
| **Title / Handle** | Title = 上表 Title；Handle 自动生成（建议与 Next 一致，AI 映射靠它） |
| **Description** | 粘贴 Next product.description（首段）+ 3D 打印卖点文案 |
| **Media** | 有真实摄影图先传（主题走原生图廊，效果最好）；无图则留空，主题自动用 evoloop.* metafields 渲染 3D 视觉三视图 |
| **Template** | 指派 product.3d-shoes（Evoloop 旗舰 PDP，已接线 3D 视觉 + AI 助手槽）；通用商品可用默认 product |
| **Variants — Size option** | option 名 Size；每行一个 EU 尺码（上表），售价 = USD 价，库存按真实产能 |
| **Metafields (namespace evoloop)** | 见下 |

## Metafields（每个商品建全，命名空间 evoloop）

| Key | Type | 取值 |
|---|---|---|
| subtitle | single_line_text_field | 副标题（可选） |
| construction_pattern | single_line_text_field | 上表 Pattern（lattice / wave / honeycomb） |
| construction_density | number | 0.6 / 0.75 / 0.9（默认 0.75） |
| construction_printed_upper | true_false | true |
| visual_palette | json | 上表 Palette 两色 JSON 数组，如 ["#f3f1ea","#9ca3af"] |
| visual_accent | single_line_text_field | 上表 Accent hex |
| features | list.single_line_text_field | 特性条目（取自 seed features，Materials & fit 列表） |
| fit_notes | multi_line_text_field | 合脚说明（seed fitNotes） |
| assistant_product_id | single_line_text_field | 本地 handle（上表），供 AI 后端跨目录映射 |

## 注意事项

- 无 Media 且无 metafields：PDP 落 Shopify 占位图（不破版），但建议一次建齐。
- Size option 名称统一为 Size，值为 EU 整档（主题展示 size 脚注按 EU 解释）。
- Collections：Next 子系列 everyday / comfort / travel / minimal 建议建成 Shopify Collection（handle 相同），首页/导航引用由 Shopify 菜单决定。
- 有图商品与无图商品混排时首页 hero slide / 推荐位使用原生 media 或 collection 封面图，3D 视觉只用于商品页兜底。
