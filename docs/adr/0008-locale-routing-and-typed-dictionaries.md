# 0008 — URL 子路径 locale 路由与手写类型化词典

**状态：** 已采纳 · **日期：** 2026-10-13

## 背景

站点一直只有一种语言。`docs/superpowers/specs/2026-09-04-shoe-store-ai-design.md` 的决策 #9
写的是「鞋码多市场 = 配置级单市场切换（`SITE_MARKET` 默认 US）+ 脚长 mm 锚换算表 → 数据/换算
先行，**全站仍英文/USD**，新市场仅补表改配置」。本决策**部分取代** #9 的后半句：市场仍是配置级
单市场，但语言不再默认恒为英文。前半句（`SITE_MARKET` 单市场、mm 锚换算表）不变。

做多语言时有三个事实决定了实现形态：

1. **用户可见文案不是内联 JSX 文本。** 对 `src/`（排除测试）做 TypeScript AST 扫描，绝大多数
   文案候选是**字符串字面量**（散布在 props、数组、对象、模板里），内联 JSX 文本只占少数。
   逐文件手改 JSX 的收益很低，需要一个集中承载文案的机制。
2. **消费端文案有一部分产生在 `src/server/**`。** 助手兜底语、护栏温和文案、`size-fit` 的
   `rationale`、`PRODUCT_REQUIRED_TEXT`、`FALLBACK_ERROR_TEXT` 都由服务端产出，但渲染在浏览器里。
   词典因此**不能**是「只给客户端用」的模块。
3. **错误的真值已经在 TypeScript 侧。** `backend/app/application/errors.py` 抛出的每个
   `CommerceError` 都带机器可读 `code`，而 `src/lib/commerce-client.ts` 已经按 `code` 映射
   英文文案。Python 侧不需要知道语言。

方案候选：引入 `next-intl` / `react-i18next`；或手写类型化词典。本项目对新增依赖的门槛是
「先有容量与故障证据」（见 `AGENTS.md` 与 ADR 0006 的包管理器纪律），而 `verify` 里的
`check:slop` 会阻塞未引用文件与无人消费的导出——这两个门禁与「运行时 JSON 查表、缺键静默回退」
的方向相反。因此选择手写。

## 决策

### 1. locale 放 URL 子路径

```
/en/shop   /zh-CN/shop   /en/product/<handle>   ...
```

`LOCALES = ['en', 'zh-CN']`，`DEFAULT_LOCALE = 'en'`（`src/i18n/locales.ts`）。
**不采用** Cookie/`Accept-Language` 隐式切换：那会让同一个 URL 返回不同语言，无法给出逐语言
canonical 与 hreflang，与 `docs/seo-geo-plan.md` 的收录验收冲突。

旧的无前缀 URL 必须保持可达：`proxy.ts` 把 `/shop` 永久转到 `/en/shop`（GET/HEAD 用 308，
其余方法用 307，避免非幂等请求被改写语义）。

### 2. `proxy.ts` 是唯一的路由协商点

Next.js 16 已把 `middleware` 文件约定重命名为 `proxy`（见随包文档
`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` 的弃用声明），
本项目此前两者都没有。新增 `proxy.ts` 负责：

- 直通 `/api/**`、`/_next/**`、`/og`、`/robots.txt`、`/sitemap.xml`、`/favicon.ico` 与带扩展名的静态文件；
- 已带合法 locale 前缀 → 直通（并可更新偏好 Cookie，不重定向）；
- 其余 → 协商后跳转。

协商顺序：偏好 Cookie → `Accept-Language`（纯函数 `resolveLocale`，`q` 值排序，`zh`/`zh-Hans`
归一到 `zh-CN`）→ `DEFAULT_LOCALE`。依赖请求头的响应带 `Vary: Accept-Language`。
`proxy.ts` **不参与 commerce 会话**：会话 Cookie 与 `X-Session-ID` 语义不经过它。

### 3. 词典是手写 TypeScript 常量，缺键是编译错误

```ts
// src/i18n/dictionaries/en.ts        —— export default { ... } satisfies Messages
// src/i18n/dictionaries/zh-CN.ts     —— 同上
// src/i18n/messages.ts               —— export type Messages = typeof en
```

`zh-CN.ts` 用 `satisfies Messages` 对齐键集：**漏一条翻译在 `tsc --noEmit` 阶段失败**，而不是
运行时静默回退英文。这是选择手写而非 JSON 消息的核心理由——本项目要求「机械可判定才算通过」。

不引入 ICU。复数与日期用两个小助手表达（中文没有复数形态差异，助手对 `zh-CN` 返回同一形式）。

### 4. `src/i18n/` 是可被服务端与客户端同时导入的纯模块层

