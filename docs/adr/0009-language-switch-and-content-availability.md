# 0009 — 语言切换器、内容可用性与阶段 2 的商品口径

**状态：** 已采纳 · **日期：** 2026-10-14

## 背景

ADR 0008 定下了 locale 放 URL 子路径、手写类型化词典、语言与市场解耦。阶段 2 把 `zh-CN`
真正接上（词典、`proxy` 协商、逐语言 SEO 信号、AI 的按语言输入规则）时，出现了一批**ADR 0008
没写到、但必须现在定下**的问题：

1. 用户怎么切语言？在只有 `en` 时这不是问题，有两种语言之后它立刻变成「少一个出口或都给错」。
2. 哪些页面/文章**值得**发 canonical 与 hreflang、值得进 sitemap？ADR 0008 决策 7 只说了「回退是
   显式状态」，没说判定权在谁手上、也没说判定失败算哪一类。
3. 商品在阶段 2 算不算「已翻译」？界面文案中文化了，但商品标题/描述/特性表的翻译排在阶段 3。
4. 「用内容语言发 SEO 信号」这条规则，遇到**同一页里既有英文内容又有中文界面句子**时会不会自相矛盾？
5. 离题拦截（`OFF_TOPIC`）要不要跨语言回落？

这五条都不是实现细节：1 决定 URL 产出面（错一档就是 404 链接）、2/3/4 决定发给搜索引擎的信号
真假、5 决定中文用户会不会被**拒答**。故记入 ADR。

## 决策

### 1. 语言切换器 = 两个链接 + 由 `proxy` 持久化偏好

**背景。** 切换语言有三种常见形态：一个 `<select>` 加 JS 写 cookie、一个「切到另一种语言」的
按钮加 JS 跳转、或每个语言一个普通链接。只要走 JS 写偏好，就又出现「服务端写的那份偏好」与
「JS 写的那份」并存的问题（服务端的偏好 Cookie 是 httpOnly，JS 写出的非 httpOnly 副本会被浏览器
同时发回，之后读哪一份取决于请求路径与浏览器行为——不确定）。

**决策。** 每个语言一个**普通链接**，当前语言那项标 `aria-current`；偏好不在这里写，而是靠
`src/proxy.ts` 已有的行为：访问**带合法 locale 前缀**的路径时，若偏好 Cookie 与路径语言不一致，
代理用 `setLocalePreference` 把它对齐。于是「点链接 = 完成切换」，不需要 JS、不依赖水合。

链接的 `href` 由 `localePath(targetLocale, stripLocale(pathname))` 计算，**整体解析**；外层是
`<div role="group" aria-label>` 而不是 `<nav>`（同一功能有两个实例，两个同名 landmark 是无障碍
坏味道）；标签用**语言自称**（`lang.en` = `EN`、`lang.zhCN` = `中文`，两个词典同值），不随界面
语言翻译——读屏用户在中文界面里也必须能找到 `EN` 这条出口。

三条在实现中被实测逼出来的边界（详见「证据」里的裁决位点）：

- **R37：`usePathname()` 可空。** 无 router 上下文时它返回 `null`，`stripLocale(null)` 会抛
  `TypeError`。回退为 `?? '/'`，并在**新**测试文件里钉住（不能靠既有的、无权修改的测试
  「碰巧不炸」来保障）。
- **R38：跨语言链接不得用 `LocaleLink`。** `LocaleLink` 的语义是「用**当前**语言给内部路径加
  前缀」；切换器要指向**另一个**语言，前缀必须由切换目标整体决定，否则渲染出
  `/zh-CN/en/shop` 这种双重前缀的 404 链接。
- **R39：`<md` 时头部宽度增量必须为 0，且断点必须相接。** 移动实例放进 AppBar 已有的
  `md:hidden` 移动菜单，头部实例用 `hidden md:flex`。AppBar 内部断点并不统一（移动菜单
  `md:hidden`、中央导航 `hidden md:flex`、内联搜索 `hidden lg:flex`），按 `lg` 分界会让
  768–1024px 的机器**一个切换器都没有**——功能整段消失，比多占约 82px 严重得多。

**边界与代价。** 本仓库没有 headless 浏览器、jsdom 不做布局，「不溢出」只能靠**构造上不增宽**
保证，不能靠尺寸估算；因此这条不变量由 class 断言（`hidden md:flex` / `md:hidden`）钉住，而不是
由实测钉住。切换器不保留 query（用 `useSearchParams()` 会让所有使用 AppBar 的静态页被迫进
Suspense/动态渲染），代价是切语言只保留「当前页」、不保留搜索与筛选参数。移动端多一次点开菜单，
可发现性略降。

