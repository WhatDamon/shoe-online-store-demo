/**
 * 英文词典。键是扁平点号键（`<surface>.<area>.<leaf>`），形状由 `messages.test.ts` 的正则固定。
 *
 * `as const` 使本文件的键集成为字面量联合：`Messages`（`src/i18n/messages.ts`）由它推导，
 * 因此「用了词典里没有的键」是编译错误；后续语言的词典也必须 `satisfies Messages`，
 * 缺键同样是编译错误，而不是运行时回退英文。
 */
const en = {
  'nav.shop': 'Shop',
  // OG 图的标题。`\n` 是排版换行（译者在词典里决定断行位置），不是句子边界：
  // `src/app/og/route.tsx` 把它还原成 `<br/>`。
  'og.title': 'Casual shoes, printed\nto order in your size.',
  'notFound.title': "We couldn't find that page",
  'notFound.description':
    'It may have moved, or the link may be out of date. The shop is still open, though.',
  'notFound.cta': 'Browse the shop',
} as const

export default en
