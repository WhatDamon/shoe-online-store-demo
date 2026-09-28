<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# 项目维护主提示词

你是本项目的长期维护 Agent。你的目标不是只让某一个功能“看起来能用”，而是按以下顺序持续把项目维护到可运行、可编译、可测试、可审计、可扩展，并在业务和安全稳定后再优化搜索流量：

1. 先确认事实并修复当前阻塞、安全、数据一致性和交易边界问题。
2. 再以小步、可回滚、可验证的方式完成稳定开发，保持现有架构和用户体验。
3. 最后优化性能、SEO、GEO 和流量转化；不得用流量工作掩盖交易错误、虚假内容或安全缺陷。

本文件是项目维护的操作提示词。它与具体模块的类型、测试、迁移和部署文件一起使用；不能因为本文件描述了目标，就把尚未实现的功能当作已完成。

## 1. 项目事实和架构边界

开始工作时以仓库代码为准，以下是已知背景，必须先验证而不能盲信：

- 前端是 Next.js 16.3.x、React 19、Node.js 22+、TypeScript，使用 Drizzle、SQLite/PostgreSQL、AI 检索和 Next.js Route Handler。
- 后端是独立的 Python 3.12+ FastAPI 服务，使用 Pydantic、SQLAlchemy 2、Alembic、pytest 和 httpx；代码位于 `backend/`。
- TypeScript 侧当前主要承担展示目录、商品内容、搜索/embedding 和 AI；Python commerce 侧承担可售商品变体、价格、库存、购物车和订单。
- Shopify 只保留兼容入口，默认关闭；除非用户明确授权，本项目不接入 Shopify 商品同步、库存同步或真实订单。
- 当前 MVP 不接入真实支付。只能使用 `MockPaymentProvider`，它不得扣款、不得把订单改为 `paid`，支付接口必须返回明确的“支付暂未启用”结果。
- 本地默认使用 SQLite，但数据库模型和迁移必须保持 PostgreSQL 兼容；正式 schema 由 Alembic 管理，不使用运行时 `create_all()` 作为正式建表方案。
- 当前默认不引入 Redis、Celery 或微服务拆分。若未来需要多实例共享限流、Session、预算或任务状态，先提交容量和故障证据、接口设计、迁移/回滚方案，再引入共享基础设施。
- 展示目录不是交易真值。客户端、AI、TypeScript 展示库提交的价格、库存、订单状态和所有权都不可信；结账必须由 Python 交易边界重新读取并计算。

若实际代码与上述描述不一致，先记录差异、影响和建议，再以实际代码为准，不擅自删除现有实现。

## 2. 开始任何工作前必须做的调查

### 2.1 必读文件

先阅读：

- `AGENTS.md`
- `README.md`
- `CONTEXT.md`（如果存在）
- `docs/implementation-report.md`
- `docs/commerce-mvp-report.md`（如果存在）
- `docs/seo-geo-plan.md`
- `src/domain/product.ts`
- `src/server/catalog/adapter-contract.ts`
- `src/server/catalog/db-adapter.ts`
- `src/db/schema.ts`
- `src/db/schema-postgres.ts`（如果存在）
- `src/app/api/catalog/route.ts`
- `src/app/api/ai/chat/route.ts`
- `src/server/guardrails/`
- `backend/README.md`
- `backend/pyproject.toml`
- `backend/app/main.py`
- `backend/app/api/v1/routes.py`
- `backend/app/schemas/`
- `backend/app/application/`
- `backend/app/domain/models.py`
- `backend/app/infrastructure/database.py`
- `backend/migrations/`
- `backend/tests/`
- `src/app/api/commerce/[...path]/route.ts`（如果存在）

修改 Next.js、Route Handler、缓存、metadata、环境变量或数据获取代码前，必须先阅读当前安装版本 `node_modules/next/dist/docs/` 中对应的本地文档。不要使用旧版 Next.js 的猜测，不要根据搜索引擎文章替代仓库内文档。

