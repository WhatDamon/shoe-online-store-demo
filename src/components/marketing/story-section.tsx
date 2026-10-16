import type { Locale } from '@/i18n/locales'
import { messages, type Messages } from '@/i18n/messages'

const storyPoints = [
  {
    term: 'marketing.story.mmFit.term',
    detail: 'marketing.story.mmFit.detail',
  },
  {
    term: 'marketing.story.zoneCushioning.term',
    detail: 'marketing.story.zoneCushioning.detail',
  },
  {
    term: 'marketing.story.madeToOrder.term',
    detail: 'marketing.story.madeToOrder.detail',
  },
] as const satisfies readonly { term: keyof Messages; detail: keyof Messages }[]

export function StorySection({ locale }: { locale: Locale }) {
  const t = messages(locale)

  return (
    <section id="story" aria-labelledby="story-heading" className="bg-surface">
      <div className="mx-auto w-full max-w-6xl px-4 py-20 md:py-28">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand">
            {t['marketing.story.kicker']}
          </p>
          <h2
            id="story-heading"
            className="mt-3 font-heading text-3xl font-semibold tracking-tight text-ink sm:text-4xl"
          >
            {t['marketing.story.title']}
          </h2>
          <p className="mt-6 text-[15px] leading-7 text-neutral-600">{t['marketing.story.fit']}</p>
          <p className="mt-4 text-[15px] leading-7 text-neutral-600">
            {t['marketing.story.cushioning']}
          </p>
          {/* 项目起源：黑客松起步 → 独立项目（真实叙事，非营销承诺）；尾句为轻量诚实注脚 */}
          <p className="mt-6 text-sm leading-6 text-neutral-500">{t['marketing.story.origin']}</p>
          <dl className="mt-10 grid gap-8 text-left sm:grid-cols-3 sm:gap-6">
            {storyPoints.map((point) => (
              <div key={point.term}>
                <dt className="font-heading text-[15px] font-semibold text-ink">{t[point.term]}</dt>
                <dd className="mt-1.5 text-sm leading-relaxed text-neutral-600">
                  {t[point.detail]}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  )
}
