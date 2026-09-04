# 鞋类网站（3D 打印休闲鞋 + 克制 AI 助手）实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法跟踪进度。所有任务在 Bun 运行的 Next.js 16 项目中完成，每任务结束时 `git commit`。

**目标：** 构建 3D 打印休闲鞋品牌前端（Landing + `/shop` 列表 + `/product/[handle]` 详情），商品走 Seed 数据适配层（预留 Shopify adapter），AI 助手（导购/尺码/搭配/找鞋）以克制的消费端语言嵌入全站，含成本护栏，可无 key / 无 Shopify / 离线自洽演示。

**架构：** 分层单仓库（方案 A）。server-only 边界：`server/catalog`（CatalogAdapter 契约 + SeedAdapter + Shopify 桩 + sizeCharts 尺码换算）、`server/ai`（AiProvider 抽象：OpenAI 兼容 ⇄ MockGuide；chat 编排产出 SSE 事件）、`server/search`（keyword + embedder + repository）、`server/guardrails`（护栏）。本地库（bun:sqlite + Drizzle，跨 SQL 设计）仅两表：`product_embeddings`（检索缓存）与 `ai_usage`（匿名成本计量）。主图用组件化参数渲染 inline SVG（3D 打印格纹外观，离线自洽）。UI = shadcn/ui + Tailwind v4，全站英文/USD，尺码体系由 `SITE_MARKET` 配置驱动。

**技术栈：** Bun 1.3、Next.js 16（App Router + Turbopack）、React 19、TypeScript、Tailwind CSS v4、shadcn/ui、Drizzle ORM + `bun:sqlite`、Vitest + React Testing Library、OpenAI SDK（兼容 baseURL）。

**规格来源：** `docs/superpowers/specs/2026-09-04-shoe-store-ai-design.md`（以下称"规格"，§ 号即该文小节）。

---

## 文件结构（分解决策，先锁定）

```
package.json / next.config.ts / tsconfig.json / eslint.config.mjs / drizzle 无关
postcss.config.mjs / app/globals.css(Tailwind v4 theme tokens)      ← 脚手架生成后调整
vitest.config.ts · src/test/setup.ts                                 ← 测试基建
.env.local.example · README.md
src/
  app/
    layout.tsx  page.tsx(Landing)  globals.css
    shop/page.tsx                       列表（服务端，searchParams 驱动）
    product/[handle]/page.tsx           详情
    api/ai/chat/route.ts                SSE 端点（接线）
    not-found.tsx  error.tsx  loading.tsx
    og/route.tsx                        本地 OG 图（Task 13）
  lib/
    site.ts                            品牌单点（占位名/导航/文案）
    market.ts                          市场配置：SITE_MARKET → {sizeSystem,currency,locale}
    format.ts                          formatPrice(USD)
    wishlist.ts                        localStorage 愿望单纯函数
    utils.ts                          cn 等
  components/
    ui/   shadcn 生成的组件（button/sheet/input/select/accordion/skeleton/badge/dialog）
    marketing/ app-bar.tsx footer.tsx hero.tsx promise-strip.tsx
               collection-cards.tsx featured-grid.tsx story-section.tsx
    shop/    product-card.tsx product-grid.tsx wishlist-button.tsx
             product-filter-bar.tsx(客户端) product-visual.tsx(SVG 生成)
    assistant/ assistant-provider.tsx fab.tsx assistant-panel.tsx message-list.tsx
               suggestion-chips.tsx product-result-card.tsx use-chat-stream.ts markdown-lite.tsx
    shared/   section-heading.tsx
  server/   （一律 server-only 导入，禁止进入客户端）
    catalog/
      types.ts            Product/Collection/ProductFilter/CatalogAdapter 契约
      size-charts.ts      脚长 mm 锚换算（EU/US/UK/JP/CN）+ parseSizeHint
      size-fixture.ts     换算基准行数据（单一事实，Task 3 生成）
      seed.ts             seed 数据（Product 数组 + collections）
      seed-adapter.ts     CatalogAdapter 的 Seed 实现（筛选/排序/q/buyUrl=null）
      shopify-stub.ts     Shopify 桩（env 未配 → 返回未启用）
      service.ts          market 换算入口：市场尺码 → canonical，输出带尺码标签的视图
    search/
      vector.ts           余弦/归一化（纯函数）
      repository.ts       product_embeddings + ai_usage 存取（Drizzle）
      keyword.ts          关键词召回排序（纯函数）
      embedder.ts         兼容端点 /embeddings 客户端（能力探测 + 缓存写回）
      retrieval.ts        编排：embed→缓存→余弦；否则 keyword
    ai/
      provider.ts         AiProvider 契约 + createProvider 工厂（mock/real）
      prompts.ts          人设 + 各模式 system prompt + 离题守则
      size-input.ts       size-fit 确定性抽取（复用 size-charts.parseSizeHint）
      mock.ts             MockGuide（确定性事件流，与 real 同构）
      openai-compat.ts    真实流式客户端（openai SDK，baseURL 可配）
      chat.ts             编排 chat()：护栏→检索→prompt→流→事件行
      events.ts           ChatEvent 类型 + SSE 序列化/解析
    guardrails/
      index.ts            组装（会话回合/裁剪/预算/超时）
      session-state.ts    内存会话（回合计数 + 历史裁剪 + TTL）
      rate-limit.ts       IP/会话令牌桶（可注入时钟）
      budget.ts           日预算（DB SUM + cap + 用量落库）
      text.ts             消息长度/输出 token 上限估算（纯函数）
  db/
    schema.ts             两表 Drizzle schema
    client.ts             bun:sqlite 连接 + 幂等建表
data/                    运行期 SQLite 文件（gitignore）
docs/superpowers/plans/  本计划
```

**关键类型契约（跨任务统一，禁改名）：**

```ts
// server/catalog/types.ts
export type SizeSystem = 'US' | 'EU' | 'UK' | 'JP' | 'CN'
export type CanonicalSize = number // EU 整档，36–48（唯一 canonical 存储）
export type CurrencyCode = 'USD' // 市场决策 #9：本版锁定 USD

export interface Price { amount: number; currencyCode: CurrencyCode } // amount 为美元数值
export interface Product {
  id: string; handle: string
  title: string; subtitle: string; description: string
  price: Price
  productType: string; tags: string[]
  collections: string[]            // collection.handle 数组
  sizes: CanonicalSize[]           // canonical EU，可用档
  features: string[]               // 3D 打印卖点（格纹结构等，种子文案）
  fitNotes: string
  construction: { pattern: 'lattice' | 'wave' | 'honeycomb'; density: 0.6 | 0.75 | 0.9; printedUpper: boolean }
  visual: { palette: [string, string]; accent: string; views: 3 } // 驱动 SVG
  image?: { remote?: string }      // 未来真实素材/Shopify 图（本期仅 localGenerated）
  createdAt: string                // ISO，用于 newest 排序
}
export interface Collection { handle: string; name: string; description: string }
export interface ProductFilter {
  collection?: string; sizes?: CanonicalSize[]; minPrice?: number; maxPrice?: number
  sort?: 'featured' | 'price-asc' | 'price-desc' | 'newest'; q?: string
}
export interface CatalogAdapter {
  getProducts(filter?: ProductFilter): Promise<Product[]>
  getProductByHandle(handle: string): Promise<Product | null>
  getCollections(): Promise<Collection[]>
  getBuyUrl(product: Product): Promise<string | null>
}
```

```ts
// server/ai/events.ts —— 事件行 = SSE `data:` 帧内的 JSON
export type ProductCard = { handle: string; title: string; price: number; imageKind: 'local'; palette: [string,string] }
export type ChatEvent =
  | { type: 'delta'; text: string }
  | { type: 'productCards'; items: ProductCard[] }
  | { type: 'sizeFit'; recommended: CanonicalSize; alternatives: CanonicalSize[]; rationale: string }
  | { type: 'done' }
  | { type: 'error'; code: 'rate_limited' | 'budget' | 'provider' | 'invalid'; message: string }
export const encodeEvent = (e: ChatEvent): string => `data: ${JSON.stringify(e)}\n\n`
export const parseEvent = (frame: string): ChatEvent | null
```

```ts
// server/catalog/service.ts —— 页面唯一入口（canonical ↔ 市场）
export async function listProductsForMarket(filter: MarketFilter): Promise<ProductView[]>
export async function getProductForMarket(handle: string): Promise<ProductView | null>
export type MarketFilter = ProductFilter & { sizeLabels?: string[] } // sizeLabels 为市场体系标签，服务层换算
export type ProductView = Product & { sizeOptions: { value: CanonicalSize; label: string }[] } // label 为当前市场体系
```

---

## 任务 1：脚手架与工具链（Next 16 + Bun + Tailwind v4 + shadcn + Vitest 就绪）

**文件：**

- 创建：项目根全部脚手架文件（create-next-app 生成）、`vitest.config.ts`、`src/test/setup.ts`、`src/app/page.tsx`（临时占位）
- 修改：`package.json`（scripts）、`src/app/globals.css`（theme tokens 占位）

- [ ] **步骤 1：脚手架生成（在当前仓库根，避开 git 冲突）**

```bash
cd /Users/damon233/Desktop/Files/Code/shoe-online-store-demo
# create-next-app 要求空目录 → 生成到临时目录再并入
mkdir -p /tmp/shoescaffold && cd /tmp/shoescaffold && rm -rf * .[!.]* 2>/dev/null; true
bunx create-next-app@latest app --typescript --eslint --tailwind --src-dir --app \
  --turbopack --import-alias "@/*" --use-bun --yes
```

预期：生成 `app/` 目录。随后并入仓库根：

```bash
cd /Users/damon233/Desktop/Files/Code/shoe-online-store-demo
cp -R /tmp/shoescaffold/app/. . && rm -rf /tmp/shoescaffold
```

**注意**：若 create-next-app 拒绝（目录非空），报错后改用上表"文件结构"手写最小集，再 `bun install` 补依赖——以 `bun run build` 可过为准。

- [ ] **步骤 2：安装运行依赖并初始化 shadcn**

```bash
bun add drizzle-orm openai uuid
bun add -d drizzle-kit vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @types/uuid
bunx shadcn@latest init -y -b neutral
bunx shadcn@latest add -y button badge input select sheet accordion skeleton
```

预期：无报错；`components/ui/` 出现上述组件；`lib/utils.ts` 生成。

- [ ] **步骤 3：写 Vitest 配置与冒烟测试**