### 2. 内容可用性驱动 canonical / hreflang / sitemap

**背景。** 「有没有译文」是内容层事实，但消费它的是三个不同层：页面 metadata（canonical /
hreflang）、`sitemap.ts`、以及将来的 JSON-LD。把判定写进页面里会三处漂移；把文件系统 IO 提到
纯词汇层会破坏 `src/i18n/` 的纯度（ADR 0008 决策 4）。

**决策。** 判定权拆成两半：`src/i18n/content.ts` 只放**纯词汇**（`ContentStatus` /
`LocalizedPost<T>`，不 import `node:fs`、不 import React、不读 `process.env`），文件系统 IO 留在
`src/lib/blog.ts`（`availableLocalesFor` / `getLocalizedPost` / `listLocalizedPosts`）。页面与
`sitemap.ts` 只消费这两层吐出的结果，不自己判断。

消费规则（ADR 0008 决策 7 的可执行形态）：

- **可用 = 可渲染。** 正文文件缺失、YAML 语法错、必填字段缺失都等同「该语言不可用」→ 回退；
  译文文件坏掉不能让 `sitemap` / 索引页 / 文章页在构建期变红（默认语言正文坏掉仍然要红——那是
  本站自己的内容，构建期就该失败）。
- **回退页**：canonical 指向**默认语言**的同一 slug，不发该语言的 hreflang，不进该语言的
  sitemap 条目。
- **已译页**：自指 canonical，与默认语言成对发 hreflang（含 `x-default`），进 sitemap。

**边界与代价。** 资格判定与「能不能渲染」共用同一处读取，所以判定不会比渲染更乐观——**可用必须
与可渲染同义**：解析失败（文件缺失、YAML 语法错、必填字段缺失）等同于不可用并回退，判定方没有
「看起来存在就算有译文」的宽松余地。**尚未实现的一条**：规格 §8.2/§8.3 还要求「译文过期
（`source_hash` 与默认语言正文不一致）即失去 hreflang 资格」，它是**提示级**判据，本阶段只落地了
「缺失/坏掉 → 回退」；新增的内容类型或过期判定必须接到同一对「纯词汇 + IO」上，不得各写一份
判定——否则同一条内容在 metadata 与 sitemap 里会得到不同结论。

### 3. 阶段 2 的商品口径：商品按回退处理，阶段 3 翻转

**背景。** 阶段 2 中文化的是**界面文案**（导航、政策句、错误文案），商品文案（标题、描述、
特性、`fitNotes`）的翻译由规格 §8.6 排在阶段 3。于是 `/zh-CN/product/<handle>` 是一个真实
存在的页面，但正文内容与 `/en/product/<handle>` 是同一份英文。

**决策。** 阶段 2 把商品一律按**回退**处理：`canonical` → `/en/product/<handle>`，不发
`zh-CN` 的 hreflang，`sitemap` 的商品段只展开 `['en']`。**绝不能**因为 URL 段是 `zh-CN` 就
发一条 zh 的 hreflang 或自指 canonical——那等于向搜索引擎声明一个并不存在的中文页。

**边界与代价。** 代价是**阶段 2 的 zh-CN sitemap 只有 3 个静态 URL**（`/zh-CN`、`/zh-CN/shop`、
`/zh-CN/blog`）——宁可少收录，也不发假 alternate。代价的接受方是流量而不是正确性：这是
`AGENTS.md` 的排序（先正确、后流量）在具体取值上的体现。阶段 3 商品译文落地后，商品段改为与
文章段同一写法（按实际可用性展开），本条即失效——翻转的判据是「商品文案确实有译文且可渲染」，
不是「阶段 3 这个日期到了」。

### 4. R49：「内容语言」管 SEO 信号，「URL 语言」管句子级 UI 文案

**背景。** 决策 2/3 要求「用**内容语言**发 SEO 信号」，一度被过度外推成「PDP 的政策句子也用
默认语言」。那会让 `/zh-CN/product/<h>` 里出现英文政策句——而中文词典里明明写着中文的
`pdp.policy.*`，写完却不用是自相矛盾的。

**决策。** 两个规则各有适用面，同页并存不矛盾：

- **句子级 UI 文案用 URL 语言**：政策句、按钮、提示、错误文案都是句子，中文页显示中文。
- **SEO 信号与结构化数据用内容语言**：canonical、hreflang、sitemap、JSON-LD 的
  `@id` / `inLanguage` 指**内容**的语言，那里把英文内容宣称成中文就是发假信号。

落地形态见 `src/lib/seo.ts` 的 `pageMetadata` / `alternatesFor`（`locale` 参数语义是「本页**内容**
语言」）与 `src/lib/store-policy.ts` 的注释（事实留常量、句子进词典）。

