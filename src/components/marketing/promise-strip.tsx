import { DEFAULT_LOCALE, type Locale } from '@/i18n/locales'
import { messages, type Messages } from '@/i18n/messages'

const promises = [
  {
    // 定制按单打印不可退，故首页不再承诺免费退货；
    // 改为「按脚长（mm）选码」的预防性合脚承诺（与 PDP 尺码表/Story 的 mm-fit 叙事一致）。
    title: 'marketing.promise.fit.title',
    copy: 'marketing.promise.fit.copy',
  },
  {
    title: 'marketing.promise.madeToOrder.title',
    copy: 'marketing.promise.madeToOrder.copy',
  },
  {
    title: 'marketing.promise.carbon.title',
    copy: 'marketing.promise.carbon.copy',
  },
] as const satisfies readonly { title: keyof Messages; copy: keyof Messages }[]

/**
 * `locale` 可选并缺省为默认语言：本组件是服务端组件（拿不到 Provider），而 a11y 门禁
 * 直接合成渲染 `<PromiseStrip />`（`src/test/a11y/axe-gate.test.tsx`）——`locale` 必填会让
 * 那个结构性扫描无法渲染。缺省策略与 `LocaleProvider` 一致（裁决 R4）：未收到语言时按默认
 * 语言渲染，而不是抛错。生产里的渲染点（landing page）总是显式传入 URL 语言。
 */
export function PromiseStrip({ locale = DEFAULT_LOCALE }: { locale?: Locale }) {
  const t = messages(locale)

  return (
    <section aria-label={t['marketing.promise.label']} className="bg-canvas">
      {/* 视觉隐藏的 section 标题：给三个卖点 h3 一个 h2 祖先，避免 h1 → h3 跳级（WCAG 1.3.1）。 */}
      <h2 className="sr-only">{t['marketing.promise.label']}</h2>
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-16 sm:grid-cols-3 md:py-20">
        {promises.map((item) => (
          <div key={item.title} className="flex flex-col gap-2">
            <h3 className="font-heading text-lg font-semibold text-ink">{t[item.title]}</h3>
            <p className="text-sm leading-relaxed text-neutral-600">{t[item.copy]}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