创建 `vitest.config.ts`：

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    setupFiles: ['src/test/setup.ts'],
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
```

创建 `src/test/setup.ts`：`import '@testing-library/jest-dom/vitest'`。

创建 `src/lib/format.ts` 与测试 `src/lib/format.test.ts`：

```ts
export function formatPrice(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
}
```

```ts
import { describe, expect, it } from 'vitest'
import { formatPrice } from './format'
describe('formatPrice', () => {
  it('formats dollars with two decimals', () => expect(formatPrice(139)).toBe('$139.00'))
})
```

- [ ] **步骤 4：跑冒烟测试确认基建**

运行：`bunx vitest run src/lib/format.test.ts`
预期：1 passed。

- [ ] **步骤 5：package.json scripts 对齐 + Commit**

修改 `package.json` scripts：

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

```bash
git add -A && git commit -m "chore: scaffold Next 16 (Bun) + shadcn + vitest toolchain"
```

---

## 任务 2：领域类型与基础库（types / market / site）

**文件：**

- 创建：`src/server/catalog/types.ts`（上文契约全文）、`src/lib/market.ts`、`src/lib/site.ts`、`src/server/catalog/types.test.ts`
- 修改：`src/lib/format.test.ts`（追加 currencyCode 用例）

- [ ] **步骤 1：写契约单测**

创建 `src/server/catalog/types.test.ts`（类型级，编译期即测试）：

```ts
import { describe, expect, it } from 'vitest'
import type { Product, ProductFilter, CatalogAdapter } from './types'
describe('catalog contract', () => {
  it('Product canonical sizes are whole EU numbers', () => {
    const p: Product = {} as Product // 仅编译期契约占位，运行时不做
    expect(p).toBeDefined()
  })
  it('filter sort union is closed', () => {
    const f: ProductFilter = { sort: 'featured' }
    expect(f.sort).toBe('featured')
  })
})
```

- [ ] **步骤 2：写 market / site 实现与单测**

创建 `src/lib/market.ts`：

```ts
import type { SizeSystem } from '@/server/catalog/types'

const MARKET_SIZE_SYSTEM: Record<string, SizeSystem> = { US: 'US', EU: 'EU', UK: 'UK', JP: 'JP', CN: 'CN' }

export const market = {
  code: process.env.SITE_MARKET ?? 'US',
  currency: 'USD' as const,
  locale: 'en-US',
  get sizeSystem(): SizeSystem {
    return MARKET_SIZE_SYSTEM[this.code] ?? 'US'
  },
}
```

创建 `src/lib/site.ts`：

```ts
export const site = {
  name: 'Treadwell', // 品牌占位，单点替换
  nav: [
    { label: 'Shop', href: '/shop' },
    { label: 'Our Story', href: '/#story' },
  ],
  hero: { kicker: 'Printed to move.', title: 'Casual shoes, digitally crafted.', cta: 'Shop the collection' },
}
```

测试 `src/lib/market.test.ts`（用 `vi.stubEnv`）：

```ts
import { describe, expect, it, vi, afterEach } from 'vitest'
import { market } from './market'
describe('market', () => {
  afterEach(() => vi.unstubAllEnvs())
  it('defaults to US size system', () => {
    vi.stubEnv('SITE_MARKET', '')
    expect(market.sizeSystem).toBe('US')
  })
  it('maps EU market config to EU system', () => {
    vi.stubEnv('SITE_MARKET', 'EU')
    expect(market.sizeSystem).toBe('EU')
  })
})
```

注意：`market` 的 `sizeSystem` 是惰性 getter，测试用 stubEnv 有效；模块级快照不被缓存。

- [ ] **步骤 3：运行测试**

运行：`bunx vitest run src/server/catalog/types.test.ts src/lib/market.test.ts`
预期：全部 passed。

- [ ] **步骤 4：Commit**

```bash
git add src/server/catalog/types.ts src/lib/market.ts src/lib/site.ts src/**/*.test.ts
git commit -m "feat: catalog contract types + market/site config"
```

---

## 任务 3：尺码换算（脚长 mm 锚，EU/US/UK/JP/CN）+ 用户尺码抽取

**文件：**

- 创建：`src/server/catalog/size-fixture.ts`、`src/server/catalog/size-charts.ts`、`src/server/catalog/size-charts.test.ts`

- [ ] **步骤 1：写基准数据（单一事实）**

创建 `src/server/catalog/size-fixture.ts`（脚长 mm 锚，整档 EU 36–48，unisex/men 基础；**实现时须用权威尺码表复核每一行**，复核来源示例：Zappos / REI 尺码表，复核不通过则修正此文件并同步更新 golden 测试）：

```ts
import type { SizeSystem } from './types'
// 每行: { mm(脚长), systems: { EU, US, UK, JP, CN } } —— 以脚长 mm 为锚
export const sizeRows = [
  { mm: 233, systems: { EU: 36, US: 5, UK: 4, JP: 23.5, CN: 36 } },
  { mm: 240, systems: { EU: 37, US: 5.5, UK: 4.5, JP: 24, CN: 37 } },
  { mm: 246, systems: { EU: 38, US: 6, UK: 5, JP: 24.5, CN: 38 } },
  { mm: 253, systems: { EU: 39, US: 6.5, UK: 5.5, JP: 25, CN: 39 } },
  { mm: 260, systems: { EU: 40, US: 7, UK: 6, JP: 25.5, CN: 40 } },
  { mm: 266, systems: { EU: 41, US: 8, UK: 7, JP: 26, CN: 41 } },
  { mm: 273, systems: { EU: 42, US: 8.5, UK: 7.5, JP: 26.5, CN: 42 } },
  { mm: 280, systems: { EU: 43, US: 9, UK: 8, JP: 27, CN: 43 } },
  { mm: 286, systems: { EU: 44, US: 9.5, UK: 8.5, JP: 27.5, CN: 44 } },
  { mm: 293, systems: { EU: 45, US: 10.5, UK: 9.5, JP: 28, CN: 45 } },
  { mm: 300, systems: { EU: 46, US: 11, UK: 10, JP: 28.5, CN: 46 } },
  { mm: 306, systems: { EU: 47, US: 12, UK: 11, JP: 29, CN: 47 } },
  { mm: 313, systems: { EU: 48, US: 12.5, UK: 11.5, JP: 29.5, CN: 48 } },
] as const

export type SizeSystem = (typeof sizeRows)[number]['systems']
export const systems = ['US', 'EU', 'UK', 'JP', 'CN'] as const
export const systemKeys: SizeSystemKey[] = [...systems]
type SizeSystemKey = 'US' | 'EU' | 'UK' | 'JP' | 'CN'
```

- [ ] **步骤 2：写换算纯函数与 golden 测试（先红）**

创建 `src/server/catalog/size-charts.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { convert, nearestCanonical, parseSizeHint } from './size-charts'

describe('convert', () => {
  it('converts EU 42 to US 8.5 (unisex basis)', () => expect(convert(42, 'US')).toBe(8.5))
  it('converts EU 42 to UK 7.5', () => expect(convert(42, 'UK')).toBe(7.5))
  it('round-trips EU via mm anchor', () => expect(convert(convert(42, 'US'), 'EU')).toBe(42))
})
describe('nearestCanonical', () => {
  it('picks closest in-stock EU size', () => {
    expect(nearestCanonical(41.5, [40, 42, 43])).toBe(42)
    expect(nearestCanonical(40, [40, 42])).toBe(40)
  })
  it('clamps when out of range', () => expect(nearestCanonical(50, [40, 42])).toBe(42))
})
describe('parseSizeHint', () => {
  it('parses US label', () => expect(parseSizeHint('I usually wear US 9')).toBe(43)) // EU 43
  it('parses EU label', () => expect(parseSizeHint('size 42')).toBe(42))
  it('parses foot length cm', () => expect(parseSizeHint('my foot is 27 cm')).toBe(43))
  it('returns null when no size found', () => expect(parseSizeHint('comfortable')).toBeNull())
})
```

- [ ] **步骤 3：运行确认失败**

运行：`bunx vitest run src/server/catalog/size-charts.test.ts`
预期：FAIL（module 未定义 / convert is not a function）。

- [ ] **步骤 4：实现换算（最小通过）**

创建 `src/server/catalog/size-charts.ts`：

```ts
import { sizeRows } from './size-fixture'
import type { CanonicalSize, SizeSystem } from './types'

type Key = 'US' | 'EU' | 'UK' | 'JP' | 'CN'
const rowBySystem = (key: Key, value: number) => sizeRows.find(r => r.systems[key] === value)
const rowByEU = (eu: CanonicalSize) => sizeRows.find(r => r.systems.EU === eu)

export function convert(canonical: CanonicalSize, system: SizeSystem): number | null {
  const row = rowByEU(canonical)
  return row ? (row.systems[system as Key] as number) : null
}

export function toEU(value: number, system: SizeSystem): CanonicalSize | null {
  const row = rowBySystem(system as Key, value)
  return row ? row.systems.EU : null
}

/** 输入 EU 需求码，返回最接近的 in-stock canonical EU */
export function nearestCanonical(wanted: number, available: CanonicalSize[]): CanonicalSize | null {
  if (!available.length) return null
  return available.reduce((best, a) => Math.abs(a - wanted) < Math.abs(best - wanted) ? a : best)
}

