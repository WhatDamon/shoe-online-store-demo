# 鞋类购物网站 · 前端体验 + 克制的 AI 助手 — 设计规格

> 日期：2026-09-04 · 状态：已获用户批准；2026-09-05 增补决策 #12–#14（双驱动 DB / 云端选型 / Shopify 映射缺口）

## 1. 概述与定位

一个**真实产品雏形**级别的鞋类品牌前端站点（**英语 / USD，国际市场**）。交易与结算不在此站——用户将采用 **Shopify 作为购物端**，本站聚焦：

1. **落地页 / 选购页**（品牌门面 + 商品浏览与详情）
2. **克制的 AI 辅助**（导购 / 尺码 / 搭配 / 自然语言找鞋），以消费者友好、非"AI 炫耀"的方式呈现

**品类聚焦**：3D 打印休闲日常鞋（3D-printed casual / lifestyle，数字制造气质），单性别向 unisex。**鞋码市场适配**：尺码体系由市场配置（`SITE_MARKET`，默认 US）驱动，经脚长 mm 锚定换算表支持 US / EU / UK / JP / CN 等切换（§6）。

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
| P2 | 无凭证可演示 | 默认 env 即全功能 Mock：无 key → Mock AI、无 Shopify → Seed 商品、主图本地程序化生成（离线自洽） |
| P3 | 诚实失败 | 有 key 但调用失败 → 明确报错 + 重试，**不静默降级**为 Mock（防"假成功"演示） |
| P4 | 单一事实源 | 商品实时从 CatalogAdapter 拉取（现为 Seed），本地库只存派生缓存（embedding 快照） |
| P5 | 面向隔离 | server-only 边界、适配器契约、类型化数据流；改实现不改调用方 |
| P6 | 隐私最小 | 无 cookie、无埋点、无个人信息进 AI 上下文；仅当次会话记忆 |
| P7 | **成本护栏** | 开放无鉴权端点必须自带多层限流与预算（回合/令牌/日预算），防脚本刷量与"免费聊天室"式滥用（§8.5） |

## 4. 技术栈（经版本调研确认的组合）

- **Bun** 1.3.x：包管理 + 脚本运行（`bun run dev` 等）
- **Next.js 16**（App Router + React 19 + TypeScript，Turbopack 构建）；版本在脚手架时锁定最新稳定
- **shadcn/ui + Tailwind CSS v4**：组件与设计 token
- **Drizzle ORM**：双驱动（决策 #13）——`DB_DRIVER=sqlite|postgres` 选择；SQLite 本地默认，Postgres 连云端（Cloud SQL，决策 #12）。schema 按方言各一份（仅 2 张表，成本可控），不再是“仅换 `DATABASE_URL`”
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
│  db（Drizzle）SQLite⇄Postgres：embeddings+usage   │
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
`id / handle / title / description / price{amount,currencyCode} / productType / tags / collections[] / image{localGenerated, remote?} / sizes: canonical[] / features[] / fitNotes / material / construction（打印结构参数）`。

**尺码模型（多市场）**：商品可用范围以**单一规范体系**录入（建议 EU 整档，如 36–48）；`sizeCharts.ts` 以**脚长 mm 为锚**提供 US / EU / UK / JP / CN 双向换算表；渲染、筛选与"Find my size"均先换算到 `SITE_MARKET` 指定体系再展示。单一事实源不漂移；进入新市场只需补一张换算表 + 改配置。

**Seed**：16–20 双 **3D 打印**休闲日常鞋，4 个子系列（Everyday / Comfort / Travel / Minimal）；描述/特性/构造体现打印制造（格纹结构、按单生产、零废料）；USD 计价；主图 = **本地程序化生成的 3D 打印鞋 SVG**（组件化参数渲染：格纹/网格外观、多视角、离线一致、零图床依赖），每商品保留 `remote` 字段供未来真实素材/Shopify 图替换，远程图仅作 lifestyle 场景补充（失败静默回退主图）。

**筛选维度**：Collection / Size（当前市场体系）/ Price range / Sort；搜索框支持自然语言 → 走后端检索（见 §8）。

