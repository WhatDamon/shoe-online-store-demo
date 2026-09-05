const promises = [
  {
    // 决策 #20：定制按单打印不可退，故首页不再承诺免费退货；
    // 改为「按脚长（mm）选码」的预防性合脚承诺（与 PDP 尺码表/Story 的 mm-fit 叙事一致）。
    title: 'Sized to you',
    copy: 'Find your pair by foot length — sizing is anchored in millimetres and checked before it prints.',
  },
  {
    title: 'Printed to order',
    copy: 'Your size is made when you order it, not mass-produced ahead of demand.',
  },
  {
    title: 'Carbon-neutral prints',
    copy: 'Every print run is offset, so the footprint stays light.',
  },
]

export function PromiseStrip() {
  return (
    <section aria-label="Why Evoloop" className="bg-canvas">
      {/* 视觉隐藏的 section 标题：给三个卖点 h3 一个 h2 祖先，避免 h1 → h3 跳级（WCAG 1.3.1）。 */}
      <h2 className="sr-only">Why Evoloop</h2>
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-16 sm:grid-cols-3 md:py-20">
        {promises.map((item) => (
          <div key={item.title} className="flex flex-col gap-2">
            <h3 className="font-heading text-lg font-semibold text-ink">{item.title}</h3>
            <p className="text-sm leading-relaxed text-neutral-600">{item.copy}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