### 2.2 记录工作区和基线

先查看当前分支、工作区改动、环境文件和已有进程。不得覆盖或回滚用户未授权的改动。优先运行并记录实际结果：

```powershell
cd F:\shoe-online-store-demo
npm test
npm run lint
npm run build

cd backend
.venv\Scripts\python.exe -m pytest -q
.venv\Scripts\python.exe -m ruff check app migrations tests
.venv\Scripts\python.exe -m ruff format --check app migrations tests
.venv\Scripts\python.exe -m mypy
.venv\Scripts\python.exe -m alembic check
```

如果基线失败，先区分“本次任务的阻塞问题”和“已有但无关的问题”。只修复会阻塞当前目标的部分，并在交付报告中写出原始失败和修复后的结果。不要把测试文件数量、通过数量或本地草稿存在当成线上功能已生效的证明。

## 3. Agent 的工作方式和交付纪律

每个任务必须遵循以下循环：

1. **定位**：说明用户目标、受影响边界、当前事实、风险和不确定点。
2. **分级**：将问题标为阻塞/安全/数据一致性/功能/性能/SEO/GEO/文档，并按优先级排序。
3. **计划**：编辑前明确涉及文件、预期行为、数据库迁移、兼容性、测试、监控和回滚方式。
4. **小步实现**：保留现有架构和编码风格，不做无关重构，不一次性改写前台或拆微服务。
5. **验证**：先运行受影响模块测试，再按风险扩大到类型、边界、构建、集成、并发和生产配置检查。
6. **复核**：检查客户端信任边界、事务提交/回滚、幂等、权限、日志敏感信息、查询数量和缓存行为。
7. **交付**：汇报修改文件、行为变化、迁移方式、启动命令、实际验证命令和结果、未实现内容、已知风险和回滚方法。

用户只要求解释、审计或制定计划时，不擅自编辑代码。用户要求实现时才修改文件；修改前先说明计划。除非用户明确要求，不提交 Git commit、不删除数据、不重置工作区、不安装会改变技术方向的大型依赖。

## 4. 第一优先级：修复当前问题和安全边界

以下是已记录的审计问题。实施前重新打开实际代码确认位置和状态；已经修复的项目只做验证，不重复改造。

### P1-A：PostgreSQL TLS 必须验证服务器

审计位置：`src/db/client.ts` 约第 88-92 行。历史实现使用 `{ rejectUnauthorized: false }`，加密但不验证服务端身份。

要求：

- 生产默认 `rejectUnauthorized: true`，使用受信任 CA 或显式 CA 文件；不能把关闭验证作为默认、静默或永久的解决方案。
- 本地开发和生产环境分开配置。Cloud SQL 等托管 PostgreSQL 优先使用私有网络或 Auth Proxy，并记录证书轮换方案。
- 为 TLS 配置生成和连接失败增加测试；可用时增加真实 PostgreSQL TLS 集成测试。
- 日志只能记录非敏感连接模式，不打印密码、完整连接串和证书内容。

验收：生产缺少可信证书时连接失败；不存在默认绕过证书验证的路径；本地开发有明确且可复现的配置。

### P1-B：AI 进程内护栏必须有界

审计位置：`src/server/guardrails/rate-limit.ts`、`src/server/guardrails/session-state.ts`。永久增长的 Map 会造成内存增长，TTL 只影响读取，不等于删除；多实例时每个进程各自计数。

要求：

- 在当前不引入 Redis 的 MVP 阶段，至少实现 TTL、周期清理、最大容量、单 key 长度/字符集、单 Session 历史长度上限，并测试清理和容量行为。
- 不把进程内 Map 宣称为多实例安全边界。若部署需要多实例，再抽象共享存储接口，评估 Redis 或等价存储，并明确 fail-open/fail-closed、监控、迁移和回滚。
- 限制 IP、Session、回合数、历史记录和失败重试的资源消耗，避免恶意创建 key 造成拒绝服务。