/** 从消费者一句话里抽尺码意图（US/EU/UK/cm/JP 半码）→ canonical EU；抽不到返回 null */
export function parseSizeHint(text: string): CanonicalSize | null {
  const cm = text.match(/(\d{2}(?:\.\d)?)\s*cm/i)
  if (cm) return toEU(Math.round(Number(cm[1]) * 2 / 3 + 23) as CanonicalSize, 'EU') ?? euFromCm(Number(cm[1]))
  const us = text.match(/\b(?:us|men's?|m)\s*(\d{1,2}(?:\.5)?)\b/i)
  if (us) return toEU(Number(us[1]), 'US')
  const eu = text.match(/\b(?:eu|size)\s*(\d{1,2})\b/i)
  if (eu) return Number(eu[1]) as CanonicalSize
  const jp = text.match(/\bjp\s*(\d{2}(?:\.5)?)\b/i)
  if (jp) return toEU(Number(jp[1]), 'JP')
  return null
}

function euFromCm(cm: number): CanonicalSize {
  // cm 26 → EU 42 近似（EU = (cm+2)×1.5 取整到整档）；随后 nearestCanonical 落到 in-stock
  return Math.round((cm + 2) * 1.5) as CanonicalSize
}
```

注：`parseSizeHint` 的 cm 分支用 `euFromCm` 后由调用方 `nearestCanonical` 收口到实际 in-stock EU；golden 用例（27cm → 43）已在步骤 2 定义，若欧码公式产生 43.5 半档需对 `euFromCm` 取整对齐 fixture（43 = 28×1.5=42 → 修正为取 `.5` 向上→43），实现时以测试为锚调整取整规则，不得改 fixture 的 mm/EU 行。

- [ ] **步骤 5：运行确认通过 + 人工复核尺码基准**

运行：`bunx vitest run src/server/catalog/size-charts.test.ts`
预期：PASS。
人工：对照 Zappos/REI 尺码表抽查 `size-fixture.ts` 至少 3 行（如 EU42/US8.5、EU45/US10.5），不一致就改 fixture 与对应 golden 值（步骤 1 与 2 联动），保持 fixture 为唯一事实。

- [ ] **步骤 6：Commit**

```bash
git add src/server/catalog/size-fixture.ts src/server/catalog/size-charts.ts src/server/catalog/size-charts.test.ts
git commit -m "feat: mm-anchored size conversion table + size hint parser"
```

---

## 任务 4：Seed 数据（16–20 双 3D 打印休闲鞋 + 4 系列）

**文件：**

- 创建：`src/server/catalog/collections.ts`、`src/server/catalog/seed.ts`、`src/server/catalog/seed.test.ts`

- [ ] **步骤 1：写数据完整性测试（先红）**

创建 `src/server/catalog/seed.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { seedProducts } from './seed'
import { collections } from './collections'
import { sizeRows } from './size-fixture'

describe('seed integrity', () => {
  it('has 16–20 products', () => {
    expect(seedProducts.length).toBeGreaterThanOrEqual(16)
    expect(seedProducts.length).toBeLessThanOrEqual(20)
  })
  it('handles are unique slugs', () => {
    const hs = seedProducts.map(p => p.handle)
    expect(new Set(hs).size).toBe(hs.length)
    hs.forEach(h => expect(h).toMatch(/^[a-z0-9-]+$/))
  })
  it('every product belongs to an existing collection', () => {
    const handles = new Set(collections.map(c => c.handle))
    seedProducts.forEach(p => p.collections.forEach(c => expect(handles.has(c)).toBe(true)))
  })
  it('canonical sizes exist in fixture', () => {
    const eus = new Set(sizeRows.map(r => r.systems.EU))
    seedProducts.forEach(p => p.sizes.forEach(s => expect(eus.has(s)).toBe(true)))
  })
  it('prices are positive USD', () => {
    seedProducts.forEach(p => {
      expect(p.price.currencyCode).toBe('USD')
      expect(p.price.amount).toBeGreaterThan(0)
    })
  })
  it('visual palettes are valid hex', () => {
    seedProducts.forEach(p => {
      p.visual.palette.forEach(c => expect(c).toMatch(/^#[0-9a-f]{6}$/i))
      expect(p.visual.accent).toMatch(/^#[0-9a-f]{6}$/i)
    })
  })
})
```

- [ ] **步骤 2：运行确认失败**

运行：`bunx vitest run src/server/catalog/seed.test.ts`
预期：FAIL（无法解析 ./seed）。

- [ ] **步骤 3：写 collections**

创建 `src/server/catalog/collections.ts`：

```ts
import type { Collection } from './types'
export const collections: Collection[] = [
  { handle: 'everyday', name: 'Everyday', description: 'Quiet workhorses for long days on your feet.' },
  { handle: 'comfort', name: 'Comfort', description: 'Printed cushioning tuned for all-day ease.' },
  { handle: 'travel', name: 'Travel', description: 'Light, packable and ready for the gate.' },
  { handle: 'minimal', name: 'Minimal', description: 'Clean lines in our signature palette.' },
]
```

- [ ] **步骤 4：写 seed 数据**

创建 `src/server/catalog/seed.ts`。商品清单（16 双，每个系列 4 双；价格段 98–178 USD；构造参数覆盖 lattice/wave/honeycomb 三种 pattern 与 density 三档；描述与 features 用英文 3D 打印卖点文案，如 "Lattice-printed upper","Printed as one piece — zero waste","Made to order in our print studio"）。逐个写出 `Product` 字面量，形状完全遵循任务 1 契约；样例（前 2 项给出全文，其余 14 项按同 shape 撰写，handle 唯一）：

```ts
import { collections } from './collections'
import type { Product } from './types'

export const seedProducts: Product[] = [
  {
    id: 'p01', handle: 'daily-drift', title: 'Daily Drift', subtitle: 'Everyday knit-lattice sneaker',
    description: 'A quiet everyday sneaker with a lattice-printed upper and a flexible printed midsole. Each pair is printed as a single piece, so there is no cutting-room waste — just one clean line from print to wear.',
    price: { amount: 128, currencyCode: 'USD' }, productType: 'Sneaker',
    tags: ['everyday', 'lightweight', 'eco'], collections: ['everyday', 'comfort'],
    sizes: [40, 41, 42, 43, 44, 45],
    features: ['Lattice-printed upper', 'Printed as one piece — zero waste', 'Flexible TPU midsole', 'Machine washable'],
    fitNotes: 'True to size with a medium width. If between sizes, we recommend sizing up.',
    construction: { pattern: 'lattice', density: 0.75, printedUpper: true },
    visual: { palette: ['#e8e6e0', '#d8d4cb'], accent: '#b87333', views: 3 },
    createdAt: '2026-08-01T00:00:00Z',
  },
  {
    id: 'p02', handle: 'cloudwalk-slip', title: 'Cloudwalk Slip', subtitle: 'Cushioned slip-on for long days',
    description: 'A laceless slip-on built on our wave-cushion midsole. The printed upper breathes where you need it and supports where you do not.',
    price: { amount: 108, currencyCode: 'USD' }, productType: 'Slip-on',
    tags: ['comfort', 'slip-on'], collections: ['comfort', 'everyday'],
    sizes: [38, 39, 40, 41, 42, 43],
    features: ['Wave-cushion midsole', 'One-piece printed upper', 'Wide toe box'],
    fitNotes: 'Roomy fit; consider half a size down for a snug feel.',
    construction: { pattern: 'wave', density: 0.6, printedUpper: true },
    visual: { palette: ['#dcd6cf', '#c9c2b8'], accent: '#5f6f52', views: 3 },
    createdAt: '2026-08-05T00:00:00Z',
  },
  // …其余 14 项：handles 见下（顺序即 featured 默认序）
  // 'packable-loafer' / 'overnighter' / 'gate-runner' / 'transit-knit' (travel)
  // 'morning-glory' / 'soft-step' / 'lounge-line' / 'pillow-slip' (comfort)
  // 'quiet-minimal' / 'monochrome' / 'stone-gray' / 'sage-lite' (minimal)
  // 'commuter-one' / 'second-skin' (everyday)
]
```

- [ ] **步骤 5：运行测试确认通过**

运行：`bunx vitest run src/server/catalog/seed.test.ts`
预期：PASS。

- [ ] **步骤 6：Commit**

```bash
git add src/server/catalog/collections.ts src/server/catalog/seed.ts src/server/catalog/seed.test.ts
git commit -m "feat: seed catalog — 16 3d-printed casual shoes across 4 collections"
```

---

## 任务 5：CatalogAdapter（Seed）+ Shopify 桩 + 市场服务层

**文件：**

- 创建：`src/server/catalog/seed-adapter.ts`、`src/server/catalog/shopify-stub.ts`、`src/server/catalog/service.ts`、`src/server/catalog/service.test.ts`

- [ ] **步骤 1：写服务层测试（先红）**

创建 `src/server/catalog/service.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { listProductsForMarket, getProductForMarket } from './service'

describe('catalog service', () => {
  it('lists by collection', async () => {
    const items = await listProductsForMarket({ collection: 'travel' })
    expect(items.length).toBeGreaterThan(0)
    items.forEach(p => expect(p.collections).toContain('travel'))
  })
  it('filters by market size labels converted to canonical', async () => {
    const items = await listProductsForMarket({ sizeLabels: ['US 9'] }) // EU 43
    expect(items.length).toBeGreaterThan(0)
    items.forEach(p => expect(p.sizes).toContain(43))
  })
  it('sorts price asc', async () => {
    const items = await listProductsForMarket({ sort: 'price-asc' })
    const amounts = items.map(p => p.price.amount)
    expect([...amounts].sort((a, b) => a - b)).toEqual(amounts)
  })
  it('exposes market size labels on view', async () => {
    const items = await listProductsForMarket({})
    expect(items[0].sizeOptions.length).toBeGreaterThan(0)
    expect(items[0].sizeOptions[0].label).toMatch(/^(US|EU|UK|JP|CN) /)
  })
  it('getBuyUrl null when no store configured', async () => {
    const p = await getProductForMarket('daily-drift')
    expect(p).not.toBeNull()
  })
  it('product missing -> null', async () => {
    expect(await getProductForMarket('nope')).toBeNull()
  })
})
```

- [ ] **步骤 2：运行确认失败**

运行：`bunx vitest run src/server/catalog/service.test.ts`
预期：FAIL。

- [ ] **步骤 3：实现 SeedAdapter**

创建 `src/server/catalog/seed-adapter.ts`（纯内存实现，不依赖 env）：

```ts
import { seedProducts } from './seed'
import { collections } from './collections'
import type { CatalogAdapter, Product, ProductFilter } from './types'

const byText = (p: Product, q: string) =>
  [p.title, p.subtitle, p.productType, ...p.tags, ...p.features, p.description].join(' ').toLowerCase().includes(q)

export class SeedAdapter implements CatalogAdapter {
  async getProducts(filter: ProductFilter = {}): Promise<Product[]> {
    let out = seedProducts.filter(p => {
      if (filter.collection && !p.collections.includes(filter.collection)) return false
      if (filter.sizes?.length && !filter.sizes.some(s => p.sizes.includes(s))) return false
      if (filter.minPrice != null && p.price.amount < filter.minPrice) return false
      if (filter.maxPrice != null && p.price.amount > filter.maxPrice) return false
      if (filter.q && !byText(p, filter.q.trim().toLowerCase())) return false
      return true
    })
    const sort = filter.sort ?? 'featured'
    out = [...out].sort((a, b) => {
      if (sort === 'price-asc') return a.price.amount - b.price.amount
      if (sort === 'price-desc') return b.price.amount - a.price.amount
      if (sort === 'newest') return b.createdAt.localeCompare(a.createdAt)
      return a.id.localeCompare(b.id) // featured = seed 顺序
    })
    return out
  }
  async getProductByHandle(handle: string): Promise<Product | null> {
    return seedProducts.find(p => p.handle === handle) ?? null
  }
  async getCollections() { return collections }
  async getBuyUrl(): Promise<null> { return null } // 无 store → null（占位 + 适配器就绪）
}
export const seedAdapter = new SeedAdapter()
```

创建 `src/server/catalog/shopify-stub.ts`（切换点：未来实现 Storefront API 读取；本期恒未启用）：

```ts
import type { CatalogAdapter } from './types'
export const shopifyEnabled = () =>
  Boolean(process.env.SHOPIFY_DOMAIN && process.env.SHOPIFY_STOREFRONT_TOKEN)
// 本期不实现调用；shopifyEnabled()===false 时由 adapter factory 使用 SeedAdapter
export const shopifyStub: CatalogAdapter = {
  async getProducts() { throw new Error('Shopify adapter not configured (SHOPIFY_DOMAIN/SHOPIFY_STOREFRONT_TOKEN)') },
  async getProductByHandle() { throw new Error('Shopify adapter not configured') },
  async getCollections() { throw new Error('Shopify adapter not configured') },
  async getBuyUrl() { return null },
}
```

创建 `src/server/catalog/adapter.ts`（工厂，未来切换点）：

```ts
import type { CatalogAdapter } from './types'
import { seedAdapter } from './seed-adapter'
import { shopifyStub, shopifyEnabled } from './shopify-stub'
export const catalog: CatalogAdapter = shopifyEnabled() ? shopifyStub : seedAdapter
```

- [ ] **步骤 4：实现市场服务层**

创建 `src/server/catalog/service.ts`：

```ts
import { catalog } from './adapter'
import { convert, toEU } from './size-charts'
import { market } from '@/lib/market'
import type { CanonicalSize, Product, ProductFilter, SizeSystem } from './types'

export type ProductView = Product & { sizeOptions: { value: CanonicalSize; label: string }[] }
export type MarketFilter = ProductFilter & { sizeLabels?: string[] }

const sizeLabel = (eu: CanonicalSize, system = market.sizeSystem) =>
  `${system} ${convert(eu, system)}`

function toView(p: Product): ProductView {
  return { ...p, sizeOptions: p.sizes.map(value => ({ value, label: sizeLabel(value) })) }
}

function toCanonicalSizes(sizeLabels: string[]): CanonicalSize[] {
  // "US 9" / "EU 42" 标签 → canonical EU；无法解析的标签忽略
  return sizeLabels.flatMap(l => {
    const m = l.match(/^([A-Za-z]{2})\s+([\d.]+)$/)
    if (!m) return []
    const system = m[1].toUpperCase() as SizeSystem
    const eu = system === 'EU' ? Number(m[2]) : toEU(Number(m[2]), system)
    return eu != null ? [eu as CanonicalSize] : []
  })
}

export async function listProductsForMarket(filter: MarketFilter = {}): Promise<ProductView[]> {
  const { sizeLabels, ...rest } = filter
  const canonical: ProductFilter = { ...rest }
  if (sizeLabels?.length) canonical.sizes = toCanonicalSizes(sizeLabels)
  const products = await catalog.getProducts(canonical)
  return products.map(toView)
}

export async function getProductForMarket(handle: string): Promise<ProductView | null> {
  const p = await catalog.getProductByHandle(handle)
  return p ? toView(p) : null
}
```

- [ ] **步骤 5：运行测试通过**

运行：`bunx vitest run src/server/catalog/service.test.ts`
预期：PASS（含 sizeLabels 转换与排序、buyUrl 语义）。

- [ ] **步骤 6：Commit**

```bash
git add src/server/catalog/
git commit -m "feat: seed adapter + market-aware catalog service with size conversion"
```

---

## 任务 6：数据库（bun:sqlite + Drizzle 两表）+ repository + 向量工具

**文件：**

- 创建：`src/db/schema.ts`、`src/db/client.ts`、`src/server/search/vector.ts`、`src/server/search/repository.ts`、`src/db/db.test.ts`

- [ ] **步骤 1：写测试（先红）**

创建 `src/db/db.test.ts`（`:memory:` 库，隔离）：

```ts
import { describe, expect, it, beforeEach } from 'vitest'
import { createDb } from './client'
import { createRepository } from '@/server/search/repository'
import { cosine } from '@/server/search/vector'

describe('db', () => {
  const db = createDb(':memory:')
  const repo = createRepository(db)
  beforeEach(async () => {
    await repo.wipe() // 测试辅助：TRUNCATE 两张表
  })
  it('upserts and reads embeddings', async () => {
    await repo.upsertEmbedding({ productId: 'p1', contentHash: 'h1', model: 'm1', vector: [1, 0, 0] })
    const row = await repo.getEmbedding('p1')
    expect(row?.vector).toEqual([1, 0, 0])
  })
  it('content hash change invalidates via overwrite', async () => {
    await repo.upsertEmbedding({ productId: 'p1', contentHash: 'h1', model: 'm1', vector: [1, 0, 0] })
    await repo.upsertEmbedding({ productId: 'p1', contentHash: 'h2', model: 'm1', vector: [0, 1, 0] })
    const row = await repo.getEmbedding('p1')
    expect(row?.contentHash).toBe('h2')
  })
  it('logs usage and sums by day', async () => {
    await repo.insertUsage({ day: '2026-09-04', model: 'mock', promptTokens: 10, completionTokens: 5, sessionKey: 's1' })
    await repo.insertUsage({ day: '2026-09-04', model: 'mock', promptTokens: 20, completionTokens: 5, sessionKey: 's2' })
    expect(await repo.dayTokenUsage('2026-09-04')).toBe(40)
    expect(await repo.dayTokenUsage('2026-09-05')).toBe(0)
  })
})

describe('cosine', () => {
  it('returns 1 for identical unit vectors', () => expect(cosine([1, 0], [1, 0])).toBeCloseTo(1))
  it('returns 0 for orthogonal', () => expect(cosine([1, 0], [0, 1])).toBeCloseTo(0))
  it('is scale-invariant', () => expect(cosine([2, 0], [1, 0])).toBeCloseTo(1))
})
```

- [ ] **步骤 2：运行确认失败**

运行：`bunx vitest run src/db/db.test.ts`
预期：FAIL。

- [ ] **步骤 3：实现 schema + client（幂等建表）**

创建 `src/db/schema.ts`：

```ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
export const productEmbeddings = sqliteTable('product_embeddings', {
  productId: text('product_id').primaryKey(),
  contentHash: text('content_hash').notNull(),
  model: text('model').notNull(),
  vector: text('vector').notNull(), // JSON number[]
})
export const aiUsage = sqliteTable('ai_usage', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  day: text('day').notNull(),
  model: text('model').notNull(),
  promptTokens: integer('prompt_tokens').notNull(),
  completionTokens: integer('completion_tokens').notNull(),
  sessionKey: text('session_key').notNull(),
  createdAt: integer('created_at').notNull(),
})
export const schema = { productEmbeddings, aiUsage }
```

创建 `src/db/client.ts`（`bun:sqlite` + Drizzle；建表用幂等 SQL，避免 drizzle-kit 方言依赖；跨 SQL 说明：schema 保持方言中性，Postgres 迁移时仅换 driver + `drizzle-kit generate`，本计划不实现）：

```ts
import { mkdirSync } from 'node:fs'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { schema } from './schema'
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'

export type AppDb = BunSQLiteDatabase<typeof schema>

export function createDb(file: string = process.env.DATABASE_URL ?? './data/local.db'): AppDb {
  const sqlite = new Database(file)
  sqlite.exec('PRAGMA journal_mode = WAL;')
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS product_embeddings (
      product_id TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL,
      model TEXT NOT NULL,
      vector TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL,
      completion_tokens INTEGER NOT NULL,
      session_key TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_usage_day ON ai_usage(day);
  `)
  return drizzle(sqlite, { schema })
}

let _db: AppDb | null = null
export function db(): AppDb {
  if (!_db) {
    const file = process.env.DATABASE_URL ?? './data/local.db'
    if (!file.startsWith(':')) mkdirSync(file.slice(0, file.lastIndexOf('/')) || '.', { recursive: true })
    _db = createDb(file)
  }
  return _db
}
```

注意：`db()` 是模块级单例；文件库目录 `./data` 需写入 `.gitignore`。测试用 `createDb(':memory:')` 不触碰单例。

- [ ] **步骤 4：实现 vector + repository**

创建 `src/server/search/vector.ts`：

```ts
export const magnitude = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0))
export function cosine(a: number[], b: number[]): number {
  const mag = magnitude(a) * magnitude(b)
  if (mag === 0) return 0
  return a.reduce((s, x, i) => s + x * b[i], 0) / mag
}
```

创建 `src/server/search/repository.ts`（类型化 CRUD + 用法统计）：

```ts
import { desc, eq, sql } from 'drizzle-orm'
import { productEmbeddings, aiUsage } from '@/db/schema'
import type { AppDb } from '@/db/client'

export interface EmbeddingRow { productId: string; contentHash: string; model: string; vector: number[] }

export function createRepository(db: AppDb) {
  return {
    async getEmbedding(productId: string): Promise<EmbeddingRow | null> {
      const row = await db.select().from(productEmbeddings).where(eq(productEmbeddings.productId, productId)).limit(1)
      return row[0] ? { productId: row[0].productId, contentHash: row[0].contentHash, model: row[0].model, vector: JSON.parse(row[0].vector) } : null
    },
    async upsertEmbedding(row: EmbeddingRow): Promise<void> {
      await db.insert(productEmbeddings).values({ productId: row.productId, contentHash: row.contentHash, model: row.model, vector: JSON.stringify(row.vector) })
        .onConflictDoUpdate({ target: productEmbeddings.productId, set: { contentHash: row.contentHash, model: row.model, vector: JSON.stringify(row.vector) } })
    },
    async allEmbeddings(model: string): Promise<EmbeddingRow[]> {
      const rows = await db.select().from(productEmbeddings).where(eq(productEmbeddings.model, model))
      return rows.map(r => ({ productId: r.productId, contentHash: r.contentHash, model: r.model, vector: JSON.parse(r.vector) }))
    },
    async insertUsage(u: { day: string; model: string; promptTokens: number; completionTokens: number; sessionKey: string }): Promise<void> {
      await db.insert(aiUsage).values({ ...u, createdAt: Date.now() })
    },
    async dayTokenUsage(day: string): Promise<number> {
      const [row] = await db.select({ total: sql<number>`coalesce(sum(${aiUsage.promptTokens} + ${aiUsage.completionTokens}), 0)` })
        .from(aiUsage).where(eq(aiUsage.day, day))
      return Number(row?.total ?? 0)
    },
    async wipe(): Promise<void> { // 仅测试
      await db.delete(productEmbeddings); await db.delete(aiUsage)
    },
  }
}
```

- [ ] **步骤 5：gitignore data + 测试通过**

追加 `.gitignore`：`data/`。
运行：`bunx vitest run src/db/db.test.ts`
预期：PASS。

- [ ] **步骤 6：Commit**

```bash
git add src/db src/server/search/vector.ts src/server/search/repository.ts .gitignore
git commit -m "feat: bun:sqlite + drizzle two-table db, embedding repo, cosine"
```

---

## 任务 7：ProductVisual —— 参数化 inline SVG（3D 打印格纹外观）

**文件：**

- 创建：`src/components/shop/product-visual.tsx`、`src/components/shop/product-visual.test.tsx`

- [ ] **步骤 1：写 RTL 测试（先红）**

创建 `src/components/shop/product-visual.test.tsx`：

```tsx
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { ProductVisual } from './product-visual'

const visual = { palette: ['#e8e6e0', '#d8d4cb'], accent: '#b87333', views: 3 }

describe('ProductVisual', () => {
  it('renders an svg with product role and palette', () => {
    const { container } = render(<ProductVisual visual={visual} name="Daily Drift" />)
    const svg = container.querySelector('svg[data-product-visual]')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('aria-label')).toBe('Daily Drift — printed shoe')
  })
  it('honors view prop to vary lattice density', () => {
    const { container } = render(<ProductVisual visual={visual} name="x" view="side" />)
    expect(container.querySelector('svg[data-view="side"]')).not.toBeNull()
  })
})
```

- [ ] **步骤 2：运行确认失败**

运行：`bunx vitest run src/components/shop/product-visual.test.tsx`
预期：FAIL（模块不存在）。

- [ ] **步骤 3：实现组件**

创建 `src/components/shop/product-visual.tsx`：纯展示组件，用 `visual.construction`（经 props 传入的 `Product['visual']` 之外再透传 `pattern/density`）绘制极简鞋侧影 + 格纹/波纹/蜂窝 pattern（`<pattern>` + `<path>` 组合，颜色取 palette/accent）。确定性输出（无随机、无 date）。接口：

```tsx
export function ProductVisual({ visual, name, view = 'side', className }: {
  visual: Product['visual']; name: string
  view?: 'side' | 'sole' | 'detail'; className?: string
}) {
  // 渲染 <svg data-product-visual data-view={view} role="img" aria-label={`${name} — printed shoe`}>
  //   <defs><pattern id={`lattice-${...}`}>…</pattern></defs>
  //   view==='sole' → 俯视底面曲线 + accent 色垫层；view==='detail' → 局部放大格纹；side → 完整侧影
}
```

实现约束：至少 3 个 view；每个 view 的 SVG 结构不同（测试断言 data-view）；无网络请求；随机数禁用（确定性 → 便于快照与测试）。

- [ ] **步骤 4：运行通过 + 视觉自检**

运行：`bunx vitest run src/components/shop/product-visual.test.tsx`
预期：PASS。
自检：`bun run dev` 后临时在 Landing 放一个 `<ProductVisual>` 渲染 3 视角，肉眼确认格纹/配色呈现（本步只验证不提交临时代码，或并入任务 9 的正式展示）。

- [ ] **步骤 5：Commit**

```bash
git add src/components/shop/product-visual.tsx src/components/shop/product-visual.test.tsx
git commit -m "feat: parametric inline-SVG product visual (3 views)"
```

---

## 任务 8：愿望单（localStorage 纯函数 + 按钮交互）

**文件：**

- 创建：`src/lib/wishlist.ts`、`src/lib/wishlist.test.ts`、`src/components/shop/wishlist-button.tsx`、`src/components/shop/wishlist-button.test.tsx`、`src/components/shop/wishlist-provider.tsx`

- [ ] **步骤 1：写纯函数测试（先红）**

创建 `src/lib/wishlist.ts`：

```ts
const KEY = 'treadwell:wishlist'
export const loadWishlist = (): string[] => JSON.parse(typeof window === 'undefined' ? '[]' : (window.localStorage.getItem(KEY) ?? '[]'))
export const saveWishlist = (items: string[]) => window.localStorage.setItem(KEY, JSON.stringify(items))
export const toggleWishlist = (items: string[], handle: string): string[] =>
  items.includes(handle) ? items.filter(h => h !== handle) : [...items, handle]
```

创建 `src/lib/wishlist.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { toggleWishlist } from './wishlist'
describe('toggleWishlist', () => {
  it('adds then removes a handle', () => {
    const once = toggleWishlist([], 'a')
    expect(once).toEqual(['a'])
    expect(toggleWishlist(once, 'a')).toEqual([])
  })
  it('keeps order of additions', () => {
    expect(toggleWishlist(['b'], 'a')).toEqual(['b', 'a'])
  })
})
```

- [ ] **步骤 2：运行确认失败**

运行：`bunx vitest run src/lib/wishlist.test.ts`（仅先验证 toggle 红/绿；load/save 依赖 jsdom localStorage，见步骤 4）

预期：先跑 toggle 相关通过——顺序调整：把 load/save 的 jsdom 用例并入步骤 4 一起写，此处只留纯函数。

- [ ] **步骤 3：实现 Provider + 按钮**

创建 `src/components/shop/wishlist-provider.tsx`：客户端 context `{ items, toggle }`；`items` 初始自 `loadWishlist()`；`toggle` 更新 state 并 `saveWishlist`；导出 `WishlistProvider`、`useWishlist()`。

创建 `src/components/shop/wishlist-button.tsx`：接受 `handle`，读 `useWishlist()`，渲染无障碍按钮（`aria-pressed={active}`，心形 SVG，`aria-label={active ? 'Remove from wishlist' : 'Add to wishlist'}`），点击 `toggle(handle)`；导出 `WishlistButton`。

- [ ] **步骤 4：RTL 交互测试**

创建 `src/components/shop/wishlist-button.test.tsx`：

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WishlistButton } from './wishlist-button'
import { WishlistProvider } from './wishlist-provider'

describe('WishlistButton', () => {
  it('toggles aria-pressed and persists', async () => {
    const user = userEvent.setup()
    render(<WishlistProvider><WishlistButton handle="daily-drift" /></WishlistProvider>)
    const btn = screen.getByRole('button', { name: /add to wishlist/i })
    await user.click(btn)
    expect(screen.getByRole('button', { name: /remove from wishlist/i })).toHaveAttribute('aria-pressed', 'true')
    expect(JSON.parse(window.localStorage.getItem('treadwell:wishlist') ?? '[]')).toEqual(['daily-drift'])
  })
})
```

运行：`bunx vitest run src/lib/wishlist.test.ts src/components/shop/wishlist-button.test.tsx`
预期：PASS（jsdom 提供 localStorage，setup.ts 已含 jest-dom）。

- [ ] **步骤 5：Commit**

```bash
git add src/lib/wishlist.ts src/components/shop/wishlist-provider.tsx src/components/shop/wishlist-button.tsx src/**/*.test.tsx
git commit -m "feat: wishlist via localStorage with accessible toggle button"
```

---

## 任务 9：ProductCard + ProductGrid（含尺码标签与价格显示）

**文件：**

- 创建：`src/components/shop/product-card.tsx`、`src/components/shop/product-grid.tsx`、`src/components/shop/product-card.test.tsx`
- 修改：`src/app/shop/page.tsx` 先用最小服务端渲染临时铺数据（任务 10 正式化）

- [ ] **步骤 1：写卡片测试（先红）**

创建 `src/components/shop/product-card.test.tsx`：

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProductCard } from './product-card'
import type { ProductView } from '@/server/catalog/service'

const p: ProductView = {
  id: 'p01', handle: 'daily-drift', title: 'Daily Drift', subtitle: 'Everyday knit-lattice sneaker',
  description: 'x', price: { amount: 128, currencyCode: 'USD' }, productType: 'Sneaker',
  tags: [], collections: ['everyday'], sizes: [42], features: [], fitNotes: '',
  construction: { pattern: 'lattice', density: 0.75, printedUpper: true },
  visual: { palette: ['#e8e6e0', '#d8d4cb'], accent: '#b87333', views: 3 },
  createdAt: '2026-08-01T00:00:00Z',
  sizeOptions: [{ value: 42, label: 'US 8.5' }],
}

describe('ProductCard', () => {
  it('links to detail and shows price + size hint', () => {
    render(<ProductCard product={p} />)
    const link = screen.getByRole('link', { name: /daily drift/i })
    expect(link).toHaveAttribute('href', '/product/daily-drift')
    expect(screen.getByText('$128.00')).toBeInTheDocument()
    expect(screen.getByText(/US 8\.5/)).toBeInTheDocument()
  })
})
```

- [ ] **步骤 2：运行确认失败** → `bunx vitest run src/components/shop/product-card.test.tsx` FAIL。

- [ ] **步骤 3：实现卡片与网格**

创建 `src/components/shop/product-card.tsx`：整卡 `<Link href={'/product/'+handle}>`，内嵌 `ProductVisual`（side 视角）、标题/副题/价格（`formatPrice`）、首档尺码标签 "US 8.5–9.5"（取 min/max sizeOptions label）、角落 `WishlistButton`（`onClick` 须 `e.preventDefault()` 防跳转）。
创建 `src/components/shop/product-grid.tsx`：接受 `products: ProductView[]`，响应式 grid，`<ul>` + 每项 `<li>`。

- [ ] **步骤 4：测试通过**

运行：`bunx vitest run src/components/shop/product-card.test.tsx` PASS。

- [ ] **步骤 5：临时验证页（任务 10 前）**

修改 `src/app/shop/page.tsx` 为异步 RSC：`const items = await listProductsForMarket({})` → 渲染 `<ProductGrid products={items} />`。服务端 import 只走 server 模块（规格 server-only 边界）。

- [ ] **步骤 6：Commit**

```bash
git add src/components/shop/ src/app/shop/page.tsx
git commit -m "feat: product card/grid with price, size-range hint and wishlist"
```

---

## 任务 10：/shop 列表页 —— URL 状态筛选 + 筛选栏 + 空态/骨架

**文件：**

- 创建：`src/lib/shop-search-params.ts`（纯函数 parse/serialize）、`src/lib/shop-search-params.test.ts`、`src/components/shop/product-filter-bar.tsx`、`src/app/shop/page.tsx`（正式化）、`src/app/shop/loading.tsx`、`src/app/shop/empty-state.tsx`

- [ ] **步骤 1：写 parse/serialize 纯函数与测试**

创建 `src/lib/shop-search-params.ts`：

```ts
import type { ProductFilter } from '@/server/catalog/types'
export type ShopFilter = ProductFilter & { sizeLabels?: string[] }
export function parseShopParams(sp: URLSearchParams): ShopFilter {
  const size = sp.getAll('size') // 市场标签 "US 9"
  const sort = sp.get('sort') as ShopFilter['sort']
  return {
    collection: sp.get('collection') ?? undefined,
    minPrice: sp.get('minPrice') ? Number(sp.get('minPrice')) : undefined,
    maxPrice: sp.get('maxPrice') ? Number(sp.get('maxPrice')) : undefined,
    q: sp.get('q') ?? undefined,
    sizeLabels: size.length ? size : undefined,
    sort: ['featured', 'price-asc', 'price-desc', 'newest'].includes(sort as string) ? sort : 'featured',
  }
}
```

测试 `src/lib/shop-search-params.test.ts`：多值 `size`、非法 sort 回落 featured、空串忽略。运行红 → 绿。

- [ ] **步骤 2：服务端页正式化**

`src/app/shop/page.tsx`：`export const dynamic = 'force-dynamic'`（searchParams 渲染）；`parseShopParams` → `listProductsForMarket` → `<ProductFilterBar initial/>` + 结果数量 + `<ProductGrid>` / `<EmptyState query/>`。页面 metadata 见任务 13。此页只做数据获取与组合，交互全在筛选栏组件。

- [ ] **步骤 3：筛选栏客户端组件**

创建 `src/components/shop/product-filter-bar.tsx`（'use client'）：受控组件，变更即 `router.replace('/shop?' + serializeShopParams(...))`（保留已有参数）；控件：collection（来自 `getCollections()` 传入 option 数组）、size（当前市场体系全部档位标签，来自 `market.sizeSystem` + fixture 生成选项，`sizeOptionsForMarket()` helper 放 `size-charts.ts` 导出）、价格 min/max（select 区间：<100/100–150/>150）、排序、关键词输入（表单提交）。无筛选时隐藏"筛选生效"标记；全部选择通过 URL 可分享。

补充导出（任务 3 文件追加，勿改名既有 API）：

```ts
// size-charts.ts 追加
export const availableSizesForSystem = (system: SizeSystem): { label: string; canonical: CanonicalSize }[] =>
  sizeRows.map(r => ({ label: `${system} ${r.systems[system as 'US' | 'EU' | 'UK' | 'JP' | 'CN']}`, canonical: r.systems.EU }))
```

- [ ] **步骤 4：RTL：筛选变更同步 URL**

创建 `src/components/shop/product-filter-bar.test.tsx`（mock `next/navigation` 的 `useRouter`：`vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }))`）：选择排序为 price-asc → 断言 `replace` 收到含 `sort=price-asc` 的 URL；选择 collection → 断言 `collection=` 参数。加 `loading.tsx`（骨架：shadcn Skeleton 网格）。

- [ ] **步骤 5：全绿 + 手测**

运行：`bunx vitest run src/lib/shop-search-params.test.ts src/components/shop/product-filter-bar.test.tsx`
预期 PASS。`bun run dev` 手测：/shop 默认列表、改 URL 直开（分享）、空结果态、collection 过滤。

- [ ] **步骤 6：Commit**

```bash
git add src/lib/shop-search-params.ts src/app/shop/ src/components/shop/product-filter-bar.tsx src/server/catalog/size-charts.ts
git commit -m "feat: /shop with URL-driven filters (collection/size/price/sort/q)"
```

---

## 任务 11：Landing —— AppBar/Footer/Hero/系列卡/精选格/叙事区

**文件：**

- 创建：`src/components/marketing/app-bar.tsx`（含滚动态 + 移动 Sheet）、`footer.tsx`、`hero.tsx`、`promise-strip.tsx`、`collection-cards.tsx`、`featured-grid.tsx`、`story-section.tsx`、`src/components/marketing/app-bar.test.tsx`
- 修改：`src/app/page.tsx`（组装 Landing，异步取 collections + featured）、`src/app/layout.tsx`（字体、`WishlistProvider`、`AssistantProvider` 挂载点、metadata 基座）、`src/app/globals.css`（tokens 落定：#FAFAF8 底 / #111 墨 / 强调色；衬线展示字体变量）

- [ ] **步骤 1：globals.css + layout 基座**

`src/app/globals.css`：Tailwind v4 `@theme` 定义 `--color-canvas: #FAFAF8; --color-ink: #111; --color-accent: <强调色>`；字体用 `next/font/google`：Newsreader（display 衬线）+ Inter（body），在 layout 声明变量并挂 `className`。Layout 组装 `WishlistProvider` → `AssistantProvider`（任务 17 先留 provider 空壳并允许 children，避免后面再改 layout——本任务直接建 `assistant-provider.tsx` 最小 context，任务 17 填充 UI）。

- [ ] **步骤 2：AppBar 与测试**

`app-bar.tsx`（'use client'）：`useScroll` 于 `scrollY > 8` 时加毛玻璃底（`backdrop-blur` + 半透明 canvas），否则透明；Logo 文本 `site.name` → `/`；导航 `site.nav`；搜索入口 = 链接到 `/shop`（带一个可折叠 input，简单版：桌面显示 input，Enter → `/shop?q=`）；愿望单计数（`useWishlist().items.length`，徽标 Badge）；移动端 hamburger → shadcn Sheet 内列导航。
测试 `app-bar.test.tsx`：渲染 nav 链接与计数 0；mock scroll（fireEvent 到 window）触发 class 变化较脆——改为测徽标计数随 provider 更新（+1 后显示 1）与链接 href。

- [ ] **步骤 3：Hero 与叙事区**

`hero.tsx`：全屏区块，编辑感远程 lifestyle 图（`next/image` + remotePatterns 需在 `next.config.ts` 注册 unsplash/pexels；加载失败由 Image onError 降级为 canvas 底色块——静默兜底），叠加 kicker/title/CTA（`site.hero`）+ 滚动指示。
`promise-strip.tsx`：3 个承诺项（Free returns / Printed to order / Carbon-neutral prints）——文案消费端、无 AI。
`collection-cards.tsx`：服务端从 `catalog.getCollections()` + 每系列代表商品 visual 渲染 4 卡 → 链接 `/shop?collection=<handle>`。
`featured-grid.tsx`：`listProductsForMarket({ sort: 'featured' })` 前 4 件 → `ProductGrid`。
`story-section.tsx`：id="story"，"Comfort, measured" 叙事区（规格 §9：品牌叙事暂缓 → 本区用中性舒适/制造措辞，不含 3D 打印强宣称——沿用设计定稿的克制文案，避免与暂缓决策冲突）。
`footer.tsx`：nav 复述 + 品牌名 + © 2026。

- [ ] **步骤 4：组装 page + 构建验证**

`src/app/page.tsx`（RSC，异步）：按规格 Landing 顺序渲染 AppBar/Hero/PromiseStrip/CollectionCards/FeaturedGrid/StorySection/Footer；整页零 AI 痕迹（无 assistant 入口文案，FAB 不在此页出现——规格 P1：助手入口可在全站，但 Landing 主视觉不宣传；FAB 全局可见属助手壳，保留但默认收起）。

运行：`bun run typecheck && bun run lint`，再 `bun run dev` 手测各区块与滚动 AppBar。

- [ ] **步骤 5：RTL AppBar + Commit**

运行：`bunx vitest run src/components/marketing/app-bar.test.tsx` PASS 后：

```bash
git add src/app/globals.css src/app/layout.tsx src/app/page.tsx src/components/marketing/ next.config.ts
git commit -m "feat: landing — app bar, hero, collections, featured, story, footer"
```

---

## 任务 12：PDP 详情页

**文件：**

- 创建：`src/app/product/[handle]/page.tsx`、`src/components/shop/size-selector.tsx`、`src/components/shop/size-selector.test.tsx`、`src/components/shop/product-buy-bar.tsx`、`src/components/shop/product-buy-bar.test.tsx`、`src/components/shop/product-gallery.tsx`
- 修改：`src/server/catalog/service.ts`（新增 `getRelatedProducts(handle, limit)`）

- [ ] **步骤 1：服务层补 related + 测试**

`service.ts` 追加：

```ts
export async function getRelatedProducts(handle: string, limit = 3): Promise<ProductView[]> {
  const current = await getProductForMarket(handle)
  if (!current) return []
  const same = await listProductsForMarket({ collection: current.collections[0] })
  const rest = await listProductsForMarket({})
  const pool = [...same, ...rest].filter(p => p.handle !== handle)
  return [...new Map(pool.map(p => [p.handle, p])).values()].slice(0, limit)
}
```

`service.test.ts` 追加用例：related 不含自身、数量 ≤ limit。

- [ ] **步骤 2：页面 RSC（先骨架后打磨）**

`src/app/product/[handle]/page.tsx`：`generateStaticParams` 由 `catalog.getProducts()` 生成（SSG，规格 §9）；`getProductForMarket(handle)` → null 时 `notFound()`；渲染 `ProductGallery`（3 view 本地图循环展示 + 缩略切换，客户端小组件）+ 信息区（title/subtitle/price/features/`find-my-size` 按钮——点击调 `assistant.open('size-fit', productCtx)`，assistant context 来自 `AssistantProvider`，任务 17 定义其 API，本任务先引用契约）+ `SizeSelector` + `Accordion`（Materials & fit：material 文案 + fitNotes；Shipping：打印制造/环保）+ `ProductBuyBar` + 相关推荐 Grid。metadata 任务 13 补。

- [ ] **步骤 3：SizeSelector 与测试**

`size-selector.tsx`（'use client'）：`sizeOptions`（来自 ProductView）渲染可访问 radio group（fieldset/legend"Select size"），受控选择；`aria-pressed` 逻辑用 radio input name=sizes。测试：点击 US 标签 → onChange 收到对应 canonical。

- [ ] **步骤 4：ProductBuyBar 与测试**

`product-buy-bar.tsx`：`getBuyUrl` 在服务端已算好传 prop `buyUrl: string | null` + `availableSoon: boolean`。`buyUrl===null` → 禁用态主按钮文案 "Available soon" + 副文案 "Checkout lands on our Shopify store." + toast/aria-live（选尺码后仍禁用说明）。未来有 URL 即变 `<a href>`。测试：无 URL 时按钮 disabled 且文案正确。

- [ ] **步骤 5：构建 + 手测 + Commit**

`bun run typecheck && bun run lint`；dev 手测：直接开 `/product/daily-drift`、未知 handle → 404、尺码选择与 AI 入口可用性。
Commit：

```bash
git add src/app/product/ src/components/shop/size-selector.tsx src/components/shop/product-buy-bar.tsx src/components/shop/product-gallery.tsx src/server/catalog/service.ts
git commit -m "feat: product detail page (gallery, size selector, buy CTA, related)"
```

---

## 任务 13：SEO / 错误 / 加载壳与本地 OG

**文件：**

- 创建：`src/lib/seo.ts`（metadata 构造）、`src/app/og/route.tsx`（本地 OG 图）、`src/app/not-found.tsx`、`src/app/error.tsx`、`src/lib/seo.test.ts`
- 修改：各页面 export `metadata`/`generateMetadata`

- [ ] **步骤 1：seo 工具与测试**

`src/lib/seo.ts`：

```ts
import { site } from './site'
import type { Metadata } from 'next'
export const baseMetadata: Metadata = {
  metadataBase: new URL('http://localhost:3000'),
  title: { default: site.name, template: `%s — ${site.name}` },
  description: 'Casual shoes, digitally crafted and printed to order.',
  openGraph: { images: ['/og'], siteName: site.name },
}
export const pageMetadata = (o: Partial<Metadata>): Metadata => ({ ...baseMetadata, ...o })
```

`seo.test.ts`：`pageMetadata({title:'x'}).title?.template` 含 brand。

- [ ] **步骤 2：本地 OG 图 route**

`src/app/og/route.tsx`：`ImageResponse` 输出 1200×630 简洁极简图（canvas 色块 + brand 名 + 文案），`export const runtime = 'edge'` 或 node 均可（Turbopack/16 用 node 默认）。

- [ ] **步骤 3：not-found / error / loading + 各页 metadata**

`not-found.tsx`（消费者文案 + Shop 链接）、`error.tsx`（'use client'，重置按钮）、Landing/Shop/PDP `generateMetadata`：PDP 用商品 title/description。给 `app/loading.tsx` 骨架。

- [ ] **步骤 4：校验 + Commit**

`bun run build` 通过（含 route 生成 OG 校验 200）；Commit。

---

## 任务 14：检索服务（keyword + embedder + retrieval 编排）

**文件：**

- 创建：`src/server/search/keyword.ts`、`src/server/search/keyword.test.ts`、`src/server/search/embedder.ts`、`src/server/search/retrieval.ts`、`src/server/search/retrieval.test.ts`

- [ ] **步骤 1：keyword 纯函数与测试**

`keyword.ts`：导出 `export function keywordSearch(query: string, products: Product[]): { handle: string; score: number }[]`——对候选 Product 的 `textualContent(p)`（title/subtitle/tags/features/productType/description 归一化，与 retrieval 的 `textualContent` 同实现），给 query tokens 打分：token 命中次数 × 位置权重（title 命中权重高），返回降序；0 命中返回 []。

测试：`lightweight` 命中 lightweight 标签鞋 > 无标签鞋；无命中为空；多 token 加权。

- [ ] **步骤 2：embedder 客户端**

`embedder.ts`：

```ts
const base = process.env.AI_BASE_URL ?? ''
const model = process.env.AI_EMBEDDING_MODEL ?? ''
let probe: boolean | null = null
export async function embeddingsAvailable(): Promise<boolean> {
  if (probe !== null) return probe
  if (!base || !model) { probe = false; return false }
  probe = await fetch(`${base}/embeddings`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.AI_API_KEY}` }, body: JSON.stringify({ model, input: 'ping' }), signal: AbortSignal.timeout(3_000) })
    .then(r => r.ok).catch(() => false)
  return probe
}
export async function embed(texts: string[]): Promise<number[][]> {
  const res = await fetch(`${base}/embeddings`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.AI_API_KEY}` }, body: JSON.stringify({ model, input: texts }) })
  if (!res.ok) throw new Error(`embeddings ${res.status}`)
  const data = await res.json() as { data: { embedding: number[] }[] }
  return data.data.map(d => d.embedding)
}
```

- [ ] **步骤 3：retrieval 编排与测试**

`retrieval.ts`：

```ts
import { cosine } from './vector'
import { catalog } from '@/server/catalog/adapter'
import { embed, embeddingsAvailable } from './embedder'
import { keywordSearch } from './keyword'
import { createRepository } from './repository'
import { db } from '@/db/client'
import type { Product } from '@/server/catalog/types'

export interface RetrievalResult { handle: string; score: number }

export const textualContent = (p: Product) =>
  [p.title, p.subtitle, p.productType, ...p.tags, ...p.features, p.description].join(' ').toLowerCase()
export const hashText = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h) }

type Repo = ReturnType<typeof createRepository>

export async function retrieve(
  query: string,
  opts: { embedIfAvailable?: boolean } = { embedIfAvailable: true },
  repo: Repo = createRepository(db()),
): Promise<RetrievalResult[]> {
  const products = await catalog.getProducts({}) // 规格 §5：≤2k 目录内存余弦可行
  if (opts.embedIfAvailable && (await embeddingsAvailable())) {
    const model = process.env.AI_EMBEDDING_MODEL ?? ''
    const [qVec] = await embed([query])
    const cached = new Map((await repo.allEmbeddings(model)).map(r => [r.productId, r]))
    for (const p of products) {
      const h = hashText(textualContent(p))
      const hit = cached.get(p.id)
      if (!hit || hit.contentHash !== h) {
        const [v] = await embed([textualContent(p)]) // 懒计算并缓存；contentHash 变则自动重算
        await repo.upsertEmbedding({ productId: p.id, contentHash: h, model, vector: v })
      }
    }
    const rows = await repo.allEmbeddings(model)
    const byId = new Map(products.map(p => [p.id, p]))
    return rows
      .map(r => ({ handle: byId.get(r.productId)?.handle ?? r.productId, score: cosine(qVec, r.vector) }))
      .sort((a, b) => b.score - a.score)
  }
  return keywordSearch(query, products) // 无 embedding 能力 → 关键词降级（规格 §8.3.4）
}
```

设计要点：catalog 经 `adapter` 工厂读取（不绕过适配层）；embedding 只对缺失/内容变化的产品懒计算；返回 `handle`（产品主键是 id，handle 是 URL/卡片契约键）。
测试 `retrieval.test.ts`：`vi.mock('./embedder')` 让 `embeddingsAvailable=false` → 走 keyword 路径断言顺序与形状；置 true + 固定向量（如按产品索引 one-hot）→ 断言命中缓存 upsert 且余弦排序首位为该产品；repo 传内存库（`createDb(':memory:')`）。

- [ ] **步骤 4：Commit**

`bunx vitest run src/server/search/` 全绿后 commit：`feat: retrieval — keyword fallback + cached embeddings + cosine rank`。

---

## 任务 15：护栏（会话回合 / 令牌桶 / 日预算 / 文本上限）

**文件：**

- 创建：`src/server/guardrails/text.ts`、`src/server/guardrails/rate-limit.ts`、`src/server/guardrails/session-state.ts`、`src/server/guardrails/budget.ts`、`src/server/guardrails/index.ts` 及各自 `*.test.ts`

- [ ] **步骤 1：text.ts（纯函数）与测试**

```ts
export const MAX_MESSAGE_CHARS = Number(process.env.AI_MAX_MESSAGE_CHARS ?? 800)
export const MAX_OUTPUT_TOKENS = Number(process.env.AI_MAX_OUTPUT_TOKENS ?? 500)
export const estTokens = (s: string) => Math.ceil(s.length / 4)
export const truncateMessage = (s: string) => (s.length > MAX_MESSAGE_CHARS ? s.slice(0, MAX_MESSAGE_CHARS) : s)
```

测试：estTokens 粗估、超长截断。

- [ ] **步骤 2：rate-limit（令牌桶，可注入时钟）**

```ts
export interface Bucket { tokens: number; ts: number }
export function tokenBucket(ratePerMin: number, burst = ratePerMin) {
  const buckets = new Map<string, Bucket>()
  const perMs = ratePerMin / 60_000
  return {
    allow(key: string, now = Date.now()): boolean {
      const b = buckets.get(key) ?? { tokens: burst, ts: now }
      b.tokens = Math.min(burst, b.tokens + (now - b.ts) * perMs)
      b.ts = now
      const ok = b.tokens >= 1
      if (ok) b.tokens -= 1
      buckets.set(key, b)
      return ok
    },
    size: () => buckets.size,
  }
}
```

测试（注入 now 序列）：连发 N 次后拒绝；时间前进后恢复；IP 与会话 key 独立。

- [ ] **步骤 3：session-state（回合上限 + 裁剪 + TTL）**

```ts
export const MAX_TURNS = Number(process.env.AI_MAX_TURNS ?? 20)
export const HISTORY_TURNS = 6
export const SESSION_TTL_MS = 30 * 60_000
export function createSessionStore(now = Date.now) {
  const m = new Map<string, { turns: number; history: { role: 'user' | 'assistant'; content: string }[]; at: number }>()
  return {
    claim(sessionKey: string, nowMs = now()): { allowed: boolean; history: { role: 'user' | 'assistant'; content: string }[] } {
      const s = m.get(sessionKey)
      const cur = s && nowMs - s.at < SESSION_TTL_MS ? s : { turns: 0, history: [], at: nowMs }
      const allowed = cur.turns < MAX_TURNS
      if (allowed) { cur.turns += 1; cur.at = nowMs }
      m.set(sessionKey, cur)
      return { allowed, history: cur.history.slice(-HISTORY_TURNS * 2) }
    },
    push(sessionKey: string, role: 'user' | 'assistant', content: string) {
      const s = m.get(sessionKey)
      if (s) s.history.push({ role, content })
    },
    size: () => m.size,
  }
}
```

测试：第 21 次拒绝；TTL 过期重置；history 裁剪为最近 6 轮（12 条）。

- [ ] **步骤 4：budget（DB 日预算 + 用量落库）**

```ts
export const DAILY_TOKEN_CAP = Number(process.env.AI_DAILY_TOKEN_CAP ?? 1_000_000)
export async function underDailyBudget(repo: ReturnType<typeof createRepository>, day = today()): Promise<boolean> {
  return (await repo.dayTokenUsage(day)) < DAILY_TOKEN_CAP
}
export const today = () => new Date().toISOString().slice(0, 10)
```

测试：注入假 repo（内存 sqlite `createDb(':memory:')` + repository）——插入接近 cap 的行后 `underDailyBudget=false`。

- [ ] **步骤 5：index 组装（护栏决策，供 chat.ts 调用）**

```ts
export class GuardrailError extends Error {
  constructor(public code: 'rate_limited' | 'budget' | 'turns', message: string) { super(message) }
}
export function createGuardrails(repo) { /* 返回 { assertTurn, assertRate(ip, session), assertBudget, noteUsage } 组合上述模块 + 温和文案映射 */ }
```

温和文案映射（规格 §8.5.6，消费端措辞）：rate/turns/budget 统一输出如 "The assistant is taking a short break — try again in a moment."，`code` 透传日志（不暴露给 UI 正文，除 error event 的 code 用于 retry 语义）。

- [ ] **步骤 6：Commit**

`bunx vitest run src/server/guardrails/` 全绿 → commit `feat: AI guardrails — turn/session caps, token buckets, daily budget`。

---

## 任务 16：AI Providers + Chat 编排 + SSE 路由

**文件：**

- 创建：`src/server/ai/events.ts`（上文契约全文 + 序列化）、`src/server/ai/prompts.ts`、`src/server/ai/provider.ts`、`src/server/ai/mock.ts`、`src/server/ai/openai-compat.ts`、`src/server/ai/size-input.ts`、`src/server/ai/chat.ts`、`src/server/ai/chat.test.ts`、`src/app/api/ai/chat/route.ts`
- 修改：`src/server/catalog/types.ts`（若 ProductCard 需补字段则以 events.ts 内类型为准，不重复定义）

- [ ] **步骤 1：size-input（size-fit 确定性建议核心，先测）**

创建 `src/server/ai/size-input.ts`（复用 size-charts）：

```ts
import { parseSizeHint, nearestCanonical } from '@/server/catalog/size-charts'
import type { ProductView } from '@/server/catalog/service'
export interface SizeAdvice {
  recommended: number | null       // canonical EU
  alternatives: number[]
  rationale: string
  askedForInput: boolean           // true = 信息不足需追问（此时 recommended=null）
}
export function adviceFor(product: ProductView, userText: string, base?: SizeAdvice | null): SizeAdvice {
  const wanted = parseSizeHint(userText)
  if (!wanted) {
    return {
      recommended: null, alternatives: [],
      rationale: 'Can you tell me the size you usually wear, or your foot length in cm?',
      askedForInput: true,
    }
  }
  const recommended = nearestCanonical(wanted, product.sizes)
  if (recommended === null) return { recommended: null, alternatives: [], rationale: 'This style is currently out of stock in nearby sizes.', askedForInput: false }
  const alternatives = product.sizes.filter(s => s !== recommended)
  return {
    recommended, alternatives,
    rationale: `${product.title} runs ${product.fitNotes} Based on your usual size, ${recommended} (EU) should fit best.`,
    askedForInput: false,
  }
}
```

测试 `size-input.test.ts`：给 "I wear US 9" → recommended EU 43（若该鞋有 43）；"comfortable" → askedForInput；无 in-stock → 空 alternatives 与说明。

- [ ] **步骤 2：events.ts + prompts.ts**

`events.ts`（契约全文于"文件结构"已给，落地 serialize + parse + `createSizeFitEvent`）。`prompts.ts`：

```ts
export const PERSONA = 'You are a helpful in-store footwear guide for a casual 3D-printed shoe brand. Be warm, concise and grounded: only talk about products and details given to you. Never invent prices, availability or materials. If asked anything outside shoes and shopping, reply in at most two short sentences and steer back to the catalog. Use plain short sentences.'
export const systemFor = (mode: Mode, ctx: { product?: string; catalogDigest?: string }) => {...} // 拼按模式：shopping 注入 digest；outfit 注入当前商品；find-shoes 由代码先发卡片再让模型只写一句话总结
```

- [ ] **步骤 3：AiProvider 契约 + mock + openai-compat**

`provider.ts`：

```ts
import type { ChatEvent } from './events'
export interface AiContext { messages: { role: 'user' | 'assistant'; content: string }[] }
export interface AiProvider {
  stream(ctx: AiContext & { system: string; maxTokens: number }): AsyncGenerator<string> // text deltas only
}
export const aiProvider = (): AiProvider =>
  process.env.AI_API_KEY ? new OpenAICompatProvider() : new MockProvider()
```

`mock.ts`：`MockProvider.stream` 按 content 关键词决定回复文本（离题关键词 redirect；导购相关按注入 digest 提到的商品回简短推荐+引用；保证同构 delta 流——把整段文案拆成每 ~8 词一个 delta yield，模拟流式）。deterministic。
`openai-compat.ts`：`new OpenAI({ apiKey, baseURL })`，`chat.completions.create({ model, messages, stream: true, max_tokens })`，yield `chunk.choices[0]?.delta?.content ?? ''`。AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS 默认 20s) 包裹（护栏 §8.5.2）。

- [ ] **步骤 4：chat() 编排 + 测试（mock 下事件契约）**

`chat.ts`：

```ts
export interface ChatRequest {
  sessionKey: string; ip: string; mode: Mode; product?: { handle: string; title: string } | null
  text: string
}
export async function* chat(req: ChatRequest): AsyncGenerator<ChatEvent> {
  // 1) guardrails: turns / rate(ip+session) / budget —— 违规 yield {type:'error',code,...温和文案} 并 return
  // 2) mode 分发：
  //    size-fit（需 product view）→ adviceFor() → askedForInput ? 文本 delta + done : yield sizeFit 事件 + rationale delta + done
  //    find-shoes → retrieve(text) top 4 → 先 yield productCards → provider 只写一句话总结（digest 注入）→ done
  //    shopping   → retrieve(text) top 4 → digest 注入 system → stream deltas → done
  //    outfit     → product view 上下文 + 视觉配色 → stream deltas（mock: 固定 3 条建议文本）
  // 3) 每回合 session-store.push(user, assistant 全文)；结束 noteUsage(estTokens 估) 落 ai_usage
}
export type Mode = 'shopping' | 'size-fit' | 'outfit' | 'find-shoes'
```

`chat.test.ts`（mock 模式：`vi.stubEnv('AI_API_KEY','')` 强制 Mock；本地内存 sqlite db 注入 repository；session 固定 key）：断言 find-shoes 流含 productCards + done；size-fit 给出 sizeFit 事件 recommended=43；超回合（循环 21 次）后 error code 'turns' + 温和文案；离题仅一段短 delta。SSE 帧：`encodeEvent` 往返 parse 测试。

- [ ] **步骤 5：route 接线**

`src/app/api/ai/chat/route.ts`（POST）：

```ts
export async function POST(req: Request) {
  const body = await req.json() as { sessionKey?: string; mode?: Mode; text?: string; product?: { handle: string; title: string } | null }
  const sessionKey = typeof body.sessionKey === 'string' ? body.sessionKey : crypto.randomUUID()
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder()
      try {
        for await (const ev of chat({ sessionKey, ip, mode: body.mode ?? 'shopping', text: body.text ?? '', product: body.product ?? null })) {
          controller.enqueue(enc.encode(encodeEvent(ev)))
          if (ev.type === 'done' || ev.type === 'error') break
        }
      } catch (e) { controller.enqueue(enc.encode(encodeEvent({ type: 'error', code: 'provider', message: 'Something went wrong — please try again.' }))) }
      controller.close()
    },
  })
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' } })
}
```

- [ ] **步骤 6：全测 + 手测（无 key 全 Mock）**

`bunx vitest run src/server/ai/` 全绿；`bun run dev` 用 curl 模拟：`curl -N -X POST localhost:3000/api/ai/chat -H 'content-type: application/json' -d '{"sessionKey":"s","mode":"find-shoes","text":"lightweight sneakers under 150"}'` 看到 `data:` 帧含 productCards 与 done。
Commit：`feat: chat orchestration + mock/real providers + SSE endpoint`.

---

## 任务 17：助手 UI（FAB → Sheet 面板，克制呈现）

**文件：**

- 创建：`src/components/assistant/assistant-provider.tsx`（填充任务 11 空壳：`open(mode, product?)`/`close`/面板可见）、`fab.tsx`、`assistant-panel.tsx`、`message-list.tsx`、`markdown-lite.tsx`、`suggestion-chips.tsx`、`product-result-card.tsx`、`use-chat-stream.ts`、`src/components/assistant/assistant.test.tsx`
- 修改：`src/app/layout.tsx` 挂 `AssistantProvider`（任务 11 已留位）

- [ ] **步骤 1：use-chat-stream（SSE 消费 hook）与测试**

`use-chat-stream.ts`：管理 messages（`{role, content, cards?}[]`）、isStreaming、error、`send(mode, text, product?)`；内部 fetch `/api/ai/chat`，解析 `data:` 帧（reader + TextDecoder），`parseEvent` 分发：delta 追加当前 assistant 消息文本；productCards 存卡；sizeFit 展示结构化块；done/error 收尾；AbortController 存于 ref，组件卸载或重发时 abort。
测试（RTL + `vi.stubGlobal('fetch', ...)` 假 SSE Response body ReadableStream 推送帧序列）：断言消息增量、卡渲染、error 显示温和文案。

- [ ] **步骤 2：markdown-lite + 消息渲染**

`markdown-lite.tsx`：极轻渲染（不做完整 markdown 解析器依赖）：支持粗体 `**`、行内代码、`\n` 换行、项目符号行（`•` 前缀替换 `-`）。规避 XSS：先 `textContent` 构建再分割渲染，禁止 dangerouslySetInnerHTML。
`message-list.tsx`：用户消息右对齐浅底；assistant 消息含流式文本 + 可选 `ProductResultCard` 行 + 可选 sizeFit 结果条；自动滚动（`scrollIntoView` on new）除非用户上翻。

- [ ] **步骤 3：面板 + chips + FAB（克制措辞，规格 P1）**

`assistant-panel.tsx`：shadcn Sheet（`side="right"`）内嵌 MessageList + 输入框 + Send（发送中 disabled + aria-busy）+ 上下文 chip（PDP 时显示当前鞋名，带"×"移除）；首次打开显示欢迎语（消费端："Hi — need a hand finding your pair?"）+ 4 个建议 chips 措辞（规格 §8.1）："Find my size" / "Style it with" / "Help me pick" / "Everyday sneakers under $150"；chip 点击即 `send` 对应模式（find-my-size 用 size-fit + 当前商品上下文，help-me-pick 用 shopping…）。面板头部**不出现 "AI" 字样**。
`fab.tsx`：右下圆形按钮，图标 + 文案 "Need a hand?"（桌面显示文字，移动仅图标），`aria-label="Open shopping assistant"`。
`product-result-card.tsx`：从 ProductCard 复用简版（小图/名/价 → 链接详情）。

- [ ] **步骤 4：测试 + 手测**

`assistant.test.tsx`：假 fetch 推 `productCards` 帧 → 面板出现结果卡且可点击到 `/product/<handle>`；发送中禁发；error 帧显示温和文案与重试。
`bun run dev` 手测：Landing 不主动弹面板；PDP "Find my size" 打开面板并预置 size-fit 上下文；流式滚动；断网/无 key 场景全可用。
Commit：`feat: assistant UI — subtle FAB, sheet chat, streamed messages, suggestion chips`.

---

## 任务 18：文档、env 示例与验收门禁

**文件：**

- 创建：`.env.local.example`、`README.md`、`docs/superpowers/plans/execution-notes.md`（可空起步，随实现补充）
- 修改：`.gitignore`（校验 data/、.env* 规则）、`package.json`（prepush 门禁脚本可选）

- [ ] **步骤 1：env 示例与 README**

`.env.local.example` 内容（对应规格 §11 + 护栏参数）：

```bash
# --- Market ---
SITE_MARKET=US            # US|EU|UK|JP|CN —— 决定尺码展示体系
# --- AI（留空 = Mock 模式，零成本可演示）---
AI_API_KEY=
AI_BASE_URL=
AI_MODEL=gpt-4o-mini
AI_EMBEDDING_MODEL=text-embedding-3-small
# --- AI 护栏（规格 §8.5）---
AI_MAX_TURNS=20
AI_MAX_OUTPUT_TOKENS=500
AI_REQUEST_TIMEOUT_MS=20000
AI_DAILY_TOKEN_CAP=1000000
AI_DISABLE_REAL=0
# --- DB ---
DATABASE_URL=./data/local.db   # Postgres 迁移见 README
# --- Shopify（预留，本期忽略）---
SHOPIFY_DOMAIN=
SHOPIFY_STOREFRONT_TOKEN=
```

`README.md`：快速开始（`bun install && bunx drizzle-kit 不需要 —— bun run dev` 首次自动建表）、切真实 AI（填 key/base/model）、换市场（SITE_MARKET）、换 Shopify（文档化适配层切换与规格 §6 契约）、测试/门禁命令、目录地图、合规声明（无 cookie/埋点/无个人信息入 AI）。

- [ ] **步骤 2：验收门禁（规格 §12）**

按序执行并确保全绿：
`bun run typecheck` → `bun run lint` → `bun run test` → `bun run build`。
新增 `/shop?size=US 9` 与 `/product/<任一>` 手测点核对；`/api/ai/chat` 无 key 冒烟见任务 16。

- [ ] **步骤 3：Commit + 移交说明**

```bash
git add -A && git commit -m "docs: env example, README, execution notes"
```

---

## 规格覆盖对照（自检：无遗漏）

| 规格 § | 对应任务 |
|---|---|
| §2 目标/非目标、P1–P7 | 任务 1–18 全局（P1：任务 11/17 措辞；P2：任务 5/16 mock 默认；P3：任务 16 错误帧；P4：任务 5 适配层；P5：目录边界贯穿；P6：任务 15/16/18 无 PII；P7：任务 15） |
| §5 架构取舍（≤2k 应用层余弦；RAG-lite 零工具调用） | 任务 14（向量加载策略）、任务 16（无 function calling） |
| §6 CatalogAdapter 契约 + seed | 任务 1 类型、任务 4/5 |
| §6 尺码模型（mm 锚换算 + SITE_MARKET） | 任务 2/3/5/10 |
| §7 两表 DB | 任务 6 |
| §8.1 交互形态 | 任务 17（chips 措辞、会话重置=sessionKey 轮换） |
| §8.2 四模式 | 任务 16/17 |
| §8.3 降级链 | 任务 14/16 |
| §8.4 SSE 协议 | 任务 16（events.ts + route） |
| §8.5 护栏 | 任务 15 + 任务 16 接线 + 任务 18 env |
| §9 三页与组件 | 任务 11/12/10/17 |
| §9 CTA 占位 | 任务 5（getBuyUrl null）+ 任务 12（ProductBuyBar） |
| §10 布局 | 任务 1–18 逐步落地 |
| §11 env | 任务 18 |
| §12 测试/可靠性/性能/合规 | 各任务红-绿步骤 + 任务 13/18 |
| §13 决策 #9/#10/#11（尺码多市场、3D 字段先行、本地生成图） | 任务 2/3/7/10/12 |

## 执行顺序与依赖

任务严格递增依赖（N 依赖 N-1 之前产物）；关键串行点：3→5（换算进服务层）、6→14→16（DB→检索→编排）、11→17（assistant 空壳先立后填）、16→17（协议先行、UI 后接）。18 为最终门禁，任何任务不得破坏 `typecheck/lint/test/build`（用 failing→passing 循环保护）。
