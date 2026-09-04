# themes/evoloop — Evoloop 在线商店主题

Evoloop 购物（结账）端的 Shopify 主题。**基于 Shopify Horizon 4.1.5 二次开发**
（fork + Evoloop 定制），以真实商业主题为蓝本替换了早期手写的不规范主题。

## 来源与许可

- 上游：**Horizon 4.1.5**，`config/settings_schema.json` 内 theme_info 署名
  `theme_name: Evoloop`（原 `Horizon`）、`theme_author: Shopify`。
- 原始 zip：`horizon-product-carousel-v2-images-…-3d-shoes.zip`（用户本地存档，
  未入库）。zip 内无 LICENSE 文件；仓库为私有仓库，未推 remote。
- 本目录内的上游源码按原样 vendor（`/themes` 已加入 `.prettierignore`，不做格式化
  改写，便于将来随上游升级做 diff）。二开增量见下「与上游的差异」。

## 快速开始

1. 导入 Shopify 店铺：压缩本目录为 zip 后经
   `后台 → 在线商店 → 主题 → 添加主题 → 上传 zip`；或本地开发用
   `shopify theme dev --store <your-store>.myshopify.com`。
2. 新店建议先按 `docs/product-entry-checklist.md` 录入 Evoloop 的 3D 打印鞋商品
   （含 `evoloop.*` metafields）。
3. 商品页模板二选一（见「PDP 模板」），把商品在 Shopify 后台指派到对应模板。

### 图片恢复（仓库已剥离二进制）

提交中**不含任何二进制图片**。原 zip 中有 `assets/hero-slide-1/2/3.jpg`（约 1.8MB，供 Horizon 的 hero carousel 区块使用）。当前首页已改用无图的 Evoloop 品牌首页（见下），不需要这些图；若日后在任意页面添加 Horizon carousel 区块并想用实拍图，解压原始 zip 后到主题编辑器重选即可：

```bash
unzip -o ~/Downloads/horizon-product-carousel-v2-images-20260905-3d-shoes.zip \
  'assets/hero-slide-*.jpg' -d themes/evoloop
```

## Evoloop 品牌层（导入即可见，不再“一眼 Horizon”）

主题默认观感 = Evoloop 品牌（与 Next 网站一致），改四层：

| 层 | 文件 | 说明 |
|---|---|---|
| 色板 | `config/settings_data.json` | `color_palette`（current + Horizon preset）已改为 Evoloop：background `#fafaf8`（canvas）、foreground `#111111`（ink）、color1 `#525252`（次级文本）、color2 `#e5e5e5`（描边）；主按钮默认 ink 黑底白字 |
| 字体 | `assets/evoloop-brand.css` + `snippets/evoloop-brand.liquid` | 标题用 Google Fonts Newsreader（`var(--font-heading--family)` 覆盖，离线回退 serif）；正文/子标题/按钮用系统无衬线栈；加载顺序保证在 Horizon 变量之后（`layout/theme.liquid` head 尾部 `{% render 'evoloop-brand' %}`） |
| 首页 | `templates/index.json` + `sections/evoloop-hero.liquid` | 品牌 Hero（kicker/标语/描述/CTA，无图无 AI）+ 品牌词 marquee（Horizon marquee 区块）+ 精选商品列表（product-list，空店自动降级为占位骨架；接 collection 后展示商品） |
| 页脚/商品页 | `sections/evoloop-brand-strip.liquid`（已加入 footer 静态组尾部，每页显示 slogan 条）；`sections/main-3d-shoes-custom.liquid` 与 `snippets/evoloop-assistant.liquid` 硬编码色值已对齐 canvas/ink/hairline |

**自定义入口**：改色改 `settings_data.json` 的 `color_palette` 或主题编辑器 Color；改字改 `assets/evoloop-brand.css` 顶部的变量（或编辑器 Fonts，注意运行时由 brand.css 覆盖，编辑器的字体选择为兼容占位）；改首页文案改主题编辑器首页的 Evoloop hero / Marquee 区块文本。

> 注意：标题字体依赖 Google Fonts 外链；无法访问 fonts.googleapis.com 的环境会自动落到 `ui-serif / Georgia` 回退，不破版。

## 与上游的差异（增量清单）

| 变更                                                                                                                                                                                                                                                  | 位置                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| theme_info 更名 Evoloop；品牌入口都在 Shopify 后台/`shop.name` 与主题编辑器设置                                                                                                                                                                       | `config/settings_schema.json`                                                                                                                       |
| 二进制图剥离 + 首页 hero 引用置空（占位 svg 兜底）                                                                                                                                                                                                    | `templates/index.json`                                                                                                                              |
| **语言仅保留英文**：57 个 locale → 仅 `en.default.json` + `en.default.schema.json`                                                                                                                                                                    | `locales/`（55 个非英文语言包已删除）                                                                                                               |
| **内容剥离（设计之外）**：删除 blog/article/gift_card 模板及其家族与死代码（main-blog/main-blog-post/header-announcements、blog-comment-form、_blog-post-*/死 blocks、gift-card css、account/orders 图标、Horizon JS 开发脚手架）；库存见 README 下段 | 全树                                                                                                                                                |
| **Evoloop 3D 视觉兜底**（能力 1，见下）                                                                                                                                                                                                               | `snippets/evoloop-product-visual.liquid`、`assets/evoloop-product-visual.js`、`sections/main-3d-shoes-custom.liquid`                                |
| **Evoloop AI 助手插槽**（能力 2，见下）                                                                                                                                                                                                               | `config/settings_schema.json`（设置组）、`snippets/evoloop-assistant.liquid`、`assets/evoloop-assistant.js`、`sections/main-3d-shoes-custom.liquid` |

## PDP 模板