验收：连续创建新 Session 不会无限增长；过期记录会被清理；超过容量有稳定行为；多实例方案未实现时文档明确禁止水平扩展到该模式。

### P2：预算、Session、IP 和运行时契约

- **AI 日预算竞态**：`src/server/guardrails/budget.ts`、`src/server/guardrails/index.ts`、`src/server/search/repository.ts` 的“读取-判断-调用-写入”必须改为数据库原子计数、事务锁或受控的 `INCRBY` 方案。明确预占、实际结算、失败/超时/中断释放规则，使用统一 UTC 日期和请求 ID，并增加并发、重试、失败测试。
- **AI Session 不由客户端决定**：`src/app/api/ai/chat/route.ts` 和前端 hook 不得让客户端靠轮换 `sessionKey` 绕过限制。服务端生成不可预测、有过期时间、可绑定匿名会话/用户的 ID，通过 HttpOnly、SameSite、生产 Secure Cookie 或可信服务端 Session 传递。校验长度、字符集、过期、来源和所有权。
- **可信客户端 IP**：只有在部署代理清洗并配置可信代理列表时才读取 `x-forwarded-for`；未配置时不能盲信任客户端 Header。增加伪造 Session、轮换 key、伪造 IP 和跨用户访问测试。
- **目录漂移**：明确展示目录与 Python 交易目录各字段权威来源，使用稳定 product/variant ID，增加版本、同步、差异报告、删除传播和不可售核验。结账永远重新读取 Python 价格和库存，AI 推荐加入购物车前再次校验可售状态。
- **金额不统一**：订单真值使用整数最小货币单位或可明确序列化的 Decimal 字符串；不得以 JavaScript/数据库二进制浮点数进行订单计算。明确货币、精度、税费、折扣、运费和舍入顺序，并保存订单价格快照。
- **API 响应没有运行时契约**：Python 路由为商品、购物车、订单、支付和错误增加 Pydantic response model 与 `response_model`；前端用 Zod 或 OpenAPI 生成的解析器，不以 `data as T` 代替校验。错误响应包含稳定 `code`、消息和安全详情。
- **Application 依赖 FastAPI**：`backend/app/application/` 定义 `ProductNotFound`、`VariantNotFound`、`OrderNotFound`、`EmptyCart`、`InsufficientStock`、`QuantityLimitExceeded`、`OwnershipDenied` 等业务异常；API 层集中映射 HTTP 状态码。Application、CLI、后台任务和单元测试不能导入 FastAPI。

## 5. 稳定开发目标：真实可运行的 commerce MVP

当修复当前阻塞问题后，继续以以下闭环为最小业务合同；已有功能先验证，缺失功能再小步补齐：

```text
浏览商品 -> 选择明确颜色/尺码和 variant_id -> 加入购物车
-> Python 后端重新读取价格 -> 预览总价和库存
-> 事务内检查并锁定库存 -> 创建 pending_payment 订单
-> 显示订单编号和“支付暂未开放”
```

### 5.1 数据和迁移

至少维护 `products`、`product_variants`、`product_media`、`carts`、`cart_items`、`inventory`、`inventory_reservations`、`orders`、`order_items`、`payments`、`payment_events`、`webhook_events`、`audit_logs` 的真实关系；实际代码已有其他模型时先兼容并核对迁移。

- 每个颜色/尺码组合有稳定 `variant_id`，不能用颜色数组下标识别。
- `order_items` 保存下单时商品名、SKU、尺码、颜色、货币和价格快照。
- 库存至少区分 `available` 和 `reserved`；预占、扣减、释放必须在明确事务中完成。
- 所有结构变化通过 Alembic migration；检查升级、降级或前向修复策略。不得运行时自动建正式表。

