import { envInt } from '@/config'
import { createBoundedStore, validGuardrailKey } from './bounded-store'

export interface SessionMessage {
  role: 'user' | 'assistant'
  content: string
}

/** 每会话最大回合数（调用时读 env，见 config）。 */
export const maxTurns = () => envInt('AI_MAX_TURNS', 20)
export const HISTORY_TURNS = 6
export const SESSION_TTL_MS = 30 * 60_000
export const MAX_SESSIONS = 1_000
export const MAX_HISTORY_MESSAGE_CHARS = 4_000

export function createSessionStore(now = Date.now, options: { maxEntries?: number } = {}) {
  const m = createBoundedStore<{ turns: number; history: SessionMessage[] }>({
    ttlMs: SESSION_TTL_MS,
    maxEntries: options.maxEntries ?? MAX_SESSIONS,
    now,
  })
  return {
    claim(sessionKey: string, nowMs = now()): { allowed: boolean; history: SessionMessage[] } {
      if (!validGuardrailKey(sessionKey)) return { allowed: false, history: [] }
      const cur = m.get(sessionKey, nowMs) ?? { turns: 0, history: [] }
      const allowed = cur.turns < maxTurns()
      if (allowed) {
        cur.turns += 1
        if (!m.set(sessionKey, cur, nowMs)) return { allowed: false, history: [] }
      }
      return { allowed, history: cur.history.map((message) => ({ ...message })) }
    },
    push(sessionKey: string, role: SessionMessage['role'], content: string) {
      const s = m.get(sessionKey)
      if (s) {
        s.history.push({ role, content: content.slice(0, MAX_HISTORY_MESSAGE_CHARS) })
        s.history.splice(0, Math.max(0, s.history.length - HISTORY_TURNS * 2))
      }
    },
    size: m.size,
    dispose: m.dispose,
  }
}
