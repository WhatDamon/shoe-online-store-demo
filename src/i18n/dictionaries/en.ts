/**
 * 英文词典。键是扁平点号键（`<surface>.<area>.<leaf>`），形状由 `messages.test.ts` 的正则固定。
 *
 * `as const` 使本文件的键集成为字面量联合：`Messages`（`src/i18n/messages.ts`）由它推导，
 * 因此「用了词典里没有的键」是编译错误；后续语言的词典也必须 `satisfies Messages`，
 * 缺键同样是编译错误，而不是运行时回退英文。
 */
const en = {
  'nav.shop': 'Shop',
  'notFound.title': "We couldn't find that page",
  'notFound.cta': 'Browse the shop',
} as const

export default en
