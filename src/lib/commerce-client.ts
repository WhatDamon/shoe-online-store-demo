import { DEFAULT_LOCALE } from '@/i18n/locales'
import { messages, type Messages } from '@/i18n/messages'

/**
 * 后端错误码 —— 跨语言机器契约，与 `backend/app/application/errors.py` 的 `CommerceError.code`
 * 同形（snake_case）。错误码**不改名、不扁平化**：它们是后端与前端之间唯一稳定的接口，
 * Python 侧不需要知道语言。`backend_unavailable` 不由后端产出，而是 Route Handler 生成的
 * （见 `src/app/api/commerce/[...path]/route.ts`）。
 *
 * **本联合只列「有专门用户文案」的码，不是后端码的全集。** 后端另有 `product_not_found` /
 * `variant_not_found` / `quantity_limit`，Route Handler 另有 `invalid_origin`；它们抽取前就走
 * 通用兜底串，阶段 1「输出与改造前等价」不允许顺手给它们补一句新英文，故不在此列（见
 * `commerce-client.test.ts` 的 `invalid_origin` 用例与 task-8 报告的移交项）。未列出的码
 * 照旧落到 `errors.unknown`，不会渲染 `undefined`。
 */
type ErrorCode =
  | 'variant_unavailable'
  | 'insufficient_stock'
  | 'empty_cart'
  | 'order_not_found'
  | 'backend_unavailable'

/**
 * 错误码 → 词典键（`errors.*`）。**逐条显式列出，不做字符串变换**（如 `code.replace(/_\w/g…)`）：
 * `as const satisfies Record<ErrorCode, keyof Messages>` 让「往**本联合**加码而映射或词典没跟上」
 * 变成编译错误，而不是运行时静默查不到键、把 `undefined` 渲染到界面上。注意它保证不了
 * 「后端加了码而这里忘了加进联合」——联合是手写的，与 Python 常量表没有机械绑定（见报告移交项）。
 * 键的叶子用错误码的驼峰形——词典键的叶子不允许下划线（`src/i18n/messages.test.ts` 的键名守卫）。
 */
const ERROR_KEYS = {
  variant_unavailable: 'errors.variantUnavailable',
  insufficient_stock: 'errors.insufficientStock',
  empty_cart: 'errors.emptyCart',
  order_not_found: 'errors.orderNotFound',
  backend_unavailable: 'errors.backendUnavailable',
} as const satisfies Record<ErrorCode, keyof Messages>

/** 响应里的 `code` / `detail` 是字符串（客户端可控），故必须先收窄成已知错误码。 */
function isErrorCode(code: string): code is ErrorCode {
  return Object.hasOwn(ERROR_KEYS, code)
}

/**
 * 文案取自词典（`errors.*`）。本模块被 `'use client'` 组件导入，**不得**要求挂 Provider 才能
 * 取值——故这里按默认语言取一次。阶段 1 只有 `en`（`LOCALES = ['en']`），取值与抽取前逐字相同；
 * 阶段 2 要按 URL 语言取时，把语言从调用方（客户端组件能拿到 `useLocale()`）传进来。
 */
const t = messages(DEFAULT_LOCALE)

export async function commerceRequest<T>(
  path: string,
  parse: (value: unknown) => T,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`/api/commerce/${path}`, {
    ...init,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  const invalidResponse = t['errors.invalidResponse']
  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new Error(invalidResponse)
  }
  if (!response.ok) {
    let code = ''
    if (data !== null && typeof data === 'object') {
      if ('code' in data && typeof data.code === 'string') code = data.code
      else if ('detail' in data && typeof data.detail === 'string') code = data.detail
    }
    throw new Error(isErrorCode(code) ? t[ERROR_KEYS[code]] : t['errors.unknown'])
  }
  try {
    return parse(data)
  } catch {
    throw new Error(invalidResponse)
  }
}
