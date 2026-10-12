/**
 * 词典访问器。与 `./locales` 一样必须保持纯：服务端产出的消费端文案与客户端组件
 * 都要能导入同一份词典，因此不导入 React、不导入 `src/server/**`、不做 IO。
 *
 * 键集单源在 `./dictionaries/en`：`Messages` 就是它的键集，`messages('en')[key]` 的
 * 键名写错即编译错误，新加的键也立刻对所有调用点可见。
 */
import en from './dictionaries/en'
import { type Locale } from './locales'

export { en }

export type Messages = Record<keyof typeof en, string>

/**
 * locale → 词典。刻意不写 `default:` 分支：`LOCALES` 增加语言而词典缺失时必须是
 * 编译错误，而不是静默回退英文（那会产出「假翻译」）。
 */
const DICTIONARIES: Record<Locale, Messages> = { en }

export function messages(locale: Locale): Messages {
  return DICTIONARIES[locale]
}
