import type { Messages } from '@/i18n/messages'

/**
 * 首页 FAQ 的问答对，文案在词典里（`faq.q1.*`…）。顺序即渲染顺序，页面区块
 * （`src/components/marketing/faq-section.tsx`）与 FAQPage 结构化数据
 * （`src/app/[locale]/(landing)/page.tsx`）共用这一份，避免两处顺序/内容漂移。
 */
export function homepageFaq(t: Messages): { question: string; answer: string }[] {
  return [
    { question: t['faq.q1.question'], answer: t['faq.q1.answer'] },
    { question: t['faq.q2.question'], answer: t['faq.q2.answer'] },
    { question: t['faq.q3.question'], answer: t['faq.q3.answer'] },
    { question: t['faq.q4.question'], answer: t['faq.q4.answer'] },
  ]
}
