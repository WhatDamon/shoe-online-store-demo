export const site = {
  name: 'Evoloop', // 品牌名（全站引用点：导航/标题/SEO 均读 site.name）
  tagline: '3D Printed. Closed-Loop. A New Footwear Phenomenon.', // 核心 Slogan（hero 主标题 + footer + OG）
  // 项目起源声明（源于黑客松 → 独立项目）：Footer 全站一行；轻量诚实注脚（演示价/未开放结账）在 Our Story 段落尾部，结账演示状态由 PDP Demo 结账弹层负责
  projectNote: 'Born at a student hackathon. Built since as an independent project.',
  nav: [
    { label: 'Shop', href: '/shop' },
    { label: 'Collections', href: '/#collections' },
    { label: 'Our Story', href: '/#story' },
    { label: 'Blog', href: '/blog' },
  ],
  hero: {
    kicker: 'A new kind of footwear',
    title: 'Casual shoes, printed to order in your size.',
    cta: 'Shop the collection',
  },
}