**边界与代价。** 于是 `/zh-CN/product/<h>` 会出现「政策句是中文、canonical 指 `/en`」的组合。
代价是有人会把它误读为矛盾并去「修」；换来的是两个规则各自的正确性。**若判断错**，正确性损失在
SEO 侧（假 hreflang / 假 canonical），比界面语言错更贵，因此分界必须写在结论里而不是靠记忆。

### 5. R48：`OFF_TOPIC` 按请求语言取表，不跨语言回落

**背景。** 离题拦截要判断「这句话是不是在问买鞋之外的事」。中文正常提问里会出现拉丁词
（`这双鞋的 code 是多少`），而英文离题词表里就有这类词。合并两张表，或「先查请求语言的表、
未命中再查另一语言」，都会把中文正常提问判成离题。

**决策。** `OFF_TOPIC` 是 `Record<Locale, …>`，**只查请求语言的那一张表**，不回落。中文界面里的
英文离题句因此**不被拦**（会走到正常推荐分支）——这是**有意取舍，不是 bug**，由
`src/server/ai/locale-input.test.ts` 的一条断言钉住。

**边界与代价。** 代价对比：不拦的代价是「中文界面里偶尔答非所问」（轻度）；合并的代价是
「含拉丁词的中文正常提问被拒答」（重度）。重度 > 轻度，故取前者。若将来要拦跨语言离题，正确
做法是**加语言判定**（例如文本以拉丁词为主时才查英文表），**不是**合并两张表。

## 边界和回滚

- **不加依赖、不加共享基础设施。** 切换器不引入 JS、偏好沿用已有的 Cookie；内容可用性是
  构建期文件系统事实，不需要 Redis 或跨实例状态。
- **决策 1 的回滚**：把切换器从头部/菜单移除即可回到「只有默认语言出口」的形态，无数据迁移。
- **决策 2/3 的回滚**：`sitemap.ts` 的商品段与页面的 `availableLocales` 都是显式传参，改回
  `LOCALES` 只影响发出的 SEO 信号，不影响页面可达性（回退页照样渲染）。
- **决策 3 的到期条件**是「商品译文可渲染」，不是日期；阶段 3 落地时必须同时改 `sitemap.ts` 的
  商品段与 PDP/列表的 `pageMetadata` 调用点，两处按用户故事写在一起才叫翻转完成。
- **决策 4/5 是规则分界**，靠注释与断言维持；任何一侧被「顺手统一」都会静默产生假信号或拒答。

## 证据

- **逐语言无障碍门禁**：`src/test/a11y/axe-gate-zh.test.tsx` 在 `zh-CN` 下重跑默认语言那份门禁
  的同一组组件（商品卡 / 尺码选择器 / landing 段落 / `Footer` / 赠品画廊），并**额外把 AppBar
  纳入扫描面**——语言切换器（`role="group"` + `aria-label` + `aria-current`，且同一功能有两个
  实例）此前不在任何 axe 扫描面内。断言：零 axe violation、拼装后的 heading 序仍是
  `[1,2,3,3,3]`。该文件还含一条**语言上下文锚点**断言（当前语言标记落在 `中文` 上）：没有它，
  把 Provider 换成默认语言后扫描仍会全绿，门禁会退化成空转。`src/test/a11y/axe-gate.test.tsx`
  与 `src/test/a11y/contrast.test.ts` 零改动。
- **对比度无需逐语言副本**：`contrast.test.ts` 读的是 `src/app/globals.css` 的设计 token 与
  `globals.css` 里的语义色板镜像，与 locale、与任何文案无关，语言切换不改变 token 组合。
- **抽取门禁**：`npm run check:i18n` 在本阶段仍为 0 阻塞命中、抑制数与登记项数与改动前一致；
  本次没有新增白名单条目。
- **内容可用性**：`src/i18n/content.ts`（纯词汇）与 `src/lib/blog.ts` 的
  `availableLocalesFor` / `getLocalizedPost` / `listLocalizedPosts`（IO）是判定单源；`sitemap.ts`
  的文章段按可用性展开、商品段阶段 2 固定 `['en']`；`src/lib/seo.ts` 的 `locale` 参数语义是
  「本页内容语言」。
- **切换器**：`src/components/i18n/language-switcher.tsx` 的注释记录 R37/R38/R39 与语言自称口径；
  `src/components/marketing/app-bar.tsx` 里两个实例的断点相接由
  `src/components/i18n/language-switcher.test.tsx` 的 class 断言钉住。
- 复核命令（不要引用任何历史数字，自己重跑）：
  `npx vitest run src/test/a11y && npm run verify && npm run check:i18n && npx next build --webpack`
