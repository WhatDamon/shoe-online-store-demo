# Evoloop — Shopify OS 2.0 Theme (product page)

移植自 Next.js 演示站的 PDP 设计（Evoloop 3D 打印休闲鞋）。目标：**商品页全面迁到
Shopify**；本主题在真实商店就绪后可 zip 导入官方主题编辑器。

> 仓库根目录（Next.js demo）仍独立保留：Landing 与 /shop 列表继续由 Next 服务；
> 本主题只负责 Shopify 端商品页与结算需要的店铺外壳（header/footer）。
> 设计单一事实源在 Next 源码（`src/components/shop/product-visual.tsx` 等）——
> 移植注意同步。

## 目录结构（OS 2.0）

```
themes/evoloop/
  layout/theme.liquid           店铺外壳（header + content + footer）
  templates/product.json        商品页模板（区块顺序 = spec §9 硬顺序）
  templates/index.json          极简落地（品牌一句 + 进店链接）
  sections/header.liquid
  sections/footer.liquid
  sections/main-product.liquid  商品页主区段（gallery/信息/variant/手风琴/CTA/AI 插槽）
  sections/product-recommendations.liquid  “You may also like”（官方 recommendations）
  snippets/product-card.liquid  卡片（推荐区复用）
  assets/base.css               设计 token 与全站样式
  assets/product-visual.js      3D 纹理 SVG 生成器（三视图）
  assets/theme.js               variant 选择/加购/推荐/无障碍小逻辑
  config/settings_schema.json   主题设置（颜色/字体/品牌/AI 后端地址）
  config/settings_data.json
  docs/product-entry-checklist.md  16 鞋型 → Shopify 商品录入清单
```

## 导入

方式 A（zip）：把 `themes/evoloop/` 打包成 zip（顶层必须是这些目录与文件），
Online Store → Themes → Add theme → Upload。

方式 B（CLI，开发期推荐）：

```bash
cd themes/evoloop
shopify theme dev --store=YOUR-STORE
shopify theme check      # 静态校验（Liquid/JSON），导入前必跑
```

## PDP 区块顺序（= 设计 spec §9 硬顺序，勿改）

`back link → [gallery | info]`，info 纵列：title → price → description →
`variant picker (Size)` → `Materials & fit` 手风琴 → `Shipping & returns` 手风琴 →
**buy** → assistant 锚点（可选）。

在模板编辑器里改 product.json 的 blocks 顺序即可重排；读屏顺序跟随 DOM。

## Metafields 契约（命名空间 `evoloop`）

商品页的三个能力依赖这些 metafield（无 metafield 时优雅降级：图案默认 lattice、
图廊走商品图片、详情取 product.description）。录入见 docs/product-entry-checklist.md。

| metafield | 类型 | 说明 |
|---|---|---|
| `evoloop.subtitle` | single_line_text_field | 副标题 |
| `evoloop.construction_pattern` | single_line_text_field | `lattice` / `wave` / `honeycomb`（默认 lattice） |
| `evoloop.construction_density` | number | `0.6` / `0.75` / `0.9`（默认 0.75） |
| `evoloop.construction_printed_upper` | true_false | 是否打印鞋面 |
| `evoloop.visual_palette` | json | `["#…","#…"]` 双色（底色/纹理色） |
| `evoloop.visual_accent` | single_line_text_field | 强调色 hex |
| `evoloop.features` | list.single_line_text_field | 特性列表（Materials & fit 列表，Liquid 可迭代） |
| `evoloop.fit_notes` | multi_line_text_field | 合脚说明（Materials & fit 段落） |
| `evoloop.assistant_product_id` | single_line_text_field | 回连 Next 后端用的本地 handle（可选） |

视觉降级链：无 `evoloop.visual_*` → 用品牌默认配色渲染格纹（仍是 3D 风格占位）。

## AI 助手插槽（“预备”，未启用）

主题内 `assistant_slot` 区块：当**主题设置 → Assistant → Backend URL** 填了已部署
的 Next 后端地址时，注入挂载节点 + 异步加载 `<backend>/assistant-widget.js`
（数据属性携带当前商品 title/handle/url 与跳转路由），并在 variant 下显示
“Find my size” 锚点调用 `window.EvoloopAssistant.open('size-fit', product)`。

现状与接入契约：

- 该 widget 资产在 Next 侧**尚未实现**——本期只把插槽与契约备好；未填 URL 时页面
  完全无 AI 痕迹（克制 P1）。
- 后端需同时提供：公开 widget JS、`POST /api/ai/chat`（现已有）、以及同一商品在
  Shopify 与 Next 目录间的 handle 映射（读 `evoloop.assistant_product_id` 或按标题）。
- 若要走 Shopify App 通道（App embed / App Proxy），需另建 App 工程注入同一插槽。

## 待办/验证（无商店时的诚实清单）

- [ ] `shopify theme check` 通过（本地即可跑，无需商店）
- [ ] 开发店导入后：三个图案 × 三视图渲染一致；variant 价格/售罄联动；加购跳
      checkout；推荐区出现
- [ ] 手机视口无横向滚动；读屏顺序 = §9
- [ ] metafield 缺失（全新商品）走降级路径不报错
- [ ] 真实商店上线后：录入 16 鞋型（docs/product-entry-checklist.md），填
      assistant backend URL，重跑人工验收