由于消费端文案既产自 `src/server/ai/**`、`src/server/guardrails/**`，也渲染在客户端组件中，
`src/i18n/` 必须：

- 不依赖 `src/server/**`、不依赖 React、不做 IO、不读 `process.env`；
- 不携带价格、库存、订单状态等交易事实（ADR 0004 边界不变，词典只承载文案）。

这条层规则与 `src/domain/` 同级，写进 `CONTEXT.md` 的目录层表，并复用
`scripts/check-server-boundary.mjs` 已有的导入方向检查思路。

### 5. 服务端取 locale 用 `next/root-params`，Route Handler 例外

`next/root-params` 提供 `locale()` getter，可在任意 Server Component 中调用，不必逐层传 prop。
随包文档明确它**不能用于 Route Handler**（Server Component 之外的支持尚未发布），因此
`/api/ai/chat` 的 locale 走请求体显式传入，用 `isLocale` 校验，非法值落 `DEFAULT_LOCALE`。
OG 图同理走 `/og?locale=`（`/og` 已被 proxy 排除，不带前缀）。

### 6. 语言与市场解耦

`SITE_MARKET`、`market.currency`（`USD`）与尺码换算表**不变**，仍是尺码显示体系与货币的真源。
`market.locale` 的硬编码 `'en-US'` 删除——它是「只有一个市场」时代的假单源。locale 只决定
文案与 `Intl` 格式化参数。

明示代价：中文界面显示 `US 8.5` 与 `$128.00`。这是刻意的——把语言与市场绑在一起会改变
展示契约（`sizeLabel`、`formatPrice` 的输出面）与 ADR 0001 的换算边界，超出本次范围。

### 7. 内容翻译：中文优先，缺则回退，且回退是显式状态

内容资产（blog 文章）允许没有译文。缺失时**回退到默认语言原文**，但回退是**可被门禁看见的
状态**，不是隐式兜底：页面显式告知读者本文暂无该语言版本，并且**不输出该语言的 hreflang、
canonical 指向默认语言原文、不进入 sitemap**。绝不用机器翻译冒充已翻译内容。

已译内容则输出自指 canonical、成对 hreflang（含 `x-default`）并进入 sitemap。细则与检查规则
见 `docs/superpowers/specs/2026-10-13-i18n-multi-language-design.md`。

### 8. Python commerce 不做 i18n

`CommerceError.code` 是机器契约，`OrderView.message` 当前没有任何界面渲染它。前端按 `code`
本地化即可（`src/lib/commerce-client.ts` 现有映射表就是接口）。后端保持英文单语，避免在交易
边界引入语言分支。

## 边界和回滚

- **只有 `en` 时行为等价**：阶段 1 的验收标准是页面正文 HTML 与改造前一致（差异仅限 canonical、
  `<html lang>`、链接前缀、sitemap 与 OG 的 locale 参数）。
- **回滚方式**：阶段 1 的 URL 形态变化是单次提交，`git revert` 即可；308 兼容跳转保证回滚前后
  旧 URL 都可达。后续阶段（加 `zh-CN`、加内容）是纯增量，可独立回滚。
- **不引入共享基础设施**：locale 偏好走 Cookie 与 URL，不需要 Redis 或跨实例状态（沿用
  `AGENTS.md` 的默认约束）。
- **不新增运行时依赖**：本次不引入 i18n 库，因此锁文件与 CI 矩阵不受影响。
- 词典不得成为绕过 ADR 0004 的通道：它只承载文案，不承载价格/库存/订单状态。

## 证据

- `npm run verify` 与 `npm run build` 在阶段 1 必须全绿，且**现有断言英文文案的测试文件零改动**：
  测试环境默认注入 `en` 词典，`axe-gate` 的标题层级与 `<h1>` 断言不动。
- 新增门禁 `scripts/check-i18n.mjs`：扫描 `src/app` 与 `src/components` 中未经 `src/i18n` 收口的
  散文字面量，风格对齐 `scripts/check-server-boundary.mjs`。
- 新增测试：`resolveLocale` 纯函数（`q` 值、`zh-Hans` 归一、非法输入）、`proxy.ts` 排除表与防环、
  两语言键集一致、`localePath` 前缀、per-locale canonical 与 hreflang 资格。
- `verify` 需要在 `typecheck` 之前补 `next typegen`：`tsconfig.json` 已 include `.next/types/**/*.ts`，
  而 CI 冷检出时该目录不存在，`[locale]` 根参数与 `PageProps` 的类型依赖生成产物（随包文档
  `.../06-cli/next.md` 给 CI 的建议即 `next typegen && tsc --noEmit`）。
