// 店务事实单源（AI support 客服 + PDP 静态文案共用）。
// 改动此处 = 两处同步：AI system 注入（prompts.ts）与 PDP「Shipping & returns」
// 手风琴渲染（product/[handle]/page.tsx）读同一常量，禁止在页面里再写一遍。
// 口径必须与产品现状一致（定制印刷不可退、护理见商品页海报入口），不得编造
// 物流时效/订单状态等本站不存在的系统能力。

export const POLICY_PRODUCTION =
  'Every pair is printed to order in our studio, so nothing sits in a warehouse — we only print what you buy.'

export const POLICY_RETURNS =
  "Because each pair is made to your order, custom-printed items can't be returned or refunded. If your pair arrives faulty or the fit is not as promised, message us within 30 days and we'll sort it out."

export const POLICY_CARE =
  'Care instructions are shown on each product page — open the Care instructions sheet under the product details to see the full care guide.'

/** AI support 模式注入的店务事实（克制：无营销推送、无虚构能力）。 */
export const STORE_POLICY_FACTS: string[] = [POLICY_PRODUCTION, POLICY_RETURNS, POLICY_CARE]
