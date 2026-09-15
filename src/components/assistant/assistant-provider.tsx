'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { ReactNode } from 'react'
import type { Mode } from '@/domain/chat-events'
import { speak } from '@/lib/speak-preference'
import { readAloud, stopSpeaking, toSpeechText } from '@/lib/speech'
import { mySize } from '@/lib/my-size'
import { useChatStream } from './use-chat-stream'
import { AssistantFabSlot } from './fab'
import { AssistantPanel } from './assistant-panel'
import {
  INITIAL_SESSION,
  modeForSend,
  needsProduct,
  productRefOf,
  sessionReducer,
  sizeFitSettled,
  type SessionProduct,
} from './session'

/** 导购控制器：PDP 的 "Find my size"、FAB 锚定等消费方调用的契约。
 * product 可为完整 ProductView（页面内入口）或轻引用 {handle,title}（FAB 页面锚点）：
 * 服务端均按 handle 回取全量事实，UI 侧只用 handle/title（面板对缺失 sizeOptions 有兜底）。 */
export interface AssistantHandle {
  /** 打开面板并设置模式（size-fit 带商品 → 预置上下文并自动询问尺码）。 */
  open: (mode: Mode, product?: SessionProduct) => void
  close: () => void
}

// 根 layout 挂载一次；FAB + Sheet 面板随 Provider 渲染（落地页 FAB 自隐；
// FAB 以受控注入方式拿到 open/close，避免 provider↔fab 循环导入）。
// 会话状态存于 provider（仅客户端，页面刷新即重置——仅当次记忆）。
const AssistantContext = createContext<AssistantHandle | null>(null)

export function AssistantProvider({ children }: { children: ReactNode }) {
  const { messages, isStreaming, send, retry } = useChatStream()
  const [isOpen, setIsOpen] = useState(false)
  const [session, dispatch] = useReducer(sessionReducer, INITIAL_SESSION)
  const { mode, product } = session

  // 朗读偏好：外部 store（SSR 首帧常量 false → 无 hydration mismatch）。
  const speakOn = useSyncExternalStore(speak.subscribe, speak.getSnapshot, speak.getServerSnapshot)
  // 已朗读/已略过的最后一条助手消息 id：同一回复只在完成瞬间朗读一次
  // （开关开启时已完成的历史回复不补读）。
  const lastSpokenIdRef = useRef<string | null>(null)

  // 触发朗读：观察到「新完成的助手回复」（无 error、有正文）且开关开 → 整段朗读。
  // 纯副作用（readAloud/写 ref），非 setState，符合 react-hooks 规则。
  useEffect(() => {
    let last: (typeof messages)[number] | null = null
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role !== 'assistant') continue
      last = m
      break
    }
    if (!last || last.streaming || last.error) return
    // 先记录 id 再决定是否读：开关关闭期间完成的回复被标记为已读 → 之后
    // 打开开关也不补读；开关开着时到达的完成回复才会走到朗读。
    if (last.id === lastSpokenIdRef.current) return
    lastSpokenIdRef.current = last.id
    if (!speakOn) return
    const text = toSpeechText(last.content)
    if (text) readAloud(text)
  }, [messages, speakOn])

  const close = useCallback(() => {
    stopSpeaking() // 人已离开面板：不再空放
    setIsOpen(false)
  }, [])

  const handleChip = useCallback(
    (chipMode: Mode, label: string) => {
      stopSpeaking() // 新回合开始：停掉上一回复的朗读
      dispatch({ type: 'pick', mode: chipMode })
      // size-fit 芯片（Find my size）也带已知脚长：文本不含显式尺码时服务端回退预填。
      const footMm = chipMode === 'size-fit' ? mySize.getSnapshot() : null
      send(chipMode, label, needsProduct(chipMode) ? productRefOf(product) : null, footMm)
    },
    [product, send],
  )

  const open = useCallback(
    (nextMode: Mode, nextProduct?: SessionProduct) => {
      const p = nextProduct ?? null
      dispatch({ type: 'open', mode: nextMode, product: p })
      setIsOpen(true)
      // PDP "Find my size"：商品上下文齐备时直接开场问尺码（消费端自然流），
      // 由服务端 size-fit 确定性核心应答（askedForInput → 追问）。
      if (nextMode === 'size-fit' && p) {
        stopSpeaking() // 自动开场即新回合
        // 已知「我的尺码」（脚长 mm）时一并带去：size-fit 确定性核心文本无码则回退用之，
        // 直接给出推荐而非追问「您穿什么码」（Find my size 预填）。
        send('size-fit', '', productRefOf(p), mySize.getSnapshot())
      }
    },
    [send],
  )

  const handleSend = useCallback(
    (text: string) => {
      stopSpeaking() // 新回合开始：停掉上一回复的朗读
      // 结算状态在发送这一刻现算：原先是 useMemo 存起来，每条消息变化都重算一次。
      const nextMode = modeForSend(session, sizeFitSettled(messages))
      if (nextMode !== mode) dispatch({ type: 'sent', mode: nextMode })
      // size-fit 自由输入已带显式文本；文本无码时仍以已知脚长为回退（服务端语义）。
      const footMm = nextMode === 'size-fit' ? mySize.getSnapshot() : null
      send(nextMode, text, productRefOf(product), footMm)
    },
    [session, mode, product, messages, send],
  )

  const handleToggleSpeak = useCallback((next: boolean) => {
    if (!next) stopSpeaking() // 关开关即静音
    speak.set(next)
  }, [])

  const value = useMemo<AssistantHandle>(() => ({ open, close }), [open, close])

  return (
    <AssistantContext.Provider value={value}>
      {children}
      <AssistantFabSlot assistant={value} />
      <AssistantPanel
        isOpen={isOpen}
        onClose={close}
        product={product}
        onRemoveProduct={() => dispatch({ type: 'clear-product' })}
        onSend={handleSend}
        onPick={handleChip}
        onRetry={retry}
        messages={messages}
        isStreaming={isStreaming}
        speakOn={speakOn}
        onToggleSpeak={handleToggleSpeak}
      />
    </AssistantContext.Provider>
  )
}

export function useAssistant(): AssistantHandle | null {
  return useContext(AssistantContext)
}
