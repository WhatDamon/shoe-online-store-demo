// 店务事实单源（AI support 客服 + PDP 静态文案共用）。
// 改动此处 = 两处同步：AI system 注入（prompts.ts）与 PDP「Shipping & returns」
// 手风琴渲染（product/[handle]/page.tsx）读同一常量，禁止在页面里再写一遍。
// 口径必须与产品现状一致（定制印刷不可退、护理见 POLICY_CARE 真实内容），不得编造
// 物流时效/订单状态等本站不存在的系统能力。

export const POLICY_PRODUCTION =
  'Every pair is printed to order in our studio, so nothing sits in a warehouse — we only print what you buy.'

export const POLICY_RETURNS =
  "Because each pair is made to your order, custom-printed items can't be returned or refunded. If your pair arrives faulty or the fit is not as promised, message us within 30 days and we'll sort it out."

/**
 * 护理指引 —— 内容逐条来自 ProductCareInstructions 护理海报（OCR 提取，
 * 2026-09-07；原图 ~/Desktop/Evoloop/Posters/ProductCareInstructions.png，
 * 压缩副本 src/assets/product-care-instructions.webp）。海报是纯英文排版，
 * 以下为完整正文：四段注意 + 末尾的不可退条款（与 POLICY_RETURNS 同口径，
 * 海报本身印有此句）。后续海报改版须同步更新本常量，不得凭空加内容。
 */
export const POLICY_CARE =
  'Care instructions — from the care sheet on each product page:\n' +
  '- Avoid prolonged exposure to direct sunlight and UV rays.\n' +
  '- Do not store in a closed, high-temperature environment for extended periods.\n' +
  '- Avoid prolonged soaking in water or cleaning agents.\n' +
  '- Avoid intentional repeated bending or rubbing.\n' +
  '- This is a custom-made product; non-returnable and non-exchangeable except for quality defects.'

/** AI support 模式注入的店务事实（克制：无营销推送、无虚构能力）。 */
export const STORE_POLICY_FACTS: string[] = [POLICY_PRODUCTION, POLICY_RETURNS, POLICY_CARE]
