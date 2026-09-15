/**
 * 赠品活动事实单源：满 $50 赠一、供应商边角料小件、送完为止。
 *
 * 同一份事实被 5 处不同层级渲染（shop 活动条、赠品画廊标题与正文、gift 条目描述、
 * AI shopping prompt、Mock 回复），且横跨 server / client 两侧。门槛数字与赠品说法
 * 因此只此一份：改活动只改这里，UI 与 AI 一起跟着变，不会各改各的。
 *
 * 只放事实，不放整句文案 —— 各呈现面各自的语气（"Spend $50, get a free gift." /
 * "Store offer: ..."）属于各自层级的表达，不在此收口。
 *
 * 版权口径见 ai/prompts.ts 的 GIFT_OFFER_RULES：不得点名或暗示任何第三方形象。
 */
export const GIFT_OFFER = {
  /** 触发门槛（美元）：UI 文案、gift 条目描述、AI prompt 共用同一数字。 */
  thresholdUsd: 50,
  /** 赠品单数名（中性，无第三方形象）。 */
  name: 'little buddy',
  /** 赠品复数名（画廊、活动条计数用）。 */
  plural: 'little buddies',
  /** 赠品材质/工艺说法（带冠词的完整短语，用于破折号插入语）。 */
  composition: 'a small accessory pressed from leftover upper offcuts',
  /** 赠品材质短语（不带冠词，用于 "pressed from ___" 句中）。 */
  material: 'leftover upper offcuts',
  /** 供给口径。 */
  availability: 'while supplies last',
} as const

/** AI shopping prompt 注入的完整店头事实句（营销口，只在 shopping 模式出现）。 */
export const GIFT_OFFER_FACT = `Store offer: any order over $${GIFT_OFFER.thresholdUsd} at the storefront includes one free ${GIFT_OFFER.name} — ${GIFT_OFFER.composition} — ${GIFT_OFFER.availability}.`

/** gift 条目描述（赠品画廊卡片/灯箱用），与活动门槛同源。 */
export const GIFT_ITEM_DESCRIPTION = `A ${GIFT_OFFER.name} pressed from ${GIFT_OFFER.material}. Free with any order over $${GIFT_OFFER.thresholdUsd} — ${GIFT_OFFER.availability}.`
