/**
 * 简体中文词典。**键集必须与 `./en` 逐字相同**——键名是两种语言共享的契约，不是可翻译内容：
 * 少一条键是 TS2741 编译错误，多一条键由 `src/i18n/messages.test.ts` 的键集相等断言拦下。
 *
 * 口径（阶段 2 决策，术语见计划《术语表》与 ADR 0008）：
 * - **专有名词不译**：`Evoloop`、商品名（`Urban Bloom`）、赠品名 `little buddy`、`Geist`。
 * - **语言与市场解耦**（决策 6）：尺码值（`US 8.5`）与金额（`$128.00`）不随语言改变，故价格
 *   分档标签里的 USD 金额原样保留；本词典不出现人民币或其它币种。
 * - **交易事实不进词典**（ADR 0004）：尺码体系名、库存、订单状态、货号、色名、材质与赠品门槛
 *   都在原模块，这里只承载它们周围的中文句子；`src/server/ai/prompts.ts` 的提示词主体同理
 *   （模型面向的输入，不是消费端文案）。
 * - **句子中间夹数据**处的片段不带首尾空格（`shop.gift.*Lead/Tail`、`assistant.mock.*` 一类）：
 *   空格与连接词由拼装处决定，这里只保证片段自身可读、拼起来通顺。
 * - 目录数据（商品标题、`fitNotes`）在阶段 2 仍是英文：中文句子夹带英文数据是**内容回退**的
 *   正常形态，商品文案的翻译属阶段 3。
 */
