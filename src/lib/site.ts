import type { Messages } from '@/i18n/messages'

export const site = {
  name: 'Evoloop', // 品牌名（全站引用点：导航/标题/SEO 均读 site.name）
  url: 'https://evoloop.site',
  // description 与 tagline 喂给 metadata、OG 图与结构化数据：它们是 SEO 文案，
  // 本地化属阶段 2 的决策（阶段 1 只有 en），本任务不动。
  description:
    'Evoloop is an independent footwear project exploring casual shoes made to order with digital manufacturing.',
  tagline: '3D Printed. Closed-Loop. A New Footwear Phenomenon.', // 核心 Slogan（hero 主标题 + footer + OG）
  // 导航只存键与 href，文案在词典里（`nav.*`）：头部与页脚渲染同一批键，改文案只改词典。
  nav: [
    { key: 'nav.shop', href: '/shop' },
    { key: 'nav.collections', href: '/#collections' },
    { key: 'nav.ourStory', href: '/#story' },
    { key: 'nav.blog', href: '/blog' },
  ] as const satisfies readonly { key: keyof Messages; href: string }[],
}
