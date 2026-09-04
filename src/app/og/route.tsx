import { ImageResponse } from 'next/og'
import { site } from '@/lib/site'

// 本地生成的极简 OG 图（规格决策 #11：OG 不依赖外部图/字体，离线一致）。
// route handler（node runtime 默认）：GET /og → 1200×630 PNG。
export async function GET() {
  return new ImageResponse(
    (
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
          <div style={{ display: 'flex', width: 96, height: 8, background: '#0f766e' }} />
          <div style={{ display: 'flex', fontSize: 84, lineHeight: 1.05, fontWeight: 600 }}>
            Casual shoes, printed
            <br />
            to order in your size.
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
      </div>
    ),
    { width: 1200, height: 630 }
  )
}