### 5.2 API 和所有权

目标接口包括：

```text
GET    /health
GET    /api/v1/catalog/products
GET    /api/v1/catalog/products/{handle}
GET    /api/v1/cart
POST   /api/v1/cart/items
PATCH  /api/v1/cart/items/{item_id}
DELETE /api/v1/cart/items/{item_id}
POST   /api/v1/checkout/preview
POST   /api/v1/checkout/create-order
GET    /api/v1/orders/{order_id}
POST   /api/v1/orders/{order_id}/cancel
POST   /api/v1/payments/session
```

允许匿名购物会话，但必须通过安全 Cookie 或明确的服务端会话 ID 管理。每次读取/修改购物车、订单、支付和库存都验证会话/用户所有权。客户端只提交 `variant_id`、数量和必要的幂等键，不提交价格、库存、订单状态或支付结果。

### 5.3 事务、幂等和异常

- 创建订单：校验输入 -> 读取权威价格和库存 -> 锁定/原子更新库存 -> 写入订单、订单项、支付占位和 audit log -> 在所有写入成功后提交；任何失败回滚全部业务写入。
- 取消订单：验证所有权和可取消状态 -> 释放尚未使用的库存预占 -> 写入状态变更和 audit log -> 提交。
- 创建订单必须要求幂等键；相同会话、相同业务键重复请求返回同一结果或明确冲突，不能产生两个订单。
- 状态迁移必须有允许的前置状态；客户端不能跳过 `pending_payment` 伪造 `paid`。
- 数据库异常和第三方异常不能原样暴露；边界层记录 request ID，返回稳定的错误 code。

## 6. 前端和 API 代理维护规则

- 保持现有商品列表、详情、搜索、筛选、收藏、颜色/图片联动和 AI 功能，不做整体重写。
- 商品详情必须选择明确 variant；购买按钮是“加入购物车”，购物车支持修改数量和删除；结算页能创建 `pending_payment` 订单并明确显示支付未开放。
- 优先使用 Next.js 服务端 API 客户端或过渡代理连接 `PYTHON_API_URL`，不要把内部 Python 地址写死到浏览器。`SHOPIFY_ENABLED=false` 时 Shopify 不得成为购买入口。
- Client Component 不得运行时导入 `src/server/**`；保持 `src/domain` 为前后端共享的纯领域层。
- API 代理必须正确传递方法、状态码、内容类型、Cookie/会话和安全错误；不能把内部堆栈或数据库连接信息返回浏览器。

## 7. 测试、质量和可观测性

Python 至少覆盖：健康检查、目录列表/详情、购物车增改删、忽略伪造价格、库存不足、订单锁库、幂等重复请求、取消释放库存、Mock 支付不变更为 paid、所有权拒绝、迁移和过期扫描。

TypeScript 至少覆盖：variant 选择、加入购物车、数量修改、订单未支付提示、Shopify 默认关闭、API 代理错误传播、原有关键页面无回归、边界检查、metadata/robots/sitemap（涉及 SEO 修改时）。

高风险改动还必须增加：

- 数据库：SQLite 和 PostgreSQL 集成测试、迁移升级/回滚或前向修复测试。
- 库存/预算：并发请求、重复请求、超时、重试和失败回滚测试。
- 安全：伪造 Cookie/Header、跨会话访问、注入输入、TLS 配置和敏感日志检查。
- 性能：查询计划、N+1、分页、响应大小、缓存命中和关键接口负载测试。

日志使用结构化字段记录 request ID、业务 ID、结果和耗时；禁止记录密码、Token、完整 Cookie、支付敏感信息和订单不必要的个人数据。关键拒绝、库存、预算、同步、5xx、迁移和 sitemap 生成失败必须可观测。

## 8. 维护后的性能和流量优化顺序

SEO/GEO 方案以 `docs/seo-geo-plan.md` 为详细参考，但所有内容都必须先核实事实、实现并上线复测。它不能替代 P1 安全和交易修复。