const zhCN = {
  // 站内导航链接。键在这里、href 在 `src/lib/site.ts`。
  'nav.shop': '商店',
  'nav.collections': '系列',
  'nav.ourStory': '品牌故事',
  'nav.blog': '手记',
  // PDP 面包屑的结构化数据里回指首页的 crumb（不渲染成导航链接）。
  'nav.home': '首页',

  // 语言切换器（`src/components/i18n/language-switcher.tsx`）。`lang.en` / `lang.zhCN` 是
  // 「语言自称」，与英文词典**同值、不译**（读屏用户在中文界面里也要能找到 EN）。
  'lang.switchLabel': '切换语言',
  'lang.en': 'EN',
  'lang.zhCN': '中文',

  // 固定头部（`app-bar.tsx`）。'item'/'items' 是愿望单计数的量词片段：中文没有单复数，
  // 两条键同值（键集必须与英文一致，语言侧不因语法差异删键）。
  'marketing.appBar.cart': '购物车',
  'marketing.appBar.openMenu': '打开菜单',
  'marketing.appBar.menu': '菜单',
  'marketing.appBar.mobileNav': '移动端',
  'marketing.appBar.mainNav': '主导航',
  'marketing.appBar.search': '搜索',
  'marketing.appBar.searchStyles': '搜索款式',
  'marketing.appBar.searchProducts': '搜索商品',
  'marketing.appBar.wishlist': '愿望单',
  'marketing.appBar.wishlistItem': '件',
  'marketing.appBar.wishlistItems': '件',

  // 全站外壳（`site-shell.tsx`，键盘/读屏跳转链接）
  'marketing.shell.skipToContent': '跳到主要内容',

  // Landing hero（`hero.tsx`）。主标题是 `site.tagline`（Slogan 单源，不进词典）。
  'marketing.hero.kicker': '一种新的鞋履',
  'marketing.hero.title': '休闲鞋，按需打印，按你的尺码制作。',
  'marketing.hero.cta': '选购系列',
  'marketing.hero.explore': '探索系列',
  'marketing.hero.scrollLabel': '滚动到系列',

  // 卖点条（`promise-strip.tsx`）。`label` 同时用于 `aria-label` 与 sr-only h2。
  'marketing.promise.label': '为什么选择 Evoloop',
  'marketing.promise.fit.title': '尺码以你为准',
  'marketing.promise.fit.copy': '按脚长找到你的那一双 —— 尺码以毫米为准，打印前还会再核对一次。',
  'marketing.promise.madeToOrder.title': '按需打印',
  'marketing.promise.madeToOrder.copy': '你的尺码在下单后才打印，不提前批量生产。',
  'marketing.promise.carbon.title': '碳中和打印',
  'marketing.promise.carbon.copy': '每次打印都做了碳抵消，足迹因此更轻。',

  // 系列卡片区（`collection-cards.tsx`）。卡片里的名称/描述是目录内容，不进词典。
  'marketing.collections.kicker': '按系列选购',
  'marketing.collections.title': '找到你的日常一双',

  // 推荐位（`featured-grid.tsx`）
  'marketing.featured.kicker': '精选阵容',
  'marketing.featured.title': '按你的尺码新鲜打印',

  // Our Story（`story-section.tsx`）
  'marketing.story.kicker': '舒适，可以被量出来',
  'marketing.story.title': '以毫米定尺。按你真实的走路方式打造。',
  'marketing.story.fit':
    '多数鞋从一个数字开始。我们从你的脚开始 —— 从它的毫米数出发，所以在你迈出第一步之前，合脚就已经确定。',
  'marketing.story.cushioning':
    '缓震在你最需要的地方调校：脚跟下方更软，前掌下方回弹更足。不靠猜测，也不用长时间磨合。',
  // 项目起源 + 轻量诚实注脚（演示价/未开放结账）
  'marketing.story.origin':
    'Evoloop 始于一场学生黑客松 —— 一个周末的想法，如今长成我们持续在做的独立项目。下单尚未开放：目前价格与结算是演示。',
  'marketing.story.mmFit.term': '毫米定尺',
  'marketing.story.mmFit.detail': '所有市场共用一套尺码标准 —— 不再有说不清的尺码。',
  'marketing.story.zoneCushioning.term': '分区缓震',
  'marketing.story.zoneCushioning.detail': '落地处更软，蹬地处支撑更稳。',
  'marketing.story.madeToOrder.term': '按订单制作',
  'marketing.story.madeToOrder.detail': '每一双都在你下单后打印，所以不占仓库。',

  // 首页 FAQ 区块标题（`faq-section.tsx`）；问答对在下面的 `faq.*`
  'marketing.faq.kicker': '快速解答',
  'marketing.faq.title': '常见问题，直白回答。',

  // 首页 FAQ 问答对。顺序即渲染顺序，页面渲染与 FAQPage 结构化数据共用这一份（`src/lib/faq.ts`）。
  'faq.q1.question': 'Evoloop 是什么？',
  'faq.q1.answer':
    'Evoloop 是一个独立鞋履项目，用数字制造与以毫米为基准的尺码，探索按订单制作的休闲鞋。',
  'faq.q2.question': '怎么找到我的 Evoloop 尺码？',
  'faq.q2.answer':
    '站立时量较长的那只脚，记下毫米数，再对照商品页的尺码区间。如果处在两个尺码之间，选大的那个。',
  'faq.q3.question': 'Evoloop 的价格与结算已经开放了吗？',
  'faq.q3.answer': '当前目录是公开演示。商品价格与结算仅供参考，下单尚未开放。',
  'faq.q4.question': '在哪里可以了解材质与制作过程？',
  'faq.q4.answer': 'Evoloop 手记用平实的语言介绍数字鞋履、尺码、通勤与按订单生产。',

  // 页脚（`footer.tsx`）。`pitch` 与 `marketing.hero.title` 今天是同一句，但它们是两条独立键：
  // 两处文案会各自演化，合并成一条会让改 hero 副标题悄悄改掉页脚标语。
  'marketing.footer.navLabel': '页脚',
  'marketing.footer.pitch': '休闲鞋，按需打印，按你的尺码制作。',
  'marketing.footer.projectNote': '诞生于一场学生黑客松，此后作为独立项目持续打造。',
  'marketing.footer.source': '在 GitHub 上查看源码',

  // 站点级 metadata（`baseMetadataFor`，唯一消费点是最外层 `[locale]/layout.tsx` 的
  // `generateMetadata`；`global-not-found.tsx` 不消费它——noindex 页不需要全站元数据，裁决 R41）。
  // 两条键与英文信息等价：描述不含价格、库存、期限或额外承诺（ADR 0004），
  // 关键词只是英文那四条的对应词。
  // `keywords` 同样**逗号分隔且词条自身不含逗号**（`seo.ts` 按逗号 split）；分隔符用**半角**逗号。
  'meta.description': '休闲鞋按订单印制，采用数字制造与以毫米为基准的尺码，库存占用更低。',
  'meta.keywords': 'Evoloop,按订单制作的休闲鞋,3D 打印鞋,尺码指南',

  // OG 图的标题。`\n` 是排版换行（断行位置由词典决定），不是句子边界：
  // `src/app/og/route.tsx` 把它还原成 `<br/>`。
  'og.title': '休闲鞋，按需打印，\n按你的尺码制作。',
  'notFound.title': '找不到这个页面',
  'notFound.description': '它可能已经挪了位置，或者链接已经过期。不过商店还开着。',
  'notFound.cta': '去商店逛逛',

  // ── 批次 B：shop / 商品详情 / 商务错误 ────────────────────────────────────────
  // 表面归属与英文词典同一套：`shop.*` = /shop 列表页与 /saved 清单页；`pdp.*` = 商品详情页；
  // `cart.*` / `checkout.*` / `orders.*` = `CommercePanel` 的三个模式；`errors.*` = commerce
  // 客户端的错误码文案与其它系统反馈。**事实与数值一律不进词典**：尺码体系名、赠品门槛与材质、
  // 色名与货号都留在原模块，带数据的句子在这里只以「片段 + 原模块数据」拼回。
  // 唯一涉及金额的是价格分档标签：金额进词典但**不翻译**（保留 USD，ADR 0008 决策 6）。
  'shop.meta.description': '浏览全部款式 —— 每一双都围绕你的尺码按需打印。',
  'shop.schema.name': '选购 Evoloop 鞋款',
  'shop.schema.description': '浏览 Evoloop 休闲鞋款式及其可选尺码区间。',
  'shop.subtitle': '每一双都围绕你的尺码按需打印 —— 没有仓库，也没有浪费。',
  'shop.allStyles': '全部款式',
  // 结果计数（`{n} 款`）：数字是数据，只有量词进词典。中文没有单复数，两条键同值。
  'shop.styleCount.one': '款',
  'shop.styleCount.many': '款',

  // 筛选条（`product-filter-bar.tsx`）。**价格分档标签的金额是市场事实，只能保留 USD**：
  // `applyPriceRange` 的阈值（数字 100/150）与本处键值（`$100`/`$150` 文案）必须同步改。
  'shop.filter.label': '商店筛选',
  'shop.filter.searchLabel': '在结果中搜索',
  'shop.filter.search': '搜索',
  'shop.filter.searchPlaceholder': '搜索款式',
  'shop.filter.collection': '系列',
  'shop.filter.price': '价格',
  'shop.filter.anyPrice': '不限价格',
  'shop.filter.priceUnder100': '$100 以下',
  'shop.filter.price100To150': '$100 – $150',
  'shop.filter.priceOver150': '$150 以上',
  'shop.filter.sort': '排序',
  'shop.filter.sortFeatured': '精选',
  'shop.filter.sortPriceAsc': '价格：从低到高',
  'shop.filter.sortPriceDesc': '价格：从高到低',
  'shop.filter.sortNewest': '最新',
  'shop.filter.sizeLegend': '按尺码筛选',
  // 尺码 chip 的可及名后缀（`US 9（你的尺码）`）：尺码标签本身是领域事实，不进词典。
  'shop.filter.yourSize': '（你的尺码）',
  'shop.filter.clearAll': '清除全部',

  // 无结果空态（`src/app/[locale]/shop/empty-state.tsx`）
  'shop.empty.title': '没有匹配的款式',
  'shop.empty.body': '试着去掉一两个筛选条件 —— 每款都按需打印，你的尺码通常都有。',
  'shop.empty.cta': '查看全部款式',

  // 赠品活动（`shop/page.tsx` 的活动条 + `gift-gallery.tsx`）。门槛、赠品名与材质是
  // `src/lib/gift-offer.ts` 的事实单源，下面的片段是它们周围的句子（`…Lead` 在数据前，
  // `…Tail`/`…Mid` 在数据后）；夹在中间的英文事实是阶段 2 的已知形态。
  'shop.gift.kicker': '免费赠品',
  'shop.gift.headingLead': '订单满 $',
  'shop.gift.pickLead': '任选一件',
  'shop.gift.pickMid': '—— 由',
  'shop.gift.pickTail': '，不会造成浪费。结算时挑一件即可。',
  'shop.gift.bannerLead': '消费满 $',
  'shop.gift.bannerTail': '，即赠一份赠品。',
  'shop.gift.chooseLead': '可选，材质取自',
  'shop.gift.seeGifts': '看看赠品',
  'shop.gift.viewPhotosLead': '查看',
  'shop.gift.viewPhotosTail': '照片',
  'shop.gift.photo': '照片',
  'shop.gift.photos': '照片',
  'shop.gift.close': '关闭画廊',

  // 收藏清单页（/saved）与其客户端清单（`saved-pairs.tsx`）。
  'shop.saved.title': '已收藏的鞋款',
  'shop.saved.subtitle': '你在浏览或使用助手时标记的鞋款 —— 保存在这台设备上。',
  'shop.saved.metaDescription': '你收藏的鞋款 —— 从上次停下的地方继续。',
  'shop.saved.loadError': '无法载入你收藏的鞋款 —— 请检查网络后重试。',
  'shop.saved.loading': '正在载入你收藏的鞋款…',
  'shop.saved.emptyTitle': '还没有收藏',
  'shop.saved.emptyBody': '在商店或商品页点一下任意鞋款上的爱心，它就会出现在这里。',
  'shop.saved.emptyCta': '去商店逛逛',
  // 无尺码款卡片角标的回退文案（真实区间来自 `src/lib/size-range.ts`，不进词典）。
  'shop.saved.sizeToConfirm': '尺码待确认',
  'shop.saved.color': '种配色',
  'shop.saved.colors': '种配色',
  'shop.saved.onStore': '商店在售',
  'shop.saved.removeLead': '移除',
  'shop.saved.removeTail': '收藏',

  // 收藏心形按钮（`wishlist-button.tsx`）：商品卡与 PDP 共用，故归 shop 表面。
  'shop.wishlist.add': '加入愿望单',
  'shop.wishlist.remove': '从愿望单移除',
  // 参数化 SVG 商品图（`product-visual.tsx`）的无障碍名后缀：`{商品名} — 3D 打印鞋`。
  'shop.visual.printedShoe': '— 3D 打印鞋',

  // 商品详情页（`src/app/[locale]/product/[handle]/page.tsx`）
  'pdp.backToShop': '全部鞋款',
  'pdp.details.hidden': '商品信息',
  'pdp.accordion.materials': '材质与版型',
  'pdp.accordion.shipping': '配送与退货',
  'pdp.related': '你可能也喜欢',
  'pdp.findMySize': '帮我找尺码',
  // 色号图例（`product-actions.tsx`）：色名来自目录数据。
  'pdp.color.legend': '配色',
  'pdp.color.disclaimer': '屏幕上的配色可能略有差异。',
  // 尺码选择器（`size-selector.tsx`）。尺码标签本身来自领域事实，不进词典。
  'pdp.size.legend': '选择尺码',
  'pdp.size.yourSize': '你的尺码',
  'pdp.size.yourSizeSuffix': '（你的尺码）',
  // 图库（`product-gallery.tsx`）：缩略图 / 主图的可及名含色名或序号（数据），故片段化。
  'pdp.gallery.show': '查看',
  'pdp.gallery.photo': '照片',
  'pdp.gallery.in': '配色：',
  'pdp.gallery.views': '图片',
  'pdp.gallery.viewSide': '查看侧面',
  'pdp.gallery.viewSole': '查看鞋底',
  'pdp.gallery.viewDetail': '查看细节',
  // 购买条（`product-buy-bar.tsx`）：`{数量} 件在售`、`{尺码} 已选`。
  'pdp.buy.available': '件在售',
  'pdp.buy.adding': '正在加入…',
  'pdp.buy.addToCart': '加入购物车',
  'pdp.buy.loading': '正在载入可选规格…',
  'pdp.buy.chooseOptions': '请选择配色与尺码。',
  'pdp.buy.unavailable': '该配色与尺码不可售。',
  'pdp.buy.selected': '已选',
  'pdp.buy.added': '已加入购物车。',
  'pdp.buy.addFailed': '无法把该商品加入购物车。',
  'pdp.buy.viewCart': '查看购物车',
  // Shopify Buy Button（`shopify-buy-button.tsx`）：兼容入口（`SHOPIFY_ENABLED`）的兜底占位。
  'pdp.shopify.buyNow': '立即购买',
  // 「My size」行（`my-size-guide.tsx`）。脚长 mm 与体系名是领域事实；`outOfRange` 两侧片段
  // 夹着的 `US 4.5–12.5` 留在组件里（尺码体系不得因语言漂移，ADR 0008 决策 6）。
  'pdp.mySize.trigger': '我的尺码',
  'pdp.mySize.saved': '我的尺码：',
  'pdp.mySize.change': '修改或删除',
  'pdp.mySize.guidance': '获取尺码匹配建议',
  'pdp.mySize.measureAlt': '测量方法：站立，脚跟贴墙，量到最长的脚趾',
  'pdp.mySize.measureCopy': '站立时从脚跟量到最长的脚趾。取较长的那只脚。',
  'pdp.mySize.footLength': '脚长',
  'pdp.mySize.outsideAdult': '超出成人尺码范围',
  'pdp.mySize.footLengthAria': '脚长（毫米）',
  'pdp.mySize.footLengthNumberAria': '脚长毫米数（数字）',
  'pdp.mySize.outOfRangeLead': '该脚长不在我们当前的尺码范围内（',
  'pdp.mySize.outOfRangeTail': '）。请从范围内选择一个尺码，以获得匹配建议。',
  'pdp.mySize.save': '保存我的尺码',
  'pdp.mySize.update': '更新我的尺码',
  'pdp.mySize.remove': '删除',
  // 护理说明弹窗（`care-instructions.tsx`）。海报本身是英文印刷品（内容见 `store-policy.ts`），
  // 中文界面下的「卡面为英文」提示在任务 9 的 `pdp.policy.careSheetEnglish`。
  'pdp.care.title': '保养说明',
  'pdp.care.close': '关闭保养说明',
  'pdp.care.posterAlt': '如何保养你的鞋',
  // 打印规格（`print-spec-sheet-button.tsx` + `print-spec-sheet.tsx`）。
  'pdp.print.trigger': '打印 / 存为 PDF',
  'pdp.print.sheetLabel': '打印规格',
  'pdp.print.details': '详情',
  'pdp.print.colourways': '配色',
  'pdp.print.sizeConversion': '尺码换算',
  'pdp.print.note':
    '各尺码体系都由同一套毫米基准换算而来。参考表是演示数据 —— 下单前请先核对当前的尺码指南。',
  'pdp.print.policy': '按订单制作与退货',
  // 店务事实（`store-policy.ts`）的句子级文案：常量本身仍是导出名与单源，值来自这两条键。
  'pdp.policy.production': '每一双都在我们的工作室按订单打印，所以不占仓库 —— 只打印你买的那双。',
  'pdp.policy.returns':
    '每一双都按你的订单制作，因此定制打印商品不支持退货或退款。如果收到的鞋有质量问题，或合脚程度与承诺不符，请在 30 天内联系我们，我们会为你处理。',
  // 保养卡提示：卡面是**英文印刷品**（海报与 `POLICY_CARE` 原文），翻译会与实物矛盾，
  // 故中文界面只加这句说明，不译卡面本身（渲染点 `care-instructions.tsx`）。
  'pdp.policy.careSheetEnglish': '保养卡为英文原版，与包装内卡片一致。',

  // 购物车（`CommercePanel` mode='cart'）。行内尺码体系名是领域事实：语言不改变尺码显示体系。
  'cart.title': '购物车',
  'cart.meta.description': '查看你保存的 Evoloop 选购。',
  'cart.reviewCheckout': '核对并结算',
  'cart.itemUnavailable': '已不可售。请移除该商品后继续。',
  'cart.perPair': '/ 双',
  // 可见标签与可及名后缀各自成键：中文下两者同值，但不合并（键集必须与英文一致）。
  'cart.quantityLabel': '数量',
  'cart.quantityAria': '数量',
  'cart.remove': '移除',
  'cart.quantitySummary': '数量：',
  'cart.total': '合计：',
  'cart.empty': '购物车是空的。',
  'cart.continueShopping': '继续购物',
  'cart.backToCart': '返回购物车',

  // 结账（`CommercePanel` mode='checkout'）。支付未启用是硬事实，这里只承载它的说法。
  'checkout.title': '核对订单',
  'checkout.meta.title': '结算',
  'checkout.meta.description': 'Evoloop 结算演示。',
  'checkout.note': '提交订单时会重新计算总额。本地演示不加配送费与税费。支付尚未开放。',
  'checkout.creating': '正在创建…',
  'checkout.retry': '重试下单',
  'checkout.create': '创建待支付订单',

  // 订单（`CommercePanel` mode='order'）。订单状态是交易事实，只有它的**说法**在这里。
  'orders.title': '订单详情',
  'orders.meta.title': '订单状态',
  'orders.meta.description': '查看 Evoloop 订单状态。',
  'orders.orderId': '订单号：',
  'orders.status': '状态：',
  'orders.statusPendingPayment': '待支付',
  'orders.statusCancelled': '已取消',
  'orders.statusExpired': '已过期',
  'orders.paymentsDisabled': '支付尚未开放。',
  'orders.releasedCopy': '尚未扣款。库存已释放。如需购买，请重新把商品加入购物车。',
  'orders.pendingCopy': '尚未扣款。订单过期后库存会自动释放，你也可以提前取消。',
  'orders.reservedUntil': '库存保留至：',
  'orders.refresh': '刷新订单状态',
  'orders.permanentLink': '订单永久链接（仅本次购物会话内可用）',
  'orders.cancel': '取消订单并释放库存',

  // 商务错误（`src/lib/commerce-client.ts`）与系统反馈。键的叶子是**错误码的驼峰形**，错误码
  // 本身（snake_case）是跨语言机器契约，改名即破坏契约；映射在 `commerce-client.ts` 里显式列出。
  'errors.variantUnavailable': '该商品已不可售。请从购物车移除后继续。',
  'errors.insufficientStock': '库存不足。请调整购物车中的数量。',
  'errors.emptyCart': '购物车是空的。请先选择商品。',
  'errors.orderNotFound': '找不到当前会话下的这笔订单。',
  'errors.backendUnavailable': '购物服务暂时不可用，请稍后重试。',
  'errors.invalidResponse': '购物服务返回了无效响应，请稍后重试。',
  'errors.unknown': '无法完成该操作。请检查数量后重试。',
  'errors.unexpected': '出了点问题，请重试。',
  'errors.loading': '正在载入…',

  // ── 批次 C：助手（`src/components/assistant/**`）与服务端 AI / 护栏的消费端文案 ─────────
  // 表面归属与英文词典同一套。**提示词不进词典**：`src/server/ai/prompts.ts` 的 system 指令是
  // 模型面向的输入（规格 §9 只在阶段 2 追加**语言指令**）。句子中间夹商品名的地方按既有口径
  // 拆成片段，空格与列表连接词由拼装处决定——下面的 `、`/`和` 只是中文的连接词片段。

  // 确定性 mock 助手的可见回复（`mock.ts`）。`REDIRECT_TEXT` 仍是 `export const`，值取自这里。
  'assistant.redirect': '我负责帮你挑鞋、找到下一双 —— 说说你在找什么样的鞋？',
  'assistant.mock.supportFallback': '配送、退货和保养我都可以帮你看 —— 想先了解哪一项？',
  'assistant.mock.noStyles': '没有找到符合这次搜索的款式。',
  'assistant.mock.matchOneLead': '为你找到这一款：',
  'assistant.mock.matchTwoLead': '为你找到两款：',
  'assistant.mock.matchTwoJoin': '和',
  'assistant.mock.matchManyLead': '为你找到几款：',
  'assistant.mock.matchManyJoin': '、',
  'assistant.mock.matchManyLastJoin': '和',
  // 没有商品上下文时 outfit 回复里的占位主语（`把 {{这里}} 搭配…`）。
  'assistant.mock.theseShoes': '这双鞋',
  'assistant.mock.outfitStyleLead': '把',
  'assistant.mock.outfitStyleTail': '搭配宽松斜纹裤和纯色 T 恤，就是一套轻松的日常穿搭。',
  'assistant.mock.outfitLayer': '天凉时，在修身牛仔裤外叠穿一件中性色圆领针织衫。',
  'assistant.mock.outfitDress': '换成剪裁利落的西裤，把衬衫扎进腰头，就更接近正式一些的休闲造型。',
  'assistant.mock.noCatalogMatch': '目录里暂时没有找到符合描述的款式。',
  'assistant.mock.startLead': '我建议先看',
  'assistant.mock.startOneTail': '—— 它与你描述的需求很契合。',
  'assistant.mock.startTwoJoin': '再看',
  'assistant.mock.startTwoTail': '—— 两款都很贴合你的描述。',
  // 赠品行：门槛与赠品事实来自 `src/lib/gift-offer.ts`，这里只是它们周围的句子。
  'assistant.mock.giftLead': '另外提醒：订单满 $',
  'assistant.mock.giftMid': '即赠一只',

  // 会话内的失败与前置提示（`handlers.ts` / `chat.ts`），挂在助手消息上。
  'assistant.productRequired': '请先选择一个商品，我才能帮你看这个。',
  'assistant.noMatch': '暂时没找到匹配的款式 —— 换个说法试试，或者去商店逛逛。',
  'assistant.fallbackError': '出了点问题 —— 请再试一次。',
  'assistant.networkError': '我们这边出了点问题 —— 请再试一次。',
  // outfit 空文本时合成的用户轮：它代表用户那句话（发给模型并记账），故与界面文案同族。
  'assistant.outfitPrompt': '给我一些搭配建议。',

  // size-fit 的确定性建议（`size-input.ts`）。尺码体系名（`EU`）与换算值是领域事实，不进词典，
  // 故 `(EU)` 留在拼装处；商品名与 `fitNotes` 是目录数据，中文句子里夹英文是阶段 2 的已知形态。
  'assistant.sizeFit.askForSize': '可以告诉我你平时穿的尺码，或者你的脚长（厘米）吗？',
  'assistant.sizeFit.outOfStock': '这款在相近尺码上目前缺货。',
  'assistant.sizeFit.runs': '的版型：',
  'assistant.sizeFit.basedOnUsualSize': '按你平时的尺码，',
  'assistant.sizeFit.shouldFitBest': '最合脚。',
  // 尺码块的标签（`message-list.tsx`）：`试 US 9` / `相近尺码：US 8.5 · US 9`。
  'assistant.sizeFit.try': '试试',
  'assistant.sizeFit.nearby': '相近尺码：',

  // 助手浮层的界面文案（`assistant-panel.tsx` / `fab.tsx` / `message-list.tsx`）。
  // `fab.label` 与 `panel.title` 今天是同一句，但仍是两条独立键（各自演化）。
  'assistant.fab.label': '需要帮忙吗？',
  'assistant.fab.open': '打开购物助手',
  'assistant.panel.title': '需要帮忙吗？',
  'assistant.panel.subtitle': '可以问尺码、款式、配送与退货，或者店里现在有什么。',
  'assistant.panel.lookingAt': '当前查看：',
  // 关闭按钮的**可及名**（`sheet.tsx` 的 sr-only 文案，读屏会念出来）：由面板传入。
  'assistant.panel.close': '关闭',
  // `移除 {商品名}`：商品名是目录数据。
  'assistant.panel.removeProduct': '移除',
  'assistant.speak.read': '朗读回复',
  'assistant.speak.stop': '停止朗读回复',
  'assistant.speak.on': '开',
  'assistant.speak.off': '关',
  // 锚定欢迎语（`你好——这是 {{商品名}}。…`）：商品名两侧拆成两条片段。
  'assistant.welcome.lead': '你好——这是',
  'assistant.welcome.tail': '。想了解它、让我帮你找尺码，或者直接说你在找什么样的鞋，都可以。',
  'assistant.welcome.general': '你好 —— 需要帮你找到那一双吗？',
  'assistant.composer.label': '消息',
  'assistant.composer.placeholder': '问鞋款、尺码或风格…',
  'assistant.composer.send': '发送',
  'assistant.conversation': '对话',
  'assistant.retry': '重试',

  // 结果卡的元数据（`product-result-card.tsx`）：数字来自事件，只有量词进词典。
  'assistant.card.color': '种配色',
  'assistant.card.colors': '种配色',
  'assistant.card.photos': '张照片',

  // 开场建议 chips（`suggestion-chips.tsx`）。label 既渲染成按钮文字，也作为该轮的用户消息发给
  // 服务端，故两者必须同源（中文 label 会以中文进入 `text`，服务端的关键词分支见任务 8）。
  'assistant.chip.findMySize': '帮我找尺码',
  'assistant.chip.styleItWith': '搭配建议',
  'assistant.chip.helpMePick': '帮我挑一双',
  'assistant.chip.everydaySneakers': '日常运动鞋',
  'assistant.chip.shippingReturns': '配送与退货',
  'assistant.chip.careGuide': '保养指南',

  // 护栏拒绝（`guardrails/index.ts` 的 `GUARDRAIL_MESSAGE`，仍是 `export const`）：消费端措辞，
  // 绝不出现 "rate limited"（`GuardrailError.code` 才是机器契约）。
  'guardrail.cooldown': '助手正在短暂休息 —— 请稍后再试。',

  // 提示词里的**语言指令**（`src/server/ai/prompts.ts` 的 `systemFor` 在结尾追加）：提示词主体
  // 不进词典，但「用哪种语言回答」随请求语言变化。它不是消费端文案，而是给模型的输入，
  // 故单列一族 `prompts.*`。
  'prompts.languageInstruction': '始终用中文回答。',

  // ── 批次 D：landing / blog / 状态页与剩下的结构化数据文案 ──────────────────────────
  // 表面归属与英文词典同一套；**文章正文不进词典**（内容本地化是阶段 3），这里只有界面外壳。
  // 与前三批相同：句子中间夹内容数据（文章标题）的地方拆成片段。

  // 落地页的元信息与结构化数据。这三条与 `marketing.hero.title` / `marketing.footer.pitch` 不是
  // 同一串：metadata 标题按惯例**不带**句末句号（视觉标题带），故独立建键。
  'marketing.landing.meta.title': '休闲鞋，按需打印，按你的尺码制作',
  'marketing.landing.schema.name': 'Evoloop —— 按订单制作的休闲鞋',
  'marketing.landing.schema.description':
    '了解 Evoloop 休闲鞋、以毫米为基准的尺码、数字制造，以及工作室的故事。',

  // 博客索引与文章页（`src/app/[locale]/blog/**`）。索引页的 h1 与 metadata 标题共用
  // `nav.blog`（同一个表面名，同值同语境，不另建键）。
  'blog.meta.description': '来自 Evoloop 工作室的故事、指南与手记。',
  'blog.schema.name': 'Evoloop 手记',
  'blog.schema.description': '来自 Evoloop 工作室的故事与实用指南。',
  // 这一节的名字：索引页的 kicker 与文章页面包屑里的祖先节点都用它（同值同语境）。
  'blog.sectionName': '手记',
  'blog.subtitle': '来自工作室的故事、指南与手记 —— 从我们如何定尺，到工坊里发生的事。',
  'blog.empty': '还没有文章 —— 请稍后再来。',
  'blog.allPosts': '全部文章',
  // 无封面文章的替图可及名后缀：`{文章标题} 封面`（标题是内容资产，不进词典）。
  'blog.coverLabel': '封面',
  // 文章缺 description 时的元信息句首（`{这里} {标题}.`，标题与句号在拼装处）。
  'blog.articleMetaLead': 'Evoloop 手记文章：',
  // 回退提示条（`status === 'fallback'`）：说清「为什么这里是英文」，不是错误态。
  // 阶段 3 之前没有任何译文，故本语言的回退页都会渲染它。
  'blog.fallbackNotice': '本文暂无中文版本，以下为英文原文。',
  // 索引页回退条目的徽标，内容是**正文语言代码**：与英文词典同值（语言代码不翻译）。
  'blog.fallbackBadge': 'EN',

  // 错误边界（`src/app/[locale]/error.tsx`）。与 404 共用 `StatusShell`，但文案各自独立。
  'error.title': '我们这边出了点问题',
  'error.description': '请再试一次 —— 大多数小状况都会立刻恢复。',
  'error.retry': '重试',
  'error.cta': '去商店逛逛',

  // 商品结构化数据的标签（`productSchema` 的 `additionalProperty`）。
  'pdp.schema.availableSizes': '可选尺码',
  'pdp.schema.fit': '版型',
  'pdp.schema.salesStatus': '销售状态',
  'pdp.schema.salesStatusValue': '演示目录；结账尚未开放。',
  // 列表结构化数据的名字（`{品牌名} 鞋款系列`）：品牌名不本地化，只搬其余部分。
  'shop.schema.itemListSuffix': '鞋款系列',
} as const

export default zhCN