## 7. 应用数据库（Drizzle，双驱动 `DB_DRIVER`）

两表，各司其职：

```ts
product_embeddings: {
  productId: text PK,
  contentHash: text,   // 商品文本 hash → 目录变更自动失效
  model: text,         // embedding 模型标识，换模型即整表重算
  vector: json,        // 不透明存储，应用层余弦
}

ai_usage: {           // 匿名成本计量（§8.5），无个人信息
  id: PK,              // sqlite AUTOINCREMENT / pg serial（随驱动）
  day: text,           // YYYY-MM-DD，日预算聚合键
  model: text,
  promptTokens: integer,
  completionTokens: integer,
  sessionKey: text,    // 匿名会话指纹
  createdAt: integer,  // 毫秒时间戳（pg 用 bigint，防 2038 溢出）
}
```

- 不做收藏表（localStorage，P6）、不做 AI 会话表（仅会话内记忆；回合计数走内存，见 §8.5）。
- **驱动选择（决策 #13）**：`DB_DRIVER=sqlite|postgres`，默认 `sqlite`（本地 `./data/local.db`，行为与今完全一致）；`postgres` 面向 Cloud SQL（决策 #12）。驱动在 `db()` 单例内**懒加载**判定（与 `market.code` 同类先例），启动即校验，未知值报错。
- **schema 按方言两份小文件**（`sqlite-core` / `pg-core`），列语义对齐 + 契约测试防漂移；两侧均保留启动自动 `CREATE TABLE IF NOT EXISTS`（零迁移 DX）；drizzle-kit 迁移留待 schema 演进再启用。
- **pg 驱动选 `postgres.js`**：Bun（本地）与 Node（Vercel / Cloud Run / Functions）双运行时通用——部署目标未定不阻塞。部署待定项（连接池形态 / Cloud SQL connector / 护栏出内存）记录于决策 #12，届时另议。
- 修正早期“Postgres 仅换 `DATABASE_URL`”表述：方言、驱动、schema、测试 seam 需同步改（决策 #13）。

## 8. AI 助手设计

### 8.1 交互形态

右下低调 FAB（"Need a hand?"）→ Sheet 面板；消息流式 markdown + 商品卡（可点击跳详情）；PDP 上带当前商品上下文 chip；建议 chips 用消费者措辞：`Find my size` / `Style it with` / `Help me pick` / `Everyday sneakers under $150`；会话随页面刷新重置（仅当次记忆）。

### 8.2 四种能力（消费者措辞 ↔ 内部模式）

| 消费端措辞 | 内部 | 流程 |
|---|---|---|
| 找鞋帮助 / Help me pick | shopping | 用户提问 → 检索注入上下文 → 模型仅基于注入内容回答并引用商品 |
| Find my size | size-fit | 附该鞋在当前市场体系尺码表（canonical → 换算）+ fitNotes，引导式问脚型/习惯码 → 推荐 + 解释 |
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

### 8.5 成本与滥用防护（多层护栏，P7）

**威胁模型**：无鉴权开放 API 可被脚本刷量 · 会话回合/上下文无上限使单次调用成本递增 · 被当通用闲聊只烧钱 · 超长输出与无限流 · 多实例/重启使内存计数失效。

护栏逐层收紧（全部在无登录前提下成立）：

