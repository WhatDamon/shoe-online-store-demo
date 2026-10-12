import { ImageResponse } from 'next/og'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales'
import { messages } from '@/i18n/messages'
import { site } from '@/lib/site'

// 本地生成的极简 OG 图（OG 不依赖外部图/字体，离线一致）。
// route handler（node runtime 默认）：GET /og?locale=en → 1200×630 PNG。
//
// `/og` 被 proxy 排除在 locale 协商之外（它不是页面，也不带前缀），所以 `?locale=`
// 必须在这里自行校验：非法/缺失一律落 DEFAULT_LOCALE，不把客户端可控输入当可信。
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get('locale')
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE
  const t = messages(locale)

  // 词典值里的 `\n` 是**排版换行**（译者决定断行位置），不是句子边界。
  // 还原成 `<br/>` 后与改造前的 JSX 逐像素相同（已实测渲染哈希一致）；
  // 只有一种语言时不会出现多余空行。
  const lines = t['og.title'].split('\n')

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: '#fafaf8',
        color: '#111',
        padding: '84px 96px',
      }}
    >
      <div
        style={{
          display: 'flex',
          fontSize: 34,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: '#0f766e',
          fontWeight: 600,
        }}
      >
        {site.name}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        <div
          style={{
            display: 'flex',
            width: 96,
            height: 8,
            background: '#0f766e',
          }}
        />
        <div
          style={{
            display: 'flex',
            fontSize: 84,
            lineHeight: 1.05,
            fontWeight: 600,
          }}
        >
          {lines.flatMap((line, index) => (index === 0 ? [line] : [<br key={index} />, line]))}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          fontSize: 26,
          color: '#57534e',
          maxWidth: 1000,
          flexWrap: 'wrap',
        }}
      >
        {site.tagline}
      </div>
    </div>,
    // 语言信号落在响应头：`ImageResponse` 没有 `inLanguage` 字段（裁决 R26），
    // JSON-LD 才承载 inLanguage（见 src/lib/structured-data.ts）。
    { width: 1200, height: 630, headers: { 'Content-Language': locale } },
  )
}
