import type { createRepository } from '@/server/search/repository'
import { tokenBucket } from './rate-limit'
import { createSessionStore, type SessionMessage } from './session-state'
import { underDailyBudget, today } from './budget'

/** IP/会话双维内存令牌桶限流速率（规格 §8.5.2：默认 10 次/分）。 */
export const RATE_PER_MIN = 10
/** 护栏温和文案（规格 §8.5.6 / P7：消费端措辞，绝不暴露 "rate limited"）。 */
export const GUARDRAIL_MESSAGE = 'The assistant is taking a short break — try again in a moment.'

export class GuardrailError extends Error {
  constructor(
    public code: 'rate_limited' | 'budget' | 'turns',
    message: string,
  ) {
    super(message)
    this.name = 'GuardrailError'
  }
}

/**
 * 组装护栏决策。注意：内存令牌桶与会话计数都存活在实例内，
 * 必须单例复用（chat 模块级一次 createGuardrails(repo)），跨请求共享才有意义。
 */
export function createGuardrails(
  repo: ReturnType<typeof createRepository>,
  options?: { now?: () => number }, // 可注入时钟：测试用假时钟驱动超回合/限流边界，不碰真实时间
) {
  const nowMs = () => options?.now?.() ?? Date.now()
  const sessions = createSessionStore(nowMs)
  const ipBuckets = tokenBucket(RATE_PER_MIN)
  const sessionBuckets = tokenBucket(RATE_PER_MIN)

  const deny = (code: GuardrailError['code']): never => {
    throw new GuardrailError(code, GUARDRAIL_MESSAGE)
  }

  return {
    /** 领取一个回合；超限抛 code='turns'，否则返回裁剪后的会话历史供上下文注入。 */
    assertTurn(sessionKey: string): SessionMessage[] {
      const { allowed, history } = sessions.claim(sessionKey, nowMs())
      if (!allowed) deny('turns')
      return history
    },
    /** 回合结束后把 user/assistant 全文写回同一会话存储。 */
    pushTurn(sessionKey: string, role: SessionMessage['role'], content: string) {
      sessions.push(sessionKey, role, content)
    },
    /** IP+session 双维令牌桶；任一维度超限抛 code='rate_limited'。 */
    assertRate(ip: string, sessionKey: string): void {
      const ipOk = ipBuckets.allow(`ip:${ip}`, nowMs())
      const sessionOk = sessionBuckets.allow(`session:${sessionKey}`, nowMs())
      if (!ipOk || !sessionOk) deny('rate_limited')
    },
    /** 当日用量达到 AI_DAILY_TOKEN_CAP 后抛 code='budget'。 */
    async assertBudget(day = today()): Promise<void> {
      if (!(await underDailyBudget(repo, day))) deny('budget')
    },
    /** 估算 token 落库 ai_usage（匿名成本计量）。 */
    async noteUsage(u: Parameters<ReturnType<typeof createRepository>['insertUsage']>[0]): Promise<void> {
      await repo.insertUsage(u)
    },
  }
}

export type Guardrails = ReturnType<typeof createGuardrails>
