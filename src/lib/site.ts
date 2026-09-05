export const site = {
  name: 'Evoloop', // 品牌名（全站引用点：导航/标题/SEO 均读 site.name）
  tagline: '3D Printed. Closed-Loop. A New Footwear Phenomenon.', // 核心 Slogan（hero 主标题 + footer + OG）
  // 项目性质声明（学生黑客松作品、非商业服务）：Footer 全站一行 + 结账区警示复用
  projectNote:
    'A student hackathon project — a design showcase, not a commercial store. Availability and features are not guaranteed.',
  nav: [
    { label: 'Shop', href: '/shop' },
    { label: 'Collections', href: '/#collections' },
    { label: 'Our Story', href: '/#story' },
  ],
  hero: {
    kicker: 'A new kind of footwear',
    title: 'Casual shoes, printed to order in your size.',
    cta: 'Shop the collection',
  },
}
