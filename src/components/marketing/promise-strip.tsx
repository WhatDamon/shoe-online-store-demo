const promises = [
  {
    title: 'Free returns',
    copy: 'Try them for 30 days. If the fit is not right, send them back on us.',
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
    <section aria-label="Why Treadwell" className="bg-canvas">
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
