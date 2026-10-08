import { homepageFaq } from '@/lib/faq'

export function FaqSection() {
  return (
    <section aria-labelledby="faq-heading" className="bg-canvas">
      <div className="mx-auto w-full max-w-3xl px-4 py-20 md:py-24">
        <p className="text-center text-xs font-medium uppercase tracking-[0.18em] text-brand">
          Quick answers
        </p>
        <h2
          id="faq-heading"
          className="mt-3 text-center font-heading text-3xl font-semibold tracking-tight text-ink sm:text-4xl"
        >
          Questions, answered plainly.
        </h2>
        <div className="mt-10 divide-y divide-neutral-200 border-y border-neutral-200">
          {homepageFaq.map((item) => (
            <details key={item.question} className="group py-5">
              <summary className="cursor-pointer list-none pr-8 font-heading text-lg font-semibold text-ink marker:hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-neutral-400">
                <span className="relative after:absolute after:right-0 after:top-1/2 after:-translate-y-1/2 after:text-2xl after:font-normal after:text-neutral-400 after:content-['+'] group-open:after:content-['−']">
                  {item.question}
                </span>
              </summary>
              <p className="mt-3 max-w-2xl pr-8 text-[15px] leading-7 text-neutral-600">
                {item.answer}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
