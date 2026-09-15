import { envInt } from '@/config'

export interface SessionMessage {
  role: 'user' | 'assistant'
  content: string
}

/** 每会话最大回合数（调用时读 env，见 config）。 */
export const maxTurns = () => envInt('AI_MAX_TURNS', 20)
export const HISTORY_TURNS = 6
export const SESSION_TTL_MS = 30 * 60_000

export function createSessionStore(now = Date.now) {
  const m = new Map<string, { turns: number; history: SessionMessage[]; at: number }>()
  return {
    claim(sessionKey: string, nowMs = now()): { allowed: boolean; history: SessionMessage[] } {
      const s = m.get(sessionKey)
      const cur = s && nowMs - s.at < SESSION_TTL_MS ? s : { turns: 0, history: [], at: nowMs }
      const allowed = cur.turns < maxTurns()
      if (allowed) {
        cur.turns += 1
        cur.at = nowMs
      }
      m.set(sessionKey, cur)
      return { allowed, history: cur.history.slice(-HISTORY_TURNS * 2) }
    },
    push(sessionKey: string, role: SessionMessage['role'], content: string) {
      const s = m.get(sessionKey)
      if (s) s.history.push({ role, content })
    },
    size: () => m.size,
  }
}