1. **会话层**：客户端 uuid 会话（页面刷新即轮换）；每会话回合上限 `AI_MAX_TURNS`（默认 20，超限温和提示并建议开启新对话）；历史仅保留最近 6 轮；闲置 30 分钟过期（内存 TTL）。上下文有界 ⇒ 单次成本有上界。
2. **请求层**：输出 token 上限 `AI_MAX_OUTPUT_TOKENS`（默认 500）；请求超时 `AI_REQUEST_TIMEOUT_MS`（默认 20s，AbortController 硬中断）；消息长度上限（服务端校验）；IP 与会话双维度**内存令牌桶**限流（默认 10 次/分/IP）。单进程假设明示：多实例部署须迁移边缘限流或 Redis（见未来项）。
3. **用量与预算（诚实兜底）**：匿名表 `ai_usage`（§7）记录每次调用估算 token；请求前按 `AI_DAILY_TOKEN_CAP`（默认 ~1M token/日）对当日 SUM 校验，超额返回温和拒答（"The assistant is taking a short break — try again later."）。SQLite 落盘 ⇒ 重启与多实例间口径一致。
4. **产品引导（治本）**：system prompt 限定购物话题；离题 → ≤2 句礼貌转回 + 2 个建议 chip，不写长文；回答仅基于注入的商品上下文，无工具调用、不接外部（§8.2 RAG-lite 即最低安全面）。
5. **Mock 默认 + 总开关**：无 key = Mock（零成本）；真实 API 需显式填 key；env `AI_DISABLE_REAL=1` 遇滥用一键切回 Mock。
6. **文案守则**：限流/超限消息一律消费者化人话（"taking a short break"），不暴露 "rate limited" 等工程措辞（P1）。
7. **未来项（记录不实现）**：部署后加边缘/WAF 限流与 Turnstile；若引入账户再按账号配额、用户级计量与告警。

## 9. 前端页面与组件

**设计语言**：暖白 `#FAFAF8` 底 / 墨色 `#111` / 单一强调色；展示型衬线标题（Newsreader/Fraunces 类）+ 几何无衬线正文；Tailwind v4 token；全站英文；主图由组件化参数渲染 inline SVG（无网络请求），可选 lifestyle 远程图走 `next/image` remotePatterns + 静默兜底；SSG（Landing/详情）+ SSR（列表，searchParams 驱动）。

**AppBar**（sticky）：Hero 上透明 → 滚动毛玻璃实底；Logo（品牌占位名，`lib/site.ts` 单点配置，可替换）+ 导航（Shop / Collections / Our Story）+ 搜索入口 + 愿望单计数（localStorage）+ 移动 Sheet 菜单。

**Landing `/`**：全屏 Hero（编辑感大图 + 一句主张 + Shop CTA）→ 承诺条 → 4 系列卡 → 精选商品格 → "Comfort, measured" 叙事区 → Footer。**整页零 AI 痕迹。**

**列表 `/shop`**：URL 状态筛选（`?collection&size&minPrice&maxPrice&sort&q`）服务端渲染；商品卡（图/名/价/愿望单心形）；骨架屏 + 空状态；无分页。

**详情 `/product/[handle]`**：图片廊（本地生成图多视角）→ 信息区 → 尺码选择器（当前市场体系）→ "Find my size" 内嵌入口 → 材质/合脚手风琴 → 主 CTA → 相关推荐。
CTA 占位阶段文案："Available soon — checkout lands on our Shopify store."；无 store 时 `getBuyUrl → null` → 按钮禁用态 + toast；有凭证/URL 后代码路径直接生效。

**助手**：FAB → Sheet（a11y：focus trap / aria / 键盘可达），消息流式渲染，建议 chips，会话重置。

## 10. 仓库布局

```
src/
  app/  layout, page(landing), shop/page, product/[handle]/page,
        api/ai/chat/route, (not-found/error/loading)
  components/  ui(shadcn) · marketing · shop · assistant · product(视觉生成)
  server/  catalog/(adapter,seed,shopify-stub,types,sizeCharts) · ai/(provider,openai-compat,mock,chat,prompts) · search/(embedder,keyword,repository)
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
| `AI_MAX_TURNS` / `AI_MAX_OUTPUT_TOKENS` / `AI_REQUEST_TIMEOUT_MS` | 护栏默认 20 回合 / 500 token / 20s（§8.5） |
| `AI_DAILY_TOKEN_CAP` | 每日 token 预算，超限温和拒答（默认 ~1M/日） |
| `AI_DISABLE_REAL` | 强制 Mock 总开关（遇滥用一键止血） |
| `SITE_MARKET` | 市场配置（默认 `US`），决定尺码展示体系（US/EU/UK/JP/CN，§6 换算） |
| `DB_DRIVER` | `sqlite`（默认）/ `postgres`：应用数据库驱动选择（决策 #13） |
| `DATABASE_URL` | sqlite：本地文件（默认 `./data/local.db`）；postgres：`postgres://…` 连 Cloud SQL |
| `SHOPIFY_*` | 预留（本期忽略） |