Horizon 自带两套商品模板，本主题保留并按需二开：

| 模板                                              | 区块系统                                                                 | 说明                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `product.3d-shoes.json`（`main-3d-shoes-custom`） | 单区段定制页                                                             | **Evoloop 3D 打印鞋的旗舰商品页**：图廊（多图缩略图 / 3D 视觉兜底）、尺码 chips→variant（售罄/缺货禁用联动）、数量、加入购物车→抽屉、加速结账、Materials and process / Shipping 手风琴、AI 助手槽。已二开接线                                                                                                  |
| `product.json`（`product-information`）           | 富块（标题/价格/媒体 gallery/variant picker/buy buttons/disclosures 等） | 通用商品页。需要 3D 视觉或助手时，在主题编辑器里向详情区加一个 Custom Liquid 块，粘贴 snippet 渲染：<br>`{% render 'evoloop-product-visual', product: product %}` 或<br>`{% render 'evoloop-assistant', product: product %}`（注意手动页面需自行补 asset include：`<script src="{{ 'evoloop-product-visual.js' | asset_url }}" defer></script>`） |

## 能力 1：3D 纹理视觉兜底（克制呈现）

商品 **无 media 但有 `evoloop.*` metafields** 时，产品页自动用程序化 SVG 展示
三视图（Side / Sole / Detail，可切换）与三种打印纹理（lattice / wave /
honeycomb），几何与 Next 应用里的 ProductVisual 完全一致。渲染链：
`product media → evoloop 3D 视觉 → Shopify placeholder`。视觉 JS 纯 DOM 构建
（无 innerHTML），商家填的 metafield 不会注入页面。

配置：无需主题设置；读商品 metafields（见「Metafields 契约」）。录入方法见
`docs/product-entry-checklist.md`。

## 能力 2：AI 助手插槽（克制 P1）

- 主题设置 → **Evoloop assistant → Assistant backend URL**：填 Evoloop 助手后端
  （如已部署的 Next.js 应用）后，商品页底部出现「Find my size」入口与挂载节点；
  **留空则全站零 AI 呈现**。
- 加载协议：后端需提供 `<backend>/assistant-widget.js`（self-mounting 脚本，挂到
  主题留下的 `[data-evo-assistant-root]` 节点）。助手脚本就绪后暴露
  `window.EvoloopAssistant.open(mode, product)`。
- 事件桥：点击「Find my size」先派发冒泡 `CustomEvent('evoloop:assistant-open',
{ detail: { mode: 'size-fit', product } })`，widget 既可挂事件也可直接注册 API。
- 商品上下文经 data 属性传递：title / handle / url（Next 侧目录可用
  `evoloop.assistant_product_id` handle 做跨目录映射）。
- 文案克制：全主题无 “AI / Powered by AI” 字样，只有消费者语言。

**与 Shopify Inbox chat-drawer 的关系**：Horizon 自带 Inbox 聊天抽屉
（`snippets/chat-drawer.liquid`，装机后出现）用于店铺人工客服会话；Evoloop 助手槽
是另一条路——尺码推荐/穿搭的自动导购。二者并存不冲突，是否启用各自独立。

## Metafields 契约（命名空间 `evoloop`）

| Key                        | Type                        | 取值                                       |
| -------------------------- | --------------------------- | ------------------------------------------ |
| subtitle                   | single_line_text_field      | 副标题（可选）                             |
| construction_pattern       | single_line_text_field      | lattice / wave / honeycomb（默认 lattice） |
| construction_density       | number                      | 0.6 / 0.75 / 0.9（默认 0.75）              |
| construction_printed_upper | true_false                  | true                                       |
| visual_palette             | json                        | `["#hex1","#hex2"]`（两色数组）            |
| visual_accent              | single_line_text_field      | 强调色 hex                                 |
| features                   | list.single_line_text_field | 特性条目（Materials & fit 列表）           |
| fit_notes                  | multi_line_text_field       | 合脚说明                                   |
| assistant_product_id       | single_line_text_field      | 与 Next 目录映射的本地 handle              |

## 相关文档

- `docs/product-entry-checklist.md` — 16 款 Evoloop 3D 打印鞋的录入清单
  （数据取自 Next `src/server/catalog/seed.ts`）。
- Next 应用（`/` 落地页、`/shop` 选购列表、AI 后端 `/api/ai/*`）不在本主题内；
  本主题仅覆盖 Shopify 侧商品页与结账。`/shop → Shopify PDP` 的外链切换待真实
  店铺存在后进行。

## 尚未本地验证的项

- `shopify theme check` 静态校验（需 Shopify CLI）。
- 开发店导入后的实机验证：3D 视觉三图案×三视图、尺码 variant 联动与售罄禁用、
  加购→抽屉/结账、推荐位、助手插槽懒加载与 widget 契约握手。
- Horizon 未改动上游页面的回归（cart/collection/customers/search/password 等）。

## 已剥离内容（可从上游 zip 找回）

本次裁剪删除的文件在上游 zip（`horizon-product-carousel-v2-images-…-3d-shoes.zip`）中均有原件，需要时可单独解压找回：

- 非英文语言包：`locales/{ar,bg,cs,…,zh-CN,zh-TW}*.json`（55 个）。
- 内容型模板与家族：`templates/{blog,article}.json`、`templates/gift_card.liquid`、`sections/{main-blog,main-blog-post,header-announcements}.liquid`、`snippets/blog-comment-form.liquid`、`blocks/_blog-post-*` 等。
- 死代码与脚手架：`assets/template-giftcard.css`、`assets/icon-{account,orders,double-chevron}.svg`、`assets/{package.json,jsconfig.json,*.d.ts}`。

恢复示例：`unzip -o ~/Downloads/<原始zip> 'locales/*' -d themes/evoloop`。
