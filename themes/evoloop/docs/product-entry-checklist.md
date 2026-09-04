# Evoloop — 商品录入清单（Next seed 16 鞋型 → Shopify）

> 数据来源：src/server/catalog/seed.ts（Next demo 的种子目录）。开店录入时逐行建
> Product + Variants + Images + Metafields。尺码以 EU 整档录入 variant 选项值
>（如 38、42），与设计 spec #9 / canonical EU 一致。价格单位 USD。

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
| **Title / Handle** | Title = 上表 Title；Handle 自动（保持 slug 与 Next 一致，AI 映射用） |
| **Description** | 粘贴 Next product.description（首段）；3D 打印卖点文案 |
| **Media** | 有真实摄影图先传主图/多图（主题自动走图片图廊）；没有则留空，主题用 metafields 渲染 3D 视觉三视图 |
| **Variants — Size option** | 每行 = 一个 EU 尺码（上表 Sizes），售价 = 上表 USD，库存按真实产能 |
| **Metafields (namespace evoloop)** | 见下 |

## Metafields（每个商品都建，命名空间 evoloop）

| Key | Type | 取值 |
|---|---|---|
| subtitle | single_line_text_field | 副标题（可选） |
| construction_pattern | single_line_text_field | 上表 Pattern（lattice / wave / honeycomb） |
| construction_density | number | 0.6 / 0.75 / 0.9（默认 0.75） |
| construction_printed_upper | true_false | true |
| visual_palette | json | 上表 Palette 两色组成的 JSON 数组字符串，如 ["#f3f1ea","#9ca3af"] |
| visual_accent | single_line_text_field | 上表 Accent hex |
| features | list.single_line_text_field | 特性条目（对应 Materials & fit 列表，取自 seed features） |
| fit_notes | multi_line_text_field | 合脚说明（seed fitNotes） |
| assistant_product_id | single_line_text_field | 与 Next 目录映射用的本地 handle（上表） |

## 注意事项

- 无 Media 且无 metafields 的商品也能展示（图廊落 3D 默认格纹占位），但录入推荐一次建齐。
- Size option 名称统一用 Size；选项值就是 EU 整档（主题对 option.name = Size 显示尺码脚注）。
- Collections：Next 子系列 everyday / comfort / travel / minimal 建议建成 Shopify Collection（handle 相同）；页面导航以后由 Shopify 导航菜单引用。
- 每个商品可选一张 lifestyle 图供主图使用；主题无图时不影响。