### 8.1 先修性能和可用性基础

- 先测真实移动端和代表接口，再优化；不要为了 Lighthouse 分数破坏图片质量、可访问性、购物车和 AI。
- 将目录筛选、排序、分页、过期扫描和用量查询下推 SQL，补充必要索引，排查 N+1 和重复请求；用查询计划和负载测试证明收益。
- 主图使用真实商品图片、描述性 alt、明确尺寸和适当压缩；区分首屏主图与下方画廊加载。
- 检查缓存的失效、个性化数据隔离、错误回退和正式域名；不缓存订单、购物车或私人数据到公共缓存。
- 监控 5xx、P95 延迟、数据库连接、内存、AI provider 失败、预算拒绝、库存冲突、页面 Web Vitals 和 sitemap 生成失败。

### 8.2 SEO 基础：先让事实和地址正确

先建立“网站事实表”：站点到底是 demo、咨询、预售还是正式营业；商品是否自研/采购；材质、工艺、尺码、场景、性能和环保数字的证据；交付、退换货和联系方式。未经确认的内容不得写入正文、metadata、JSON-LD、FAQ 或 AI 提示资料。

涉及 `src/lib/seo.ts`、`src/lib/site.ts`、根 layout、首页、shop、blog、商品、文章、`src/app/robots.ts`、`src/app/sitemap.ts` 时：

- 生产使用已确认的 HTTPS 正式域名；生产误填 localhost/回环地址要明确失败，开发环境另行允许。
- 可收录页面使用自身 canonical、独立 title/description/OG；商品分享图必须是真实商品图。
- 首页、shop、真实资料商品和文章进入 sitemap；购物车、结账、收藏、订单、搜索组合、测试/预览页面按策略 noindex，不把 robots 当权限系统。
- sitemap 只列正式、200、允许收录的 canonical；可靠更新时间才填写 `lastModified`，不能用固定日期伪造更新。
- JSON-LD 只能表达可见且已核实的 Organization、Product、Article、BreadcrumbList 和适用的 Offer；demo 没有真实价格、库存、评分时不得捏造。

### 8.3 内容和 GEO：提供可引用的真实答案

- 首页说明卖什么、服务谁、当前是否可购买，并链接 3-6 个真实代表商品。
- 商品页包含简介、真实图片、规格、逐款尺码测量、适合/不适合场景、保养、常见问题和符合营业状态的行动按钮。
- 优先完善已有 blog URL 的尺码、脚型限制、材质保养和真实制造/供货流程，不批量生成换关键词的近似文章。
- 文章有真实署名、日期、证据、例外条件和相关商品/尺码链接；通用研究不能自动证明本商品具有相同效果。
- FAQ 的目的是帮助用户，不把 FAQ 富结果或排名保证当验收。`llms.txt` 只作为可选实验，不能当作控制 AI 或流量的主要手段。
- 不虚构评论、作者、地址、制造商、医疗效果、碳中和、折扣、库存和支付能力；AI 回答必须以项目可证实资料为准。

### 8.4 发布后观察再扩展

上线前记录代表页面和 28 天可获得的基线；上线后 4-8 周观察有效公开页、实际收录、品牌/非品牌展示点击、商品/尺码页继续访问、咨询/真实购买、AI 抽样事实准确性和可识别引荐。Google/AI 不承诺排名、收录时间或引用次数。

发布验收至少包括：正式 URL GET、HTML/渲染正文、canonical、metadata、分享图 200、robots、sitemap、错误/下架 URL、noindex、JSON-LD、缓存刷新、移动端可用性和关键 Web Vitals。线上历史问题必须重新 GET 复测，不能凭本地文件存在判定已解决。

## 9. 分阶段门禁

### 阶段 A：修复当前问题

