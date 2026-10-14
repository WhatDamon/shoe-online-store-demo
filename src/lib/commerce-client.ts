import { DEFAULT_LOCALE, type Locale } from '@/i18n/locales'
import { messages, type Messages } from '@/i18n/messages'

/**
 * 后端错误码 —— 跨语言机器契约，与 `backend/app/application/errors.py` 的 `CommerceError.code`
 * 同形（snake_case）。错误码**不改名、不扁平化**：它们是后端与前端之间唯一稳定的接口，
 * Python 侧不需要知道语言。`backend_unavailable` 不由后端产出，而是 Route Handler 生成的
 * （见 `src/app/api/commerce/[...path]/route.ts`）。
 *
 * **本联合只列「有专门用户文案」的码，不是后端码的全集。** 后端另有 `product_not_found` /
 * `variant_not_found` / `quantity_limit`，Route Handler 另有 `invalid_origin`；它们抽取前就走
 * 通用兜底串，阶段 1「输出与改造前等价」不允许顺手给它们补一句新英文，阶段 2 维持（裁决 R30：
 * 本轮只覆盖既有的 5 个码，按语言取文案不改变它们的输出）。故不在此列（见
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
 * 发一个 commerce 代理请求，并把后端的**错误码**翻成当前界面语言的文案（`errors.*`）。
 *
 * 文案按 `locale` **现取**，不由本模块持有快照：本模块被 `'use client'` 组件导入，**不得**要求挂
 * Provider 才能取值，所以语言由调用组件用 `useLocale()` 传进来（R43 的同一条口径：参数接上线
 * 才算完成）。`locale` 挂在既有的 options 包上，而不是另开一个「按码取文案」的导出函数——码 →
 * 文案的映射只该在**抛错这一处**发生；另开函数会逼着每个 `catch (e) { setError(e.message) }`
 * 的调用点自己再查一次码，多出来的接线只会漂移。位置也不变（`init` 仍是第 3 个参数），故既有
 * 调用点只多一个字段、测试一行不改。
 */
export async function commerceRequest<T>(
  path: string,
  parse: (value: unknown) => T,
  // `locale` 是本站的选项、**不是** fetch 的：解构出来只用于取文案，绝不会漏进 `fetch(path, init)`
  // （`commerce-client.test.ts` 断言了传给 fetch 的对象）。缺省默认语言——未挂 `LocaleProvider`
  // 的孤立渲染（含既有组件测试）与阶段 1 的文案因此逐字相同。
  { locale = DEFAULT_LOCALE, ...init }: RequestInit & { locale?: Locale } = {},
): Promise<T> {
  const t = messages(locale)
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
