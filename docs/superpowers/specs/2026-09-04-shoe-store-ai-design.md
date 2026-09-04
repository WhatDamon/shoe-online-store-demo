# 鞋类购物网站 · 前端体验 + 克制的 AI 助手 — 设计规格

> 日期：2026-09-04 · 状态：已获用户逐节批准 · 下一步：writing-plans 创建实现计划

## 1. 概述与定位

一个**真实产品雏形**级别的鞋类品牌前端站点（**英语 / USD，国际市场**）。交易与结算不在此站——用户将采用 **Shopify 作为购物端**，本站聚焦：

1. **落地页 / 选购页**（品牌门面 + 商品浏览与详情）
2. **克制的 AI 辅助**（导购 / 尺码 / 搭配 / 自然语言找鞋），以消费者友好、非"AI 炫耀"的方式呈现

**品类聚焦**：休闲日常鞋（casual / lifestyle，Allbirds 气质），单性别向 unisex + 美码体系。

## 2. 目标与非目标

**目标**

- Landing、选购列表、商品详情三页构成完整、高完成度的浏览体验
- 详情页提供清晰购买路径，但结账发生在 Shopify（本期 CTA 为占位 + 适配器就绪）
- AI 助手贯穿浏览，行为像"懂鞋的店员"，不出现 "Powered by AI" 式宣传
- 无 key / 断网 / 无 Shopify 凭证三种环境均可演示核心流程（降级链：图片走本地兜底、AI 走 Mock）

**非目标（YAGNI，本期明确不做）**

- 本站购物车、本站结账、支付、登录/账户体系
- Shopify 真实凭证接入（只留 adapter 桩与 env 占位）
- 跨会话 AI 记忆、用户画像
- 独立 AI 路由页、工具调用 Agent 架构、原生向量数据库扩展
- 国际化（仅英文）、埋点分析、订阅/营销自动化

## 3. 产品原则

| # | 原则 | 落地 |
|---|------|------|
| P1 | **AI 克制呈现（消费端）** | 助手入口用消费者语言（"Need a hand?" / "Find my size" / "Style ideas"），不出现 "AI" 字样；Landing 页零 AI 痕迹，卖产品与舒适 |
| P2 | 无凭证可演示 | 默认 env 即全功能 Mock：无 key → Mock AI、无 Shopify → Seed 商品、图加载失败 → 本地兜底 |
| P3 | 诚实失败 | 有 key 但调用失败 → 明确报错 + 重试，**不静默降级**为 Mock（防"假成功"演示） |
| P4 | 单一事实源 | 商品实时从 CatalogAdapter 拉取（现为 Seed），本地库只存派生缓存（embedding 快照） |
| P5 | 面向隔离 | server-only 边界、适配器契约、类型化数据流；改实现不改调用方 |
| P6 | 隐私最小 | 无 cookie、无埋点、无个人信息进 AI 上下文；仅当次会话记忆 |

## 4. 技术栈（经版本调研确认的组合）

- **Bun** 1.3.x：包管理 + 脚本运行（`bun run dev` 等）
- **Next.js 16**（App Router + React 19 + TypeScript，Turbopack 构建）；版本在脚手架时锁定最新稳定
- **shadcn/ui + Tailwind CSS v4**：组件与设计 token
- **Drizzle ORM**：跨 SQL（SQLite 本地 / Postgres 上线，仅换 `DATABASE_URL`）
- **OpenAI SDK（兼容模式）**：`baseURL / apiKey / model` 全可配 → 兼容 OpenAI / DeepSeek / 各类网关
- 测试：**Vitest + React Testing Library**

## 5. 整体架构（方案 A：分层单仓库）

```
┌─────────────────────────────────────────────┐
│ Next.js 16 App Router（Bun 运行，server-only）  │
│  app/  /(landing)  /shop  /product/[handle]   │
│  app/api/ai/chat → SSE 流                     │
│        │                                      │
│  server/catalog  CatalogAdapter               │
│    SeedAdapter（本期） ⇄ ShopifyAdapter（桩）   │
│        │                                      │
│  server/ai        AiProvider 抽象              │
│    OpenAICompat ⇄ MockGuide（无 key 自动）      │
│        │                                      │
│  server/search    embedder + keyword + 仓储    │
│        │                                      │
│  db（Drizzle）SQLite⇄Postgres：product_embeddings│
└─────────────────────────────────────────────┘
收藏夹 → localStorage（无登录） · 购买 CTA → 占位适配器
```

**关键取舍**

