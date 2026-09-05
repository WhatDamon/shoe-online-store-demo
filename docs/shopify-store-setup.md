# Shopify 商店后台调整清单（面向美国消费者）

> 日期：2026-09-06 · 状态：商店侧待办清单（不含 Next 代码改动）
> 依据：03zrk0-2u 实测为 **CNY** 店铺（Storefront API 探测：`dc-1001`/`dc-1002`/`联盟新创-jx119-x` 均 ¥1,145.0 CNY ≈ US$160）。
> 本站（Evoloop demo）定位**美国消费者**（英文 / USD 视觉），故商店的币种、价格呈现与文案需在 Shopify 后台对齐。
> 注：后台 UI 入口可能随 Shopify 版本微调，以下路径以当前（2026）后台为准，找不到时用后台搜索框搜对应设置名。

## 为什么需要调整（现状）

- 本站 /shop 卡片与 demo PDP 显示的是 **demo $98–178 占位价**；商店直购 PDP（Buy Button 接管）隐藏了 demo $，但 Buy 模块 `contents.price:false` → **浏览全程看不到商店真实价**，真实价只在购物车/结账才出现。
- 商店结算币种是 **CNY（¥ = 人民币）**，而网站面向美国消费者 —— 美国访客看到/支付 ¥ 会困惑。
- Buy 模块的 variant 选项名仍为中文（尺码 女 35-40 / 男 39-44、颜色中文名）。

## 1. 币种与市场（优先级最高）

目标：美国访客的展示与结账货币为 **USD**。

- [ ] **启用多币种 / 美国市场 USD**：`Settings → Markets` → 确认存在（或新建）**United States** 市场，并将其货币设为 **USD**；开启「以当地货币结算 / multi-currency」。
  - 说明：店铺**基础货币**（CNY）在开店时锁定、不能自助整体切换；自助路径是 **Markets 多币种**——按访客所在国家/市场结算对应货币（美国 → USD）。
  - 若只服务美国单一市场且要全店统一 USD，需联系 Shopify 客服变更店币（较慢，非自助）。
- [ ] 验证：换美国网络/IP（或市场预览）访问商品，Checkout 内货币显示 USD `$`。

## 2. 商品定价（USD 金额）

目标：每款在美国市场有明确的 USD 零售价，而非自动换算出来的零头。

- [ ] `Products → <产品>` → Pricing：为 **US 市场**设置 USD 定价（市场价覆盖；未覆盖时自动按汇率换算，金额会带小数，观感差）。
  - 现价参考：¥1,145 ≈ US$160。建议按整位 USD 定价（如 $158/$168），与本站 demo $98–178 段同区间，视觉一致。
  - 本店 29 款目前**同价 ¥1,145**——如需差异化定价可借此机会逐款设定。
- [ ] 注：本站 /shop 卡片价仍为 demo 占位，与本清单无关（见 §6）。

## 3. 商品 Variant Option（尺码 / 颜色英文化）

Buy 模块按 Shopify variant option 渲染选择器，美国消费者应看到英文选项。

- [ ] `Products → <产品>` → Options：把 option 名 `尺码 → Size`、`颜色 → Color`（option 值的中文颜色名 → 英文，可沿用本站供应商色名映射）。
- [ ] 尺码值：目前为**整段**（女 35-40 / 男 39-44，中文 EU 码段）——此前已在 Buy 弹窗接受「整段即可」。若面向美国，建议至少值英文化为 `Women 35–40` / `Men 39–44`；进一步拆成**单码美码**（US 4.5–10 逐码 variants）属于较大的后台重构，**延后**（会连带影响购物车 SKU）。
- [ ] 改 option 名/值后，Buy Button 弹窗、购物车行、结账同步更新，无需动 Next 代码。

## 4. Buy Button 模块的价格可见性

目标：PDP 上的 Buy 模块**就地显示商店真实价**（当前 `contents.price:false` 不显示）。

- [ ] 在你生成 v3 snippet 的那个 **Buy Button 编辑器**（Admin → Sales channels → Buy Button，或你贴 snippet 的页面）里，打开该 product embed 的 **price** 内容项（可同时开 title；img/title 现为关）。
  - 效果：Next PDP 的商店直购形态（Buy 模块全接管、demo $ 已隐藏）将直接显示商店 USD 价——**无需 Next 代码改动**。
- [ ] **切换币种后同步 moneyFormat**：Buy SDK 用 snippet 里的 `moneyFormat` 显示价格。商店改 USD 后，把 snippet / Buy Button 编辑器中的 moneyFormat 更新为 `${{amount}}`（本项目 `src/server/catalog/shopify-buy.ts` 的 `SHOPIFY_BUY_MONEY_FORMAT` 兜底默认也要相应改或设 env，默认现为 `¥{{amount}}`）。

## 5. 商品资料英文化（面向美国，酌情）

- [ ] 商品标题已是 `EN Name - CODE`（如 `Urban Bloom - DC-1001`）——无需改。
- [ ] 商品 description / 详情文案：若店铺内仍是中文，需逐款补齐英文（Next PDP 商店直购形态展示的是本站 description，与商店各自独立；真正影响美国消费者的是商店自带的 PDP 与结账页文案）。
- [ ] 收款/配送设置面向美国：配送区域（US）、税务、退换政策页等（属开店运营项，列出备查）。

## 6. 改后自动生效 vs 仍需 Next 配合

- **自动生效（无需 Next 代码）**：商店币种/USD 定价、Buy 模块价格显示、option 英文化——Buy SDK 全部实时读商店配置。
- **不在本清单范围**：让 /shop 卡片也显示商店真实 USD 价。那需要新增商店价获取能力（轻量取价或远期 #14 Storefront 读取适配器），属代码工作，另行决定。

## 7. 衔接既有决策

- 与 2026-09-06「Buy Button 全目录接管」一致：PDP store-live 只显示商店渠道价，本站 demo $ 不并存。
- 尺码「整段即可」的接受结论不受影响；美码单码化列为可延后的重构项。
- 商店侧的这些「后完善」项此前已记录为店铺侧不一致（币种 JPY 的旧记录以本清单 **CNY** 实测为准）。
