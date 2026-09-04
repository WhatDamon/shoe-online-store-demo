import type { ReactElement } from 'react'
import type { Product } from '@/server/catalog/types'

// 参数化 inline-SVG 商品视觉（规格 §6 决策 #11：本地程序化 SVG，无图片文件/零网络请求）。
// 纯展示、确定性输出（无随机、无 date），3 个 view 各自结构不同。

export type ProductVisualView = 'side' | 'sole' | 'detail'

export interface ProductVisualProps {
  // 接受 Product['visual']（严格 tuple）与简报 fixture 的字面量拓宽形状；仅消费 palette[0]/palette[1]/accent
  visual: { palette: readonly string[]; accent: string; views: number }
  name: string
  view?: ProductVisualView
  className?: string
  construction?: Product['construction']
  /** 实例盐：同一 DOM 内出现多份相同输入的实例（如 PDP 主图 + 同 view 缩略图）时消除重复 pattern id。 */
  idSalt?: string
}

const VIEW_BOX: Record<ProductVisualView, string> = {
  side: '0 0 240 150',
  sole: '0 0 240 150',
  detail: '0 0 160 160',
}

function hashSeed(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return 'pv' + (h >>> 0).toString(36)
}

// density: 0.6 | 0.75 | 0.9 → 越密格子越小（0.75/density 缩放，恒定于 0.75 时 1:1）
function cellSize(base: number, density: number, view: ProductVisualView): number {
  const scale = view === 'detail' ? 1.9 : view === 'sole' ? 1.15 : 1
  const s = Math.round((base * scale * 0.75) / density)
  return Math.min(48, Math.max(5, s))
}

function hexPath(cx: number, cy: number, r: number): string {
  // 尖顶正六边形（顶点朝上）：顶点在 -90°, -30°, 30°, 90°, 150°, 210°
  const pts: string[] = []
  for (let k = 0; k < 6; k++) {
    const deg = -90 + k * 60
    const rad = (deg * Math.PI) / 180
    pts.push(`${(cx + r * Math.cos(rad)).toFixed(2)},${(cy + r * Math.sin(rad)).toFixed(2)}`)
  }
  return `M${pts.join('L')}Z`
}

function buildPattern(
  id: string,
  pattern: Product['construction']['pattern'],
  palette: readonly string[],
  accent: string,
  S: number,
): ReactElement {
  if (pattern === 'honeycomb') {
    // 真蜂窝（正六边形密铺，尖顶朝上下）：同行中心距 √3R（对边宽），行距 1.5R 且隔行错开 √3R/2，
    // 任意相邻两中心距离均为 √3R（六邻居）。矩形重复单元宽 colX=√3R、高 2·rowY=3R，含 5 个中心：
    // 上/下边界行 y=0/3R 各 2 个（x=0 与 x=colX，与相邻单元共享——SVG pattern 按单元裁剪，
    // 每个单元只画落在自己范围内的部分，跨边界的正六边形由两侧单元各自补齐一半）；
    // 中行 y=1.5R 的 1 个（x=colX/2，恰好完整落在单元内）。
    const R = S / (2 * Math.sqrt(3))
    const colX = Math.sqrt(3) * R
    const rowY = 1.5 * R
    const hexes = [
      [0, 0],
      [colX, 0],
      [colX / 2, rowY],
      [0, rowY * 2],
      [colX, rowY * 2],
    ]
    return (
      <pattern id={id} width={colX} height={rowY * 2} patternUnits="userSpaceOnUse">
        {hexes.map(([cx, cy], i) => (
          <path
            key={i}
            d={hexPath(cx, cy, R)}
            fill="none"
            stroke={palette[1]}
            strokeWidth={0.6}
            opacity={0.9}
          />
        ))}
      </pattern>
    )
  }
  if (pattern === 'wave') {
    // 双排余弦波：两条相位相反的横向波纹叠加
    const a = S * 0.2
    const y = (offset: number) => S * 0.62 + offset
    const wave = (y0: number, flip: boolean) =>
      flip
        ? `M0 ${y0 + a} Q ${S / 4} ${y0 - a} ${S / 2} ${y0 + a} T ${S} ${y0 + a}`
        : `M0 ${y0 - a} Q ${S / 4} ${y0 + a} ${S / 2} ${y0 - a} T ${S} ${y0 - a}`
    return (
      <pattern id={id} width={S} height={S} patternUnits="userSpaceOnUse">
        <path
          d={wave(y(0), false)}
          fill="none"
          stroke={palette[1]}
          strokeWidth={0.7}
          opacity={0.85}
        />
        <path
          d={wave(y(-S / 2), true)}
          fill="none"
          stroke={accent}
          strokeWidth={0.5}
          opacity={0.55}
        />
      </pattern>
    )
  }
  // lattice：双向对角线交织成菱格网 + accent 网点
  return (
    <pattern id={id} width={S} height={S} patternUnits="userSpaceOnUse">
      <line x1={S} y1={0} x2={0} y2={S} stroke={palette[1]} strokeWidth={0.7} opacity={0.9} />
      <line x1={0} y1={0} x2={S} y2={S} stroke={palette[1]} strokeWidth={0.7} opacity={0.9} />
      <circle cx={0} cy={0} r={S * 0.08} fill={accent} opacity={0.85} />
    </pattern>
  )
}