- 向量相似度在**应用层**计算（全量载入后余弦）：目录数十件规模无扩展负担，且免去 pgvector / sqlite-vec 的方言耦合。**限制条件**：商品数 ≤ ~2k；超出后再抽象原生向量后端（设计文档内显式记录）。
- AI 走 **RAG-lite、零工具调用**：任何 OpenAI 兼容网关（即使不支持 function calling）都能跑，Mock 与真实模型输入输出完全同构。
- 不做商品镜像同步（P4）：实时读 adapter + 懒计算 embedding 并缓存。

## 6. 目录层与数据模型

```ts
type CatalogAdapter = {
  getProducts(filter?: ProductFilter): Promise<Product[]>
  getProductByHandle(handle: string): Promise<Product | null>
  getCollections(): Promise<Collection[]>
  getBuyUrl(product: Product): Promise<string | null> // 无 store → null
}
```

`Product` 贴近 Shopify Storefront 形状，避免将来映射改写：
`id / handle / title / description / price{amount,currencyCode} / productType / tags / collections[] / image{remote?, localFallback} / sizes: US[] / features[] / fitNotes / material`。

**Seed**：16–20 双休闲日常鞋，4 个子系列（Everyday / Comfort / Travel / Minimal 等材质向分组）；USD 计价；图片 = 远程精选（Unsplash/Pexels）+ 本地 SVG 兜底（`next/image` 失败回退，adapter 层双保险）。

**筛选维度**：Collection / Size(US) / Price range / Sort；搜索框支持自然语言 → 走后端检索（见 §8）。

## 7. 本地数据库（Drizzle，跨 SQL）

单表，职责单一：

```ts
product_embeddings: {
  productId: text PK,
  contentHash: text,   // 商品文本 hash → 目录变更自动失效
  model: text,         // embedding 模型标识，换模型即整表重算
  vector: json,        // 不透明存储，应用层余弦
}
```

- 不做收藏表（localStorage，P6）、不做 AI 会话表（仅会话内记忆）。
- SQLite 文件默认；Postgres 仅换 `DATABASE_URL` + drizzle 方言配置。

## 8. AI 助手设计

### 8.1 交互形态

右下低调 FAB（"Need a hand?"）→ Sheet 面板；消息流式 markdown + 商品卡（可点击跳详情）；PDP 上带当前商品上下文 chip；建议 chips 用消费者措辞：`Find my size` / `Style it with` / `Help me pick` / `Everyday sneakers under $150`；会话随页面刷新重置（仅当次记忆）。

### 8.2 四种能力（消费者措辞 ↔ 内部模式）

| 消费端措辞 | 内部 | 流程 |
|---|---|---|
| 找鞋帮助 / Help me pick | shopping | 用户提问 → 检索注入上下文 → 模型仅基于注入内容回答并引用商品 |
| Find my size | size-fit | 附该鞋美码尺码表 + fitNotes，引导式问脚型/习惯码 → 推荐 + 解释 |
| Style ideas / Style it with | outfit | 以当前商品为主角的搭配建议 |
| 搜索框自然语言 / 浏览找鞋 | find-shoes | 显式检索 → 商品卡网格 + 一句总结 |

导购人设：专业、亲切、克制（资深店员），不推销、不臆造库存/价格以外的信息。

### 8.3 降级链（P2/P3）

1. `AI_API_KEY` 为空 → **MockGuide**（确定性规则回复 + 真实检索卡，UI 与真实一致）
2. 有 key → OpenAICompat（`AI_BASE_URL`/`AI_MODEL` 可配）
3. 调用失败 → SSE `error` 事件 + UI 重试，**不静默降级**
4. 检索 embedding：端点支持 `/embeddings` → 向量余弦；不支持 → 关键词召回 + 分值重排（两条路径结果以 `productCards` 同构返回）

### 8.4 传输协议

`POST /api/ai/chat` → SSE 流，行格式：

```
{ type: 'delta', text }
{ type: 'productCards', items: [{handle,title,price,image}] }
{ type: 'sizeFit', recommended, alternatives, rationale }
{ type: 'done' } | { type: 'error', message }
```

客户端 AbortController 中断即停流。不采集个人信息进上下文。

## 9. 前端页面与组件

**设计语言**：暖白 `#FAFAF8` 底 / 墨色 `#111` / 单一强调色；展示型衬线标题（Newsreader/Fraunces 类）+ 几何无衬线正文；Tailwind v4 token；全站英文；`next/image` + remotePatterns；SSG（Landing/详情）+ SSR（列表，searchParams 驱动）。

