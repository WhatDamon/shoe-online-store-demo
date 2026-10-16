import { DEFAULT_LOCALE } from '@/i18n/locales'
import { messages } from '@/i18n/messages'

// 店务事实单源（服务端 AI 的注入事实）。
// 常量本身的消费者**只有服务端 AI**：事实注入（`prompts.ts`）与客服回复（`mock.ts`）读同一份，
// 不得在别处再写一遍。**页面可见的句子不读这些常量** —— PDP 与打印规格单按 URL 语言读词典键
// `pdp.policy.*`（见下「划分」，裁决 R49）。
// 口径必须与产品现状一致（定制印刷不可退、护理见 POLICY_CARE 真实内容），不得编造
// 物流时效/订单状态等本站不存在的系统能力。
//
// 句子级文案在词典里（`pdp.policy.*`），这里保留**导出名与单源关系**：改名或新增常量才会
// 影响消费点，改文案只改词典一处。
//
// **划分（裁决 R49）：句子进词典，事实（阈值/材质/期限）留在本模块。**
// - 消费端句子 → 词典键 `pdp.policy.*`：PDP 手风琴与打印规格单都按**URL 语言**直接读词典
//   （`t['pdp.policy.production']` / `t['pdp.policy.returns']`），与同页其它界面句子的语言一致。
//   这与 SEO 的「内容语言」规则不矛盾：canonical / hreflang / sitemap / JSON-LD 指向的是
//   **内容实际可用的语言**（商品文案只有英文，故 `/zh-CN/product/<handle>` 的信号指向 `/en/...`），
//   而界面句子的语言是 URL 语言。同一页上两者并存是刻意的：把英文内容宣称成中文才是给搜索引擎发
//   假信号，把中文界面里的政策句留给英文才是给用户发错文案。
// - 事实口径 → 留在本模块：`POLICY_PRODUCTION` / `POLICY_RETURNS` / `POLICY_CARE` 现在的消费者
//   **只有服务端 AI** —— `prompts.ts` 的事实注入（`STORE_POLICY_FACTS`）与 `mock.ts` 客服回复的
//   原样引用（后者是阶段 3/4 的移交项，见任务 9 报告）。`POLICY_CARE` 另是护理海报的原文
//   （英文印刷品，不译）。事实（不可退、30 天、按订单打印这类阈值与承诺）变更时必须两个语言一起改，
//   不允许只改一侧。
//
// 形状说明（不改）：这两个常量仍按**默认语言**取词典值，只服务服务端 AI 的模型输入与客服回复；
// 改成需要 locale 入参的函数会逼着 `prompts.test.ts` 的既有断言跟着改。
// **页面上的可见政策句不经过这里**：PDP 手风琴（`product/[handle]/page.tsx`）与打印规格单
// （`print-spec-sheet.tsx`，任务 9 修复轮）都直接读词典键 —— 否则中文页会印出英文政策句。
const t = messages(DEFAULT_LOCALE)

export const POLICY_PRODUCTION = t['pdp.policy.production']

export const POLICY_RETURNS = t['pdp.policy.returns']

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