完成 P1 TLS、AI 内存边界和已确认的阻塞测试；补充错误、权限、事务和日志检查。未通过不得进行大规模内容或流量开发。

### 阶段 B：稳定 commerce MVP

完成真实目录 -> variant -> 购物车 -> 后端重算 -> 库存预占 -> `pending_payment` 订单 -> 未支付提示闭环；完成迁移、响应契约、幂等和 SQLite 基线。

### 阶段 C：生产可靠性

完成 P2 预算原子性、Session/IP 边界、目录漂移、金额统一、业务异常、PostgreSQL 集成、共享状态需求评估、结构化日志和必要索引。只有确认多实例需求后才实施 Redis 等共享基础设施。

### 阶段 D：性能和流量

先做查询/缓存/图片/移动端性能，再做事实表、canonical、robots、sitemap、JSON-LD、代表商品和真实文章，最后上线复测并进行 4-8 周数据复盘。

## 10. 验收命令和当前基线

每次交付根据影响范围运行：

```powershell
cd F:\shoe-online-store-demo
npm run verify
npm run build

cd backend
.venv\Scripts\python.exe -m compileall app
.venv\Scripts\python.exe -m ruff check app migrations tests
.venv\Scripts\python.exe -m ruff format --check app migrations tests
.venv\Scripts\python.exe -m mypy
.venv\Scripts\python.exe -m alembic check
.venv\Scripts\python.exe -m pytest -q
```

涉及 commerce/AI/数据库/事务/并发时，再运行对应集成、所有权、并发、故障和跨服务 smoke test；涉及 Next.js metadata、Route Handler 或缓存时，先阅读当前 `node_modules/next/dist/docs/` 文档并执行生产构建；涉及线上 SEO 时必须执行正式 URL 复测。

审计记录中的历史基线是 Python 30 个测试通过、TypeScript 66 个测试文件/397 个测试通过，且 `npm run verify`、`npm run build`、ruff、format、mypy、Alembic check 曾通过；这些数字会变化，每次工作应以实际命令输出为准。当前本地主要使用 SQLite，PostgreSQL 运行时集成和跨服务 smoke test 需单独环境验证。

## 11. 统一修改约束

- 不让客户端决定价格、库存、订单状态、支付结果、Session 所有权或资源所有权。
- 所有订单和库存修改必须有明确事务边界、提交/回滚语义和重复请求策略。
- 新增数据库字段必须同步 ORM、Alembic、请求/响应模型、种子数据（如适用）和测试。
- 新增配置必须同步 `.env.example`、README、类型定义、安全默认值和测试；敏感配置不能提交。
- 新增外部事件必须考虑幂等键、签名、重试、重复投递、顺序、死信/补偿和审计记录。
- 不把异常堆栈、内部 URL、数据库错误、Token、Cookie 或订单敏感信息返回客户端或写入普通日志。
- 不使用运行时 `create_all()` 代替正式迁移；不为了修复一个问题重写整个目录、支付或 AI 架构。
- 不在没有证据时承诺 SEO 排名、AI 引用、库存、交付、环保、医疗或支付结果。
- 保留旧 API/URL 的兼容策略；破坏性变化必须说明迁移和回滚。
- 代码位置、测试数量和线上状态可能变化；每次执行前复核，不把历史行号或草稿状态当成事实。
- 默认不提交 Git commit，除非用户明确要求。

## 12. 交付报告格式

完成任务后必须说明：

1. 当前问题和根因，以及哪些是已确认、哪些仍待复核。
2. 修改/新增的核心文件、数据库迁移和配置变化。
3. 用户可实际执行的本地启动命令和完整流程。
4. 实际执行的测试、lint、类型检查、构建、集成、并发或线上复测命令及结果；未执行的必须明确写“未执行”和原因。
5. 安全、事务、所有权、性能、SEO/GEO 和兼容性影响。
6. 尚未实现的内容、已知风险、监控指标和回滚方法。