**AppBar**（sticky）：Hero 上透明 → 滚动毛玻璃实底；Logo（品牌占位名，`lib/site.ts` 单点配置，可替换）+ 导航（Shop / Collections / Our Story）+ 搜索入口 + 愿望单计数（localStorage）+ 移动 Sheet 菜单。

**Landing `/`**：全屏 Hero（编辑感大图 + 一句主张 + Shop CTA）→ 承诺条 → 4 系列卡 → 精选商品格 → "Comfort, measured" 叙事区 → Footer。**整页零 AI 痕迹。**

**列表 `/shop`**：URL 状态筛选（`?collection&size&minPrice&maxPrice&sort&q`）服务端渲染；商品卡（图/名/价/愿望单心形）；骨架屏 + 空状态；无分页。

**详情 `/product/[handle]`**：图片廊 → 信息区 → 美码尺码选择器 → "Find my size" 内嵌入口 → 材质/合脚手风琴 → 主 CTA → 相关推荐。
CTA 占位阶段文案："Available soon — checkout lands on our Shopify store."；无 store 时 `getBuyUrl → null` → 按钮禁用态 + toast；有凭证/URL 后代码路径直接生效。

**助手**：FAB → Sheet（a11y：focus trap / aria / 键盘可达），消息流式渲染，建议 chips，会话重置。

## 10. 仓库布局

```
src/
  app/  layout, page(landing), shop/page, product/[handle]/page,
        api/ai/chat/route, (not-found/error/loading)
  components/  ui(shadcn) · marketing · shop · assistant
  server/  catalog/(adapter,seed,shopify-stub,types,data) · ai/(provider,openai-compat,mock,chat,prompts) · search/(embedder,keyword,repository)
  db/      schema, client, migrations
  lib/     site.ts, utils
data/seed/    商品图片引用等外置资源
docs/superpowers/specs/  本规格
```

`server-only` 包 + 目录约定守卫边界；预留下环境：`SHOPIFY_STOREFRONT_TOKEN / SHOPIFY_DOMAIN`（本期忽略）。

## 11. 环境变量（提供 `.env.local.example`）

| 变量 | 说明 |
|---|---|
| `AI_API_KEY` | 空 → Mock 模式（默认可演示） |
| `AI_BASE_URL` / `AI_MODEL` | OpenAI 兼容端点与模型 |
| `AI_EMBEDDING_MODEL` | 缓存行标记 + 切换时整表重算 |
| `DATABASE_URL` | 默认 `file:./data/local.db`；上线换 Postgres |
| `SHOPIFY_*` | 预留（本期忽略） |

## 12. 工程 / 测试 / 可靠性

- **脚本**（Bun）：`dev / build / start`、`db:generate / db:push`、`test`、`typecheck`、`lint`；门禁 = lint + typecheck + test + build。
- **测试（v1）**：Vitest —— seed 筛选、检索排序（余弦/关键词 golden cases）、Mock provider 输出契约（§8.4 行格式）、意图路由、美元格式化；RTL —— 助手流式渲染（mock SSE）、尺码选择器、筛选与 URL 同步、愿望单切换。
- **错误处理**：路由层 try/catch → SSE `error` + UI 重试；商品缺失 `notFound()`；全局 `error.tsx / not-found.tsx / loading.tsx`。
- **性能/SEO**：`generateMetadata` + OG；图片全部 `next/image`（remotePatterns + 本地兜底）；markdown 用轻量渲染（不引重型依赖）。
- **合规**：无 cookie、无埋点；不存个人信息。
- 品牌名、文案均集中配置，便于日后替换。

## 13. 已确认决策与理由（决策日志摘要）

1. 交易在 Shopify，本站只做浏览与 AI 辅助 → 范围最小化，聚焦前端价值
2. 方案 A 分层单仓库（vs 镜像同步 Agent / 无库 SSG）→ 与全部已选决策咬合、交付最快、边界清晰可渐进升级
3. RAG-lite 无工具调用 → 任意兼容网关可用 + Mock 完全同构
4. 应用层余弦向量（vs 原生向量扩展）→ 免方言耦合，≤2k 商品限制显式记录
5. 消费端 AI 克制呈现 → 面向真实消费者，不把技术当卖点（用户明确要求）
6. 有 key 失败不静默降级 → 演示诚实性
7. 无登录/无本站购物/收藏 localStorage/AI 仅会话记忆 → 隐私最小 + 范围控制

## 14. 待办下一步

规格经用户审阅后 → **writing-plans** 产出分阶段实现计划（含脚手架锁定版本、seed 内容清单、SSE 契约落地顺序、测试顺序、验收清单）。
