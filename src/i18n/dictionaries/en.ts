/**
 * 英文词典。键是扁平点号键（`<surface>.<area>.<leaf>`），形状由 `messages.test.ts` 的正则固定。
 *
 * `as const` 使本文件的键集成为字面量联合：`Messages`（`src/i18n/messages.ts`）由它推导，
 * 因此「用了词典里没有的键」是编译错误；后续语言的词典也必须 `satisfies Messages`，
 * 缺键同样是编译错误，而不是运行时回退英文。
 *
 * 键族的划分：`nav.*` 是站内导航链接的文案（单源在 `src/lib/site.ts`，头部与页脚共用同一批键）；
 * `marketing.<area>.*` 是 `src/components/marketing/**` 各区块自己的文案；`faq.*` 是首页 FAQ 的
 * 问答对（`src/lib/faq.ts` 按 `faq.qN` 成对取用）。页面级文案（shop/pdp/cart/errors…）由后续批次交付。
 */
const en = {
  // 站内导航链接。键在这里、href 在 `src/lib/site.ts`：两处都靠这份键取值，改文案只改这里。
  'nav.shop': 'Shop',
  'nav.collections': 'Collections',
  'nav.ourStory': 'Our Story',
  'nav.blog': 'Blog',

  // 固定头部（`app-bar.tsx`）。'item'/'items' 是愿望单计数的量词片段，与上方 `wishlist`
  // 拼成 `Wishlist, 1 item`；拆开是因为复数形随语言变化（阶段 2 加语言时改为按语言的复数规则组合）。
  'marketing.appBar.cart': 'Cart',
  'marketing.appBar.openMenu': 'Open menu',
  'marketing.appBar.menu': 'Menu',
  'marketing.appBar.mobileNav': 'Mobile',
  'marketing.appBar.mainNav': 'Main',
  'marketing.appBar.search': 'Search',
  'marketing.appBar.searchStyles': 'Search styles',
  'marketing.appBar.searchProducts': 'Search products',
  'marketing.appBar.wishlist': 'Wishlist',
  'marketing.appBar.wishlistItem': 'item',
  'marketing.appBar.wishlistItems': 'items',

  // 全站外壳（`site-shell.tsx`，键盘/读屏跳转链接）
  'marketing.shell.skipToContent': 'Skip to content',

  // Landing hero（`hero.tsx`）。主标题是 `site.tagline`（Slogan 单源，本任务不移入词典）。
  'marketing.hero.kicker': 'A new kind of footwear',
  'marketing.hero.title': 'Casual shoes, printed to order in your size.',
  'marketing.hero.cta': 'Shop the collection',
  'marketing.hero.explore': 'Explore the series',
  'marketing.hero.scrollLabel': 'Scroll to collections',

  // 卖点条（`promise-strip.tsx`）。`label` 是 section 的标签（同时用于 `aria-label`
  // 与 sr-only h2——后者视觉隐藏，仅读屏可见）。
  'marketing.promise.label': 'Why Evoloop',
  'marketing.promise.fit.title': 'Sized to you',
  'marketing.promise.fit.copy':
    'Find your pair by foot length — sizing is anchored in millimetres and checked before it prints.',
  'marketing.promise.madeToOrder.title': 'Printed to order',
  'marketing.promise.madeToOrder.copy':
    'Your size is made when you order it, not mass-produced ahead of demand.',
  'marketing.promise.carbon.title': 'Carbon-neutral prints',
  'marketing.promise.carbon.copy': 'Every print run is offset, so the footprint stays light.',

  // 系列卡片区（`collection-cards.tsx`）。卡片里的名称/描述来自目录数据（内容资产），不进词典。
  'marketing.collections.kicker': 'Shop by series',
  'marketing.collections.title': 'Find your everyday pair',

  // 推荐位（`featured-grid.tsx`）
  'marketing.featured.kicker': 'The lineup',
  'marketing.featured.title': 'Fresh prints, ready in your size',

  // Our Story（`story-section.tsx`）
  'marketing.story.kicker': 'Comfort, measured',
  'marketing.story.title': 'Sized in millimetres. Built for how you actually walk.',
  'marketing.story.fit':
    'Most shoes start with a number. Ours start with your foot — its length in millimetres — and build from there, so the fit is precise before the first step.',
  'marketing.story.cushioning':
    'Cushioning is tuned where your foot needs it most: softer under the heel, more responsive under the ball of the foot. No guesswork, no long break-in.',
  // 项目起源 + 轻量诚实注脚（演示价/未开放结账）
  'marketing.story.origin':
    "Evoloop began at a student hackathon — what started as a weekend idea has grown into an independent project we keep building. Orders aren't live yet: prices and checkout are demo for now.",
  'marketing.story.mmFit.term': 'Millimetre fit',
  'marketing.story.mmFit.detail':
    'One sizing standard across every market — no more mystery sizing.',
  'marketing.story.zoneCushioning.term': 'Zone-tuned cushioning',
  'marketing.story.zoneCushioning.detail':
    'Softer landings where you strike, firmer support where you push off.',
  'marketing.story.madeToOrder.term': 'Made to order',
  'marketing.story.madeToOrder.detail':
    'Each pair is printed when you order, so nothing sits in a warehouse.',

  // 首页 FAQ 区块标题（`faq-section.tsx`）；问答对在下面的 `faq.*`
  'marketing.faq.kicker': 'Quick answers',
  'marketing.faq.title': 'Questions, answered plainly.',

  // 首页 FAQ 问答对。顺序即渲染顺序，页面渲染与 FAQPage 结构化数据共用这一份（`src/lib/faq.ts`）。
  'faq.q1.question': 'What is Evoloop?',
  'faq.q1.answer':
    'Evoloop is an independent footwear project exploring casual shoes made to order with digital manufacturing and millimetre-based sizing.',
  'faq.q2.question': 'How do I find my Evoloop size?',
  'faq.q2.answer':
    'Measure the longer foot in millimetres while standing, then use the size range on the product page. If you are between sizes, choose the larger size.',
  'faq.q3.question': 'Are Evoloop prices and checkout live?',
  'faq.q3.answer':
    'The current catalog is a public demo. Product prices and checkout are shown for exploration, but orders are not live yet.',
  'faq.q4.question': 'Where can I learn about the materials and process?',
  'faq.q4.answer':
    'The Evoloop journal explains digital footwear, sizing, commuting, and made-to-order production in plain language.',

  // 页脚（`footer.tsx`）。`pitch` 与 `marketing.hero.title` 今天是同一句，但它们是两条独立键：
  // 两处文案会各自演化，合并成一条会让改 hero 副标题悄悄改掉页脚标语。
  // Slogan（`site.tagline`）与项目起源声明（`projectNote`）分别来自 `src/lib/site.ts` 与本文件。
  'marketing.footer.navLabel': 'Footer',
  'marketing.footer.pitch': 'Casual shoes, printed to order in your size.',
  'marketing.footer.projectNote':
    'Born at a student hackathon. Built since as an independent project.',
  'marketing.footer.source': 'View source on GitHub',

  // OG 图的标题。`\n` 是排版换行（译者在词典里决定断行位置），不是句子边界：
  // `src/app/og/route.tsx` 把它还原成 `<br/>`。
  'og.title': 'Casual shoes, printed\nto order in your size.',
  'notFound.title': "We couldn't find that page",
  'notFound.description':
    'It may have moved, or the link may be out of date. The shop is still open, though.',
  'notFound.cta': 'Browse the shop',
} as const

export default en