const SIDE_UPPER =
  'M38 100 C34 78 44 58 62 50 C84 40 108 44 120 58 C130 70 148 78 168 82 C186 86 202 84 212 74 ' +
  'C220 66 224 56 224 48 C226 68 226 84 220 96 L214 100 L40 100 Z'

export function ProductVisual({
  visual,
  name,
  view = 'side',
  className,
  construction,
  idSalt,
}: ProductVisualProps) {
  const pattern = construction?.pattern ?? 'lattice'
  const density = construction?.density ?? 0.75
  const base = view === 'detail' ? 16 : 13
  const S = cellSize(base, density, view)
  const pid = hashSeed(
    `${idSalt ? `${idSalt}|` : ''}${name}|${view}|${pattern}|${density}|${visual.palette[0]}|${visual.palette[1]}|${visual.accent}`,
  )

  const patternFill = `url(#${pid})`

  return (
    <svg
      data-product-visual
      data-view={view}
      data-pattern={pattern}
      role="img"
      aria-label={`${name} — printed shoe`}
      viewBox={VIEW_BOX[view]}
      className={className}
      focusable={false}
    >
      <defs>{buildPattern(pid, pattern, visual.palette, visual.accent, S)}</defs>

      {view === 'side' && (
        <g>
          {/* 侧影鞋面：底色 + 打印纹理 */}
          <path d={SIDE_UPPER} fill={visual.palette[0]} />
          <path d={SIDE_UPPER} fill={patternFill} />
          {/* accent 中底垫层 */}
          <path
            d="M38 116 a14 14 0 0 1 14 -14 h146 a14 14 0 0 1 14 14 v8 a14 14 0 0 1 -14 14 h-146 a14 14 0 0 1 -14 -14 z"
            fill={visual.accent}
            opacity={0.9}
          />
          <path
            d="M38 116 a14 14 0 0 1 14 -14 h146 a14 14 0 0 1 14 14"
            fill="none"
            stroke={visual.palette[1]}
            strokeWidth={1.5}
          />
          {/* 极简鞋带线（accent） */}
          <path
            d="M66 66 C 100 78 140 82 178 80"
            fill="none"
            stroke={visual.accent}
            strokeWidth={3.5}
            strokeLinecap="round"
            opacity={0.85}
          />
          <path
            d="M78 44 a5 5 0 1 1 0.1 0"
            fill="none"
            stroke={visual.palette[1]}
            strokeWidth={1}
          />
        </g>
      )}

      {view === 'sole' && (
        <g>
          {/* 俯视底面轮廓（外扩曲线）+ 打印纹理 */}
          <path
            d="M118 26 C 62 26 36 50 36 76 C 36 104 72 126 124 126 C 178 126 210 108 210 82 C 210 58 190 46 172 42 C 158 39 152 26 118 26 Z"
            fill={visual.palette[0]}
          />
          <path
            d="M118 26 C 62 26 36 50 36 76 C 36 104 72 126 124 126 C 178 126 210 108 210 82 C 210 58 190 46 172 42 C 158 39 152 26 118 26 Z"
            fill={patternFill}
          />
          {/* accent 垫层：前掌 + 后跟 */}
          <ellipse cx={158} cy={82} rx={38} ry={28} fill={visual.accent} opacity={0.85} />
          <ellipse cx={84} cy={78} rx={30} ry={22} fill={visual.accent} opacity={0.6} />
          <ellipse
            cx={158}
            cy={82}
            rx={38}
            ry={28}
            fill="none"
            stroke={visual.palette[1]}
            strokeWidth={1.2}
            opacity={0.7}
          />
          <ellipse
            cx={84}
            cy={78}
            rx={30}
            ry={22}
            fill="none"
            stroke={visual.palette[1]}
            strokeWidth={1}
            opacity={0.6}
          />
        </g>
      )}

      {view === 'detail' && (
        <g>
          {/* 局部放大格纹（格子最大）+ 区域描边 */}
          <rect x={24} y={24} width={112} height={112} rx={14} fill={visual.palette[0]} />
          <rect x={24} y={24} width={112} height={112} rx={14} fill={patternFill} />
          <rect
            x={24}
            y={24}
            width={112}
            height={112}
            rx={14}
            fill="none"
            stroke={visual.palette[1]}
            strokeWidth={2}
          />
          <path
            d={SIDE_UPPER}
            fill="none"
            stroke={visual.accent}
            strokeWidth={1.4}
            opacity={0.3}
            transform="translate(-44 -26) scale(0.5)"
          />
        </g>
      )}
    </svg>
  )
}
