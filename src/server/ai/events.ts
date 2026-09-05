// AI 事件行 = SSE `data:` 帧内 JSON（规格 §8.4）。chat() 产出，客户端 parseEvent 消费。
// 本模块必须保持客户端可导入：只含类型与纯函数，禁止引入任何 server-only 依赖
// （消费方：'use client' 的 use-chat-stream 在客户端 import 本模块）。
import type { CanonicalSize } from '@/server/catalog/types'

// 商品结果卡事件：只携带展示所需真实字段（规格 §8.4）——不携带价格（价格只存在
// 详情页/店舖，AI 不传播 demo 价段；决策：AI 彻底不带价）。
// image = 真实首图（public/products/...）否则 null（SVG 兜底），其余为真实元数据。
export type ProductCard = {
  handle: string
  title: string
  /** 货号/子标题（真实原始数据，如 DC-1001）。 */
  subtitle: string
  image: string | null
  imageKind: 'photo' | 'svg'
  /** 该款照片张数（真实）。 */
  photoCount: number
  /** 可售码段的市场显示区间（如 “US 4.5–9.5”）；暂无尺码 → null。 */
  sizeRange: string | null
  /** 色卡数（真实）。 */
  colorCount: number
  /** SVG 兜底/无图时才需要（真实色卡 hex）。 */
  palette: [string, string]
}

/** 助手四模式（消费端措辞 ↔ 内部模式，规格 §8.2）。 */
export type Mode = 'shopping' | 'size-fit' | 'outfit' | 'find-shoes'

// error code：护栏三类（rate_limited/budget/turns，文案一律温和消费者措辞）
// + provider（真实调用失败，P3 不静默降级）+ invalid（请求本身不可处理）。
// 'turns' 由 GuardrailError code 1:1 透传，已含在本 union。
export type ChatErrorCode = 'rate_limited' | 'budget' | 'turns' | 'provider' | 'invalid'

export type ChatEvent =
  | { type: 'delta'; text: string }
  | { type: 'productCards'; items: ProductCard[] }
  | {
      type: 'sizeFit'
      recommended: CanonicalSize
      alternatives: CanonicalSize[]
      rationale: string
    }
  | { type: 'done' }
  | { type: 'error'; code: ChatErrorCode; message: string }

/** 单条 SSE 帧。 */
export const encodeEvent = (e: ChatEvent): string => `data: ${JSON.stringify(e)}\n\n`

const ERROR_CODES: readonly ChatErrorCode[] = [
  'rate_limited',
  'budget',
  'turns',
  'provider',
  'invalid',
]

/** 解析单条 `data:` 帧；形状不合法返回 null（防垃圾帧/半帧进入 UI 状态）。 */
export function parseEvent(frame: string): ChatEvent | null {
  const trimmed = frame.trim()
  if (!trimmed.startsWith('data:')) return null
  let raw: unknown
  try {
    raw = JSON.parse(trimmed.slice('data:'.length).trim())
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  switch (r.type) {
    case 'delta':
      return typeof r.text === 'string' ? { type: 'delta', text: r.text } : null
    case 'productCards':
      return Array.isArray(r.items)
        ? { type: 'productCards', items: r.items as ProductCard[] }
        : null
    case 'sizeFit':
      return typeof r.recommended === 'number' &&
        Array.isArray(r.alternatives) &&
        typeof r.rationale === 'string'
        ? {
            type: 'sizeFit',
            recommended: r.recommended as CanonicalSize,
            alternatives: r.alternatives as CanonicalSize[],
            rationale: r.rationale,
          }
        : null
    case 'done':
      return { type: 'done' }
    case 'error':
      return typeof r.message === 'string' &&
        typeof r.code === 'string' &&
        (ERROR_CODES as readonly string[]).includes(r.code)
        ? { type: 'error', code: r.code as ChatErrorCode, message: r.message }
        : null
    default:
      return null
  }
}

/** size-fit 确定性结果 → 结构化事件（recommended 必为表内 in-stock canonical）。 */
export const createSizeFitEvent = (a: {
  recommended: CanonicalSize
  alternatives: CanonicalSize[]
  rationale: string
}): ChatEvent => ({ type: 'sizeFit', ...a })
