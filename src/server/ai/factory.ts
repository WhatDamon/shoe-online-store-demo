// AI provider 工厂（无 key = Mock；有 key = OpenAICompat；AI_DISABLE_REAL 强制 Mock）。
//
// 工厂与接口分开（provider.ts 只有类型）是为了让依赖方向单向：
// factory → {openai-compat, mock} → provider(接口)。把工厂放回 provider.ts 会立刻形成
// provider ⇄ 实现的 import 环（实现需要接口，接口需要实现）。
import { envFlag, envStr } from '@/config'
import { MockProvider } from './mock'
import { aiModelName, OpenAICompatProvider } from './openai-compat'
import type { AiProvider } from './provider'

/** 是否命中真实 provider（与 aiProvider() 同一判定，按调用时 env 决策）。 */
const realEnabled = (): boolean => Boolean(envStr('AI_API_KEY')) && !envFlag('AI_DISABLE_REAL')

export const aiProvider = (): AiProvider =>
  realEnabled() ? new OpenAICompatProvider() : new MockProvider()

// 实际生效的模型（规格：记账与流式必须同源）：Mock → 'mock'；真实 → 与流式调用同一个 aiModelName()。
export const aiModel = (): string => (realEnabled() ? aiModelName() : 'mock')