## 12. 工程 / 测试 / 可靠性

- **脚本**（Bun）：`dev / build / start / test / typecheck / lint / format / format:check`；DB 迁移命令（drizzle-kit `db:generate / db:migrate`）待 schema 演进时启用（当前启动自动建表）；门禁 = lint + typecheck + test + build。
- **测试（v1）**：Vitest —— seed 筛选、检索排序（余弦/关键词 golden cases）、Mock provider 输出契约（§8.4 行格式）、意图路由、美元格式化；尺码 —— 换算表 golden（US/EU/UK/JP/CN ↔ mm）、市场筛选与展示换算；护栏 —— IP/会话令牌桶限流、回合上限与历史裁剪、日预算强制（内存 SQLite）、离题 redirect 与限流温和文案 golden；RTL —— 助手流式渲染（mock SSE）、尺码选择器、筛选与 URL 同步、愿望单切换、发送中禁发与超时中止。
- **错误处理**：路由层 try/catch → SSE `error` + UI 重试；商品缺失 `notFound()`；全局 `error.tsx / not-found.tsx / loading.tsx`。
- **性能/SEO**：`generateMetadata` + OG（本地生成）；主图 inline SVG（零网络请求），lifestyle 远程图 `next/image` + 静默兜底；markdown 用轻量渲染（不引重型依赖）。
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
8. 多层护栏防 AI 滥用/烧钱 → 开放无鉴权端点必须自带上限与预算；护栏文案同样克制化（用户补充的硬约束）
9. 鞋码多市场 = 配置级单市场切换（`SITE_MARKET` 默认 US）+ 脚长 mm 锚换算表 → 数据/换算先行，全站仍英文/USD，新市场仅补表改配置
10. 产品定位 = 3D 打印休闲鞋：本期商品字段/描述先行体现打印制造，Landing 品牌叙事暂缓（用户分期决策）
11. 主图改本地程序化 SVG（组件化参数渲染）→ 3D 定位素材自洽、离线一致、零图床依赖；`remote` 字段保留供真实素材替换
12. **云端数据库澄清与选型**：不存在 “Firebase Cloud SQL”。目标 = **GCP Cloud SQL for PostgreSQL**（保留 Drizzle/关系型：ai_usage 日 SUM 与未来订单×商品分析顺畅）；Firestore 备选被否（NoSQL → 弃 ORM/SQL）。**部署目标未定**（Vercel / Cloud Run / Functions）→ 以运行时通用 pg 驱动解耦，不阻塞开发（用户决策 2026-09-05）
13. **SQLite 保留 + `.env` 双驱动**：`DB_DRIVER=sqlite|postgres`（默认 sqlite，本地/测试零回归）；Postgres 路径用 `postgres.js`（Bun/Node 通用）；schema 按方言两小份 + 契约测试；`db()` 懒分派；启动自动建表两侧保留，drizzle-kit 迁移延后。**修正旧表述**：Postgres 不是“仅换 `DATABASE_URL`”（方言/驱动/schema/测试 seam 需同步改）（用户决策 2026-09-05）
14. **Shopify 真接入的数据映射缺口（实现时落定）**：商品仍直读 Storefront、**不镜像**（P4：无 products 表、无 webhook）；3D 专属字段（construction/palette/density/features/fitNotes/subtitle）经 product metafields（Admin 写、Storefront 读）；sizes：Shopify variant 选项值 → canonical EU 的源映射策略；`getBuyUrl` 以商品/变体直达链接起步，checkout 就绪后换 cart→checkoutUrl；PDP 切 Storefront 后改 dynamic/ISR（构建期依赖 Shopify 在线）（记录于 2026-09-05 设计评审）

## 14. 待办下一步

规格经用户审阅后 → **writing-plans** 产出分阶段实现计划（含脚手架锁定版本、seed 内容清单、SSE 契约落地顺序、测试顺序、验收清单）。
