const storyPoints = [
  {
    term: 'Millimetre fit',
    detail: 'One sizing standard across every market — no more mystery sizing.',
  },
  {
    term: 'Zone-tuned cushioning',
    detail: 'Softer landings where you strike, firmer support where you push off.',
  },
  {
    term: 'Made to order',
    detail: 'Each pair is printed when you order, so nothing sits in a warehouse.',
  },
]

export function StorySection() {
  return (
    <section id="story" aria-labelledby="story-heading" className="bg-surface">
      <div className="mx-auto w-full max-w-6xl px-4 py-20 md:py-28">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand">
            Comfort, measured
          </p>
          <h2
            id="story-heading"
            className="mt-3 font-heading text-3xl font-semibold tracking-tight text-ink sm:text-4xl"
          >
            Sized in millimetres. Built for how you actually walk.
          </h2>
          <p className="mt-6 text-[15px] leading-7 text-neutral-600">
            Most shoes start with a number. Ours start with your foot — its length in millimetres —
            and build from there, so the fit is precise before the first step.
          </p>
          <p className="mt-4 text-[15px] leading-7 text-neutral-600">
            Cushioning is tuned where your foot needs it most: softer under the heel, more
            responsive under the ball of the foot. No guesswork, no long break-in.
          </p>
          {/* 项目起源：黑客松起步 → 独立项目（真实叙事，非营销承诺）；尾句为轻量诚实注脚 */}
          <p className="mt-6 text-sm leading-6 text-neutral-500">
            Evoloop began at a student hackathon — what started as a weekend idea has grown into an
            independent project we keep building. Orders aren&apos;t live yet: prices and checkout
            are demo for now.
          </p>
          <dl className="mt-10 grid gap-8 text-left sm:grid-cols-3 sm:gap-6">
            {storyPoints.map((point) => (
              <div key={point.term}>
                <dt className="font-heading text-[15px] font-semibold text-ink">{point.term}</dt>
                <dd className="mt-1.5 text-sm leading-relaxed text-neutral-600">{point.detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  )
}
