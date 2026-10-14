/**
 * 英文词典。键是扁平点号键（`<surface>.<area>.<leaf>`），形状由 `messages.test.ts` 的正则固定。
 *
 * `as const` 使本文件的键集成为字面量联合：`Messages`（`src/i18n/messages.ts`）由它推导，
 * 因此「用了词典里没有的键」是编译错误；后续语言的词典也必须 `satisfies Messages`，
 * 缺键同样是编译错误，而不是运行时回退英文。
 *
 * 键族的划分：`nav.*` 是站内导航链接的文案（单源在 `src/lib/site.ts`，头部与页脚共用同一批键）；
 * `marketing.<area>.*` 是 `src/components/marketing/**` 各区块自己的文案；`faq.*` 是首页 FAQ 的
 * 问答对（`src/lib/faq.ts` 按 `faq.qN` 成对取用）。页面级键族（`shop.*` / `pdp.*` / `cart.*` /
 * `checkout.*` / `orders.*` / `errors.*`）见文件末尾的批次 B 注释。
 */
const en = {
  // 站内导航链接。键在这里、href 在 `src/lib/site.ts`：两处都靠这份键取值，改文案只改这里。
  'nav.shop': 'Shop',
  'nav.collections': 'Collections',
  'nav.ourStory': 'Our Story',
  'nav.blog': 'Blog',
  // PDP 面包屑的结构化数据里回指首页的 crumb（不渲染成导航链接，故与上面四条分开）。
  'nav.home': 'Home',

  // 语言切换器（`src/components/i18n/language-switcher.tsx`）。`lang.en` / `lang.zhCN` 是
  // 「语言自称」，两个词典**必须同值**：读屏用户在中文界面里也要能找到 EN 这条出口。
  'lang.switchLabel': 'Change language',
  'lang.en': 'EN',
  'lang.zhCN': '中文',

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

  // ── 批次 B：shop / 商品详情 / 商务错误 ────────────────────────────────────────
  // 表面归属：`shop.*` = /shop 列表页、它的筛选条、空态、赠品活动，以及 /saved 清单页与
  // 两处共用的收藏心形按钮；`pdp.*` = 商品详情页及其客户端组件；`cart.*` / `checkout.*` /
  // `orders.*` = `CommercePanel` 的三个模式；`errors.*` = commerce 客户端的错误码文案与其
  // 它系统反馈。页面元信息（`meta.*`）与结构化数据（`schema.*`）也归各自表面：它们是该页的
  // SEO 文案。品牌名与 Slogan（`src/lib/site.ts`）仍不本地化（阶段 2 决策）。
  //
  // **事实与数值一律不进词典**：尺码体系名（US/EU/…）、赠品门槛与材质（`src/lib/gift-offer.ts`）、
  // 色名与货号都留在原模块；带数据的句子在这里只以「句子片段 + 原模块数据」拼回（片段存在的
  // 原因就是句子中间夹了数据）。唯一例外是价格分档标签：金额进了词典但**不翻译**（保留 USD），
  // 见 `shop.filter.price*` 的注释。
  'shop.meta.description': 'Shop all styles — every pair is printed to order around your size.',
  'shop.schema.name': 'Shop Evoloop shoes',
  'shop.schema.description': 'Browse Evoloop casual shoe styles and their available size ranges.',
  // 列表页副标题；`shop.allStyles` 同时是筛选条的「全部」选项与结果区的 sr-only 标题。
  'shop.subtitle': 'Every pair is printed to order around your size — no warehouses, no waste.',
  'shop.allStyles': 'All styles',
  // 结果计数（`{n} style` / `{n} styles`）：数字是数据，只有量词进词典。
  'shop.styleCount.one': 'style',
  'shop.styleCount.many': 'styles',

  // 筛选条（`product-filter-bar.tsx`）。**价格分档标签的金额是市场事实，只能保留 USD、绝不随
  // 语言改币种**（ADR 0008 决策 6）：同一个边界由 `applyPriceRange`（数字 100/150）与本处键值
  // （`$100`/`$150` 文案）两处共同表达，改一处必须同步另一处。排序选项的键在组件里按
  // `ShopFilter['sort']` 取值（`SORT_OPTIONS` 是键表，与 `src/lib/site.ts` 的 nav 同款）。
  'shop.filter.label': 'Shop filters',
  'shop.filter.searchLabel': 'Search within results',
  'shop.filter.search': 'Search',
  'shop.filter.searchPlaceholder': 'Search styles',
  'shop.filter.collection': 'Collection',
  'shop.filter.price': 'Price',
  'shop.filter.anyPrice': 'Any price',
  'shop.filter.priceUnder100': 'Under $100',
  'shop.filter.price100To150': '$100 – $150',
  'shop.filter.priceOver150': 'Over $150',
  'shop.filter.sort': 'Sort',
  'shop.filter.sortFeatured': 'Featured',
  'shop.filter.sortPriceAsc': 'Price: Low to High',
  'shop.filter.sortPriceDesc': 'Price: High to Low',
  'shop.filter.sortNewest': 'Newest',
  'shop.filter.sizeLegend': 'Filter by size',
  // 尺码 chip 的可及名后缀（`US 9 (your size)`）：尺码标签本身是领域事实，不进词典。
  'shop.filter.yourSize': '(your size)',
  'shop.filter.clearAll': 'Clear all',

  // 无结果空态（`src/app/[locale]/shop/empty-state.tsx`）
  'shop.empty.title': 'No styles match',
  'shop.empty.body':
    'Try removing a filter or two — every style is printed to order, so your size is usually available.',
  'shop.empty.cta': 'Shop all styles',

  // 赠品活动（`src/app/[locale]/shop/page.tsx` 的活动条 + `gift-gallery.tsx`）。门槛、赠品名与
  // 材质是 `src/lib/gift-offer.ts` 的事实单源；这里的片段是它们周围的句子（`…Lead` 在数据前，
  // `…Tail`/`…Mid` 在数据后）。
  'shop.gift.kicker': 'Free gifts',
  'shop.gift.headingLead': 'With any order over $',
  'shop.gift.pickLead': 'Pick one of these',
  'shop.gift.pickMid': '— pressed from',
  'shop.gift.pickTail': ', so nothing goes to waste. Just add one when you check out.',
  'shop.gift.bannerLead': 'Spend $',
  'shop.gift.bannerTail': ', get a free gift.',
  'shop.gift.chooseLead': 'to choose from, made from',
  'shop.gift.seeGifts': 'See the gifts',
  'shop.gift.viewPhotosLead': 'View',
  'shop.gift.viewPhotosTail': 'photos',
  'shop.gift.photo': 'photo',
  'shop.gift.photos': 'photos',
  'shop.gift.close': 'Close gallery',

  // 收藏清单页（/saved）与其客户端清单（`saved-pairs.tsx`）。
  'shop.saved.title': 'Saved pairs',
  'shop.saved.subtitle':
    'Pairs you marked while browsing or in the assistant — saved on this device.',
  'shop.saved.metaDescription': 'Your saved pairs — pick up where you left off.',
  'shop.saved.loadError':
    "We couldn't load your saved pairs — check your connection and try again.",
  'shop.saved.loading': 'Loading your saved pairs…',
  'shop.saved.emptyTitle': 'Nothing saved yet',
  'shop.saved.emptyBody':
    'Tap the heart on any pair — in the shop or on a product page — and it will show up here.',
  'shop.saved.emptyCta': 'Browse the shop',
  // 无尺码款卡片角标的回退文案（真实区间来自 `src/lib/size-range.ts`，不进词典）。
  'shop.saved.sizeToConfirm': 'Size to confirm',
  'shop.saved.color': 'color',
  'shop.saved.colors': 'colors',
  'shop.saved.onStore': 'On the store',
  'shop.saved.removeLead': 'Remove',
  'shop.saved.removeTail': 'from saved',

  // 收藏心形按钮（`wishlist-button.tsx`）：商品卡与 PDP 共用，故归 shop 表面。
  'shop.wishlist.add': 'Add to wishlist',
  'shop.wishlist.remove': 'Remove from wishlist',
  // 参数化 SVG 商品图（`product-visual.tsx`）的无障碍名后缀：`{商品名} — printed shoe`。
  // 同样是跨表面共用的组件（商品卡、PDP 图库、收藏清单、落地页集合卡、助手结果卡），
  // 归 shop 表面与 `shop.wishlist.*` 同一口径。商品名本身是目录数据，不进词典。
  'shop.visual.printedShoe': '— printed shoe',

  // 商品详情页（`src/app/[locale]/product/[handle]/page.tsx`）。
  'pdp.backToShop': 'All shoes',
  'pdp.details.hidden': 'Product details',
  'pdp.accordion.materials': 'Materials & fit',
  'pdp.accordion.shipping': 'Shipping & returns',
  'pdp.related': 'You may also like',
  'pdp.findMySize': 'Find my size',
  // 色号图例（`product-actions.tsx`）：色名来自目录数据。
  'pdp.color.legend': 'Color',
  'pdp.color.disclaimer': 'Colors may vary slightly on screen.',
  // 尺码选择器（`size-selector.tsx`）。尺码标签本身来自 `sizeLabel`/市场体系，不进词典。
  'pdp.size.legend': 'Select size',
  'pdp.size.yourSize': 'Your size',
  'pdp.size.yourSizeSuffix': '(your size)',
  // 图库（`product-gallery.tsx`）：缩略图的可及名含色名/序号（数据），故片段化。
  'pdp.gallery.show': 'Show',
  'pdp.gallery.photo': 'photo',
  'pdp.gallery.in': 'in',
  'pdp.gallery.views': 'views',
  'pdp.gallery.viewSide': 'Show side view',
  'pdp.gallery.viewSole': 'Show sole view',
  'pdp.gallery.viewDetail': 'Show detail view',
  // 购买条（`product-buy-bar.tsx`）。
  'pdp.buy.available': 'available',
  'pdp.buy.adding': 'Adding...',
  'pdp.buy.addToCart': 'Add to cart',
  'pdp.buy.loading': 'Loading available options...',
  'pdp.buy.chooseOptions': 'Choose a color and size.',
  'pdp.buy.unavailable': 'This color and size are unavailable.',
  'pdp.buy.selected': 'selected',
  'pdp.buy.added': 'Added to cart.',
  'pdp.buy.addFailed': 'Could not add this item to your cart.',
  'pdp.buy.viewCart': 'View cart',
  // Shopify Buy Button（`shopify-buy-button.tsx`）：SDK 加载期间/失败后留在原地的禁用占位按钮。
  // 与上面 `pdp.buy.*` 分开：那条是本站 demo 购买条，这条是兼容入口（`SHOPIFY_ENABLED`）的兜底。
  'pdp.shopify.buyNow': 'Buy now',
  // 「My size」行（`my-size-guide.tsx`）。脚长 mm 与五个体系名是领域事实，不进词典；
  // `outOfRange` 两侧的片段夹着的 `US 4.5–12.5` 同理留在组件里（尺码体系不得因语言漂移，
  // ADR 0008 决策 6）。
  'pdp.mySize.trigger': 'My size',
  'pdp.mySize.saved': 'My size:',
  'pdp.mySize.change': 'Change or remove',
  'pdp.mySize.guidance': 'Get size-matched guidance',
  'pdp.mySize.measureAlt':
    'How to measure: stand, place your heel at the wall, and measure to your longest toe',
  'pdp.mySize.measureCopy':
    'Measure from your heel to your longest toe, standing. Pick the longer foot.',
  'pdp.mySize.footLength': 'Foot length',
  'pdp.mySize.outsideAdult': '— outside adult sizes',
  'pdp.mySize.footLengthAria': 'Foot length in millimetres',
  'pdp.mySize.footLengthNumberAria': 'Foot length in millimetres (number)',
  'pdp.mySize.outOfRangeLead': 'That foot length is outside our current size range (',
  'pdp.mySize.outOfRangeTail': '). Pick a size in the range to get matched guidance.',
  'pdp.mySize.save': 'Save my size',
  'pdp.mySize.update': 'Update my size',
  'pdp.mySize.remove': 'Remove',
  // 护理说明弹窗（`care-instructions.tsx`）。
  'pdp.care.title': 'Care instructions',
  'pdp.care.close': 'Close care instructions',
  'pdp.care.posterAlt': 'How to care for your shoes',
  // 打印规格（`print-spec-sheet-button.tsx` + `print-spec-sheet.tsx`）。
  'pdp.print.trigger': 'Print / Save as PDF',
  'pdp.print.sheetLabel': 'Print specification',
  'pdp.print.details': 'Details',
  'pdp.print.colourways': 'Colourways',
  'pdp.print.sizeConversion': 'Size conversion',
  'pdp.print.note':
    'Sizes in each system convert from the same mm-anchored reference. The reference table is demo data — confirm the current size guide before ordering.',
  'pdp.print.policy': 'Made-to-order & returns',
  // 店务事实（`store-policy.ts`）的句子级文案：常量本身仍是导出名与单源，值来自这两条键，
  // 因此 AI support 注入与 PDP 手风琴/规格单读到的是同一份句子。
  'pdp.policy.production':
    'Every pair is printed to order in our studio, so nothing sits in a warehouse — we only print what you buy.',
  'pdp.policy.returns':
    "Because each pair is made to your order, custom-printed items can't be returned or refunded. If your pair arrives faulty or the fit is not as promised, message us within 30 days and we'll sort it out.",

  // 购物车（`CommercePanel` mode='cart'）。行内 `EU <n>` 的体系名是领域事实（ADR 0008
  // 决策 6）：语言不改变尺码显示体系。
  'cart.title': 'Cart',
  'cart.meta.description': 'Review your saved Evoloop selections.',
  'cart.reviewCheckout': 'Review checkout',
  'cart.itemUnavailable': 'No longer available. Remove this item to continue.',
  'cart.perPair': '/ pair',
  // 可见标签大写、每行下拉的可及名后缀（`{title} quantity`）小写：两条键，避免对已译文本
  // 做 `toLowerCase()`（部分语言会因此变形）。
  'cart.quantityLabel': 'Quantity',
  'cart.quantityAria': 'quantity',
  'cart.remove': 'Remove',
  'cart.quantitySummary': 'Quantity:',
  'cart.total': 'Total:',
  'cart.empty': 'Your cart is empty.',
  'cart.continueShopping': 'Continue shopping',
  'cart.backToCart': 'Back to cart',

  // 结账（`CommercePanel` mode='checkout'）。支付未启用是硬事实（本 MVP 不接真实支付），
  // 此处只承载它的说法，不承载支付结果。
  'checkout.title': 'Review order',
  'checkout.meta.title': 'Checkout',
  'checkout.meta.description': 'Evoloop checkout demo.',
  'checkout.note':
    'Your total is recalculated when you place the order. This local demo does not add shipping or tax. Payments are not available yet.',
  'checkout.creating': 'Creating...',
  'checkout.retry': 'Retry order request',
  'checkout.create': 'Create pending order',

  // 订单（`CommercePanel` mode='order'）。订单状态是交易事实，只有它的**说法**在这里。
  'orders.title': 'Order details',
  'orders.meta.title': 'Order status',
  'orders.meta.description': 'View an Evoloop order status.',
  'orders.orderId': 'Order ID:',
  'orders.status': 'Status:',
  'orders.statusPendingPayment': 'Pending payment',
  'orders.statusCancelled': 'Cancelled',
  'orders.statusExpired': 'Expired',
  'orders.paymentsDisabled': 'Payments are not available yet.',
  'orders.releasedCopy':
    'No payment has been taken. Inventory has been released. Add the item to your cart again to purchase.',
  'orders.pendingCopy':
    'No payment has been taken. Inventory will be released automatically when this order expires, or you can cancel it sooner.',
  'orders.reservedUntil': 'Inventory reserved until:',
  'orders.refresh': 'Refresh order status',
  'orders.permanentLink': 'Permanent order link (available only in this shopping session)',
  'orders.cancel': 'Cancel order and release inventory',

  // 商务错误（`src/lib/commerce-client.ts`）与系统反馈。键的叶子是**错误码的驼峰形**，错误码
  // 本身（snake_case）是跨语言机器契约，改名即破坏契约；映射在 `commerce-client.ts` 里显式
  // 列出（`satisfies Record<ErrorCode, keyof Messages>`），后端新增码而词典没跟上 = `tsc` 报错。
  'errors.variantUnavailable':
    'This item is no longer available. Remove it from your cart to continue.',
  'errors.insufficientStock': 'Not enough stock. Update the quantity in your cart.',
  'errors.emptyCart': 'Your cart is empty. Choose a product first.',
  'errors.orderNotFound': "We couldn't find this order for the current session.",
  'errors.backendUnavailable': 'The shopping service is temporarily unavailable. Please try again.',
  'errors.invalidResponse': 'The shopping service returned an invalid response. Please try again.',
  // 未识别的错误码（后端返回了词典里没有的 `code`）与 `CommercePanel` 的兜底：两条都在。
  'errors.unknown': "We couldn't complete that action. Check the quantity and try again.",
  'errors.unexpected': 'Something went wrong. Please try again.',
  'errors.loading': 'Loading...',

  // ── 批次 C：助手（`src/components/assistant/**`）与服务端 AI / 护栏的消费端文案 ─────────
  // 表面归属：`assistant.*` 同时承载**助手浮层的界面文案**与**产出会话正文的服务端模块**
  // （`src/server/ai/{mock,handlers,chat,size-input}.ts`）——两者是同一句对话的两端，拆成两族
  // 会让同一句话在词典里出现两次。`guardrail.*` 是护栏拒绝时显示的温和文案。
  //
  // **提示词不进词典**：`src/server/ai/prompts.ts` 的 system 指令是**模型面向的输入**，用户看不到，
  // 按 CONTEXT.md「服务端产出的消费端文案与开发者文案必须分开」留在原模块（规格 §9 的口径是
  // 阶段 2 给 `systemFor` 追加**语言指令**，不是把指令本身翻掉）。mock 用来分派行为的特征短语由
  // `MODE_SIGNALS` 单源提供给提示词与 mock 两侧，守卫见 `src/server/ai/copy-contract.test.ts`。
  //
  // 句子中间夹数据（商品名/尺码）的地方按既有口径拆成片段：片段不带首尾空格，空格与列表连接词
  // 由 `mock.ts` 拼；变长列表末尾的句号是句式骨架的一部分，也留在拼装处。

  // 确定性 mock 助手的可见回复（`mock.ts`）。`REDIRECT_TEXT` 仍是 `export const`，值取自这里。
  'assistant.redirect':
    "I'm here to help with shoes and finding your next pair — want to tell me what you're looking for?",
  'assistant.mock.supportFallback':
    'Happy to help with shipping, returns and care — what would you like to know?',
  'assistant.mock.noStyles': 'No styles matched that search.',
  'assistant.mock.matchOneLead': 'Here is your match: the',
  'assistant.mock.matchTwoLead': 'Here are two matches: the',
  'assistant.mock.matchTwoJoin': 'and the',
  'assistant.mock.matchManyLead': 'Here are a few matches: the',
  'assistant.mock.matchManyJoin': ', the',
  'assistant.mock.matchManyLastJoin': ', and the',
  // 没有商品上下文时 outfit 回复里的占位主语（`Style the {{这里}} with …`）。
  'assistant.mock.theseShoes': 'these shoes',
  'assistant.mock.outfitStyleLead': 'Style the',
  'assistant.mock.outfitStyleTail':
    'with relaxed chinos and a plain tee for an easy everyday outfit.',
  'assistant.mock.outfitLayer':
    'Layer a soft crew-neck sweater in a neutral tone over slim jeans on cooler days.',
  'assistant.mock.outfitDress':
    'Dress them up with tailored trousers and a tucked-in shirt for a smarter casual look.',
  'assistant.mock.noCatalogMatch':
    'I could not find a style matching that in the catalog just yet.',
  'assistant.mock.startLead': 'I would start with the',
  'assistant.mock.startOneTail': '— it reads as a strong match for what you described.',
  'assistant.mock.startTwoJoin': 'and the',
  'assistant.mock.startTwoTail': '— both read as strong matches for what you described.',
  // 赠品行：门槛与赠品事实来自 `src/lib/gift-offer.ts`，这里只是它们周围的句子。
  'assistant.mock.giftLead': 'And heads-up: orders over $',
  'assistant.mock.giftMid': 'include one free',

  // 会话内的失败与前置提示（`handlers.ts` / `chat.ts`），挂在助手消息上。
  'assistant.productRequired': 'Pick a product first, then I can help with that.',
  'assistant.noMatch':
    "I couldn't find a style that matches that yet — try different words or browse the shop.",
  'assistant.fallbackError': 'Something went wrong — please try again.',
  'assistant.networkError': 'Something went wrong on our end — please try again.',
  // outfit 空文本时合成的用户轮：它代表用户那句话（发给模型并记账），故与界面文案同族。
  'assistant.outfitPrompt': 'Give me outfit ideas.',

  // size-fit 的确定性建议（`size-input.ts`）。尺码体系名（`EU`）与换算值是领域事实，不进词典
  // （ADR 0008 决策 6：语言不改变尺码显示体系），故 `(EU)` 留在拼装处。
  'assistant.sizeFit.askForSize':
    'Can you tell me the size you usually wear, or your foot length in cm?',
  'assistant.sizeFit.outOfStock': 'This style is currently out of stock in nearby sizes.',
  'assistant.sizeFit.runs': 'runs',
  'assistant.sizeFit.basedOnUsualSize': 'Based on your usual size,',
  'assistant.sizeFit.shouldFitBest': 'should fit best.',
  // 尺码块的标签（`message-list.tsx`）：`Try US 9` / `Nearby sizes: US 8.5 · US 9`。
  'assistant.sizeFit.try': 'Try',
  'assistant.sizeFit.nearby': 'Nearby sizes:',

  // 助手浮层的界面文案（`assistant-panel.tsx` / `fab.tsx` / `message-list.tsx`）。
  // `fab.label` 与 `panel.title` 今天是同一句，但是两条独立键：入口按钮与面板标题各自演化
  // （与 `marketing.hero.title` / `marketing.footer.pitch` 同一口径）。
  'assistant.fab.label': 'Need a hand?',
  'assistant.fab.open': 'Open shopping assistant',
  'assistant.panel.title': 'Need a hand?',
  'assistant.panel.subtitle':
    'Ask about sizing, styles, shipping & returns, or what’s in the shop.',
  'assistant.panel.lookingAt': 'Looking at:',
  // 关闭按钮的**可及名**（`sheet.tsx` 的 sr-only 文案，读屏会念出来）：由面板传入，
  // primitive 的默认值仍是同一个字符串（阶段 1 输出等价）。
  'assistant.panel.close': 'Close',
  // `Remove {商品名}`：商品名是目录数据。
  'assistant.panel.removeProduct': 'Remove',
  'assistant.speak.read': 'Read replies aloud',
  'assistant.speak.stop': 'Stop reading replies aloud',
  'assistant.speak.on': 'On',
  'assistant.speak.off': 'Off',
  // 锚定欢迎语（`Hi — this is the {{商品名}}. …`）：商品名两侧拆成两条片段。
  'assistant.welcome.lead': 'Hi — this is the',
  'assistant.welcome.tail':
    ". Ask me about it, find your size, or tell me what you're looking for.",
  'assistant.welcome.general': 'Hi — need a hand finding your pair?',
  'assistant.composer.label': 'Message',
  'assistant.composer.placeholder': 'Ask about a shoe, size, or style…',
  'assistant.composer.send': 'Send',
  'assistant.conversation': 'Conversation',
  'assistant.retry': 'Try again',

  // 结果卡的元数据（`product-result-card.tsx`）：数字来自事件，只有量词进词典。
  'assistant.card.color': 'color',
  'assistant.card.colors': 'colors',
  'assistant.card.photos': 'photos',

  // 开场建议 chips（`suggestion-chips.tsx`）。label 既渲染成按钮文字，也作为该轮的用户消息
  // 发给服务端（`onPick(mode, label)` → 请求体 `text`），故两者必须同源。
  'assistant.chip.findMySize': 'Find my size',
  'assistant.chip.styleItWith': 'Style it with',
  'assistant.chip.helpMePick': 'Help me pick',
  'assistant.chip.everydaySneakers': 'Everyday sneakers',
  'assistant.chip.shippingReturns': 'Shipping & returns',
  'assistant.chip.careGuide': 'Care guide',

  // 护栏拒绝（`guardrails/index.ts` 的 `GUARDRAIL_MESSAGE`，仍是 `export const`）：消费端措辞，
  // 绝不出现 "rate limited"（`GuardrailError.code` 才是机器契约）。
  'guardrail.cooldown': 'The assistant is taking a short break — try again in a moment.',

  // ── 批次 D：landing / blog / 状态页与剩下的结构化数据文案 ──────────────────────────
  // 表面归属：`marketing.landing.*` 是落地页（`src/app/[locale]/(landing)/page.tsx`）自己的
  // 元信息与结构化数据（`marketing.<area>.*` 里的区块文案归各组件）；`blog.*` 是
  // `src/app/[locale]/blog/**` 的界面外壳（**文章正文不进词典**：内容本地化是阶段 3）；
  // `error.*` 是 `src/app/[locale]/error.tsx` 的错误边界；404 复用既有 `notFound.*`（同一条
  // 文案，两个 404 出口）。结构化的**标签**（PropertyValue 的 name/value）也属于展示文案，
  // 与 `shop.schema.*` 同一口径；`@type` 之类固定词表仍是代码里的协议常量。
  //
  // 与前几批相同：句子中间夹内容数据（文章标题）的地方按既有口径拆成片段，
  // 空格与句末句号是句式骨架，留在拼装处。

  // 落地页的元信息与结构化数据。这三条与 `marketing.hero.title` / `marketing.footer.pitch`
  // 不是同一串：metadata 标题按惯例**不带**句末句号（视觉标题带），证明见本批次的逐字比对；
  // 复用会把句号带进 <title>。故独立建键。
  'marketing.landing.meta.title': 'Casual shoes, printed to order in your size',
  'marketing.landing.schema.name': 'Evoloop — casual shoes made to order',
  'marketing.landing.schema.description':
    'Explore Evoloop casual shoes, millimetre-based sizing, digital manufacturing, and the studio story.',

  // 博客索引与文章页（`src/app/[locale]/blog/**`）。索引页的 h1 与 metadata 标题共用
  // `nav.blog`（与 /shop 共用 `nav.shop` 同一口径：同一个表面名，同值同语境，不另建键）。
  'blog.meta.description': 'Stories, guides and notes from the Evoloop studio.',
  'blog.schema.name': 'Evoloop Journal',
  'blog.schema.description': 'Stories and practical guides from the Evoloop studio.',
  // 这一节的名字：索引页的 kicker 与文章页面包屑里的祖先节点都用它（同值同语境）。
  'blog.sectionName': 'Journal',
  'blog.subtitle':
    'Stories, guides and notes from the studio — from how we size shoes to what happens inside the workshop.',
  'blog.empty': 'No articles yet — check back soon.',
  'blog.allPosts': 'All posts',
  // 无封面文章的替图可及名后缀：`{文章标题} cover`（标题是内容资产，不进词典）。
  'blog.coverLabel': 'cover',
  // 文章缺 description 时的元信息句首（`{这里} {标题}.`，标题与句号在拼装处）。
  'blog.articleMetaLead': 'An Evoloop Journal article:',

  // 错误边界（`src/app/[locale]/error.tsx`）。与 404 共用 `StatusShell`，但文案各自独立：
  // 错误是「重试」，404 是「页面没了」（`notFound.*`）。
  'error.title': 'Something went wrong on our end',
  'error.description': 'Please give it one more try — most hiccups clear right up.',
  'error.retry': 'Try again',
  'error.cta': 'Browse the shop',

  // 商品结构化数据的标签（`productSchema` 的 `additionalProperty`）。
  // 值是「演示目录、结账未开放」这一事实的说法（与 `checkout.note` / `marketing.story.origin` 同口径），
  // 不承载支付结果。
  'pdp.schema.availableSizes': 'Available sizes',
  'pdp.schema.fit': 'Fit',
  'pdp.schema.salesStatus': 'Sales status',
  'pdp.schema.salesStatusValue': 'Demo catalog; checkout is not live yet.',
  // 列表结构化数据的名字（`{品牌名} shoe collection`）：品牌名不本地化（阶段 2 决策），只搬其余部分。
  'shop.schema.itemListSuffix': 'shoe collection',
} as const

export default en
