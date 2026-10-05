import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'

// 先用 NODE_ENV=production、AI_DISABLE_REAL=1 启动隔离本地服务。
// --check-turn-limit 只用于另一个 AI_MAX_TURNS=2 的全新实例。
const { values } = parseArgs({
  options: {
    'base-url': { type: 'string', default: 'http://127.0.0.1:3000' },
    'check-turn-limit': { type: 'boolean', default: false },
  },
})
const baseUrl = new URL(values['base-url'])
assert.ok(
  baseUrl.protocol === 'http:' &&
    ['127.0.0.1', '[::1]'].includes(baseUrl.hostname) &&
    !baseUrl.username &&
    !baseUrl.password &&
    baseUrl.pathname === '/' &&
    !baseUrl.search &&
    !baseUrl.hash,
  'smoke 只允许无凭据的 HTTP 回环服务地址',
)
const endpoint = new URL('/api/ai/chat', baseUrl)
const COOKIE_NAME = 'evoloop_ai_session'
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const requestIds = new Set()
let assertions = 1 // 包含入口回环地址断言。
let requests = 0

function check(condition, message) {
  // 只输出固定诊断文案，不让断言失败打印 Cookie 实际值。
  assert.ok(condition, message)
  assertions++
}

async function request(body, headers = {}) {
  requests++
  const response = await fetch(endpoint, {
    method: 'POST',
    signal: AbortSignal.timeout(25_000),
    redirect: 'error',
    headers: {
      'content-type': 'application/json',
      origin: baseUrl.origin,
      'x-request-id': 'client-request-id-must-not-be-trusted',
      ...headers,
    },
    body,
  })
  check(response.headers.get('cache-control') === 'no-store', '响应必须禁止缓存')
  const requestId = response.headers.get('x-request-id')
  check(UUID_V4.test(requestId ?? ''), '响应必须包含服务端 UUID v4 request ID')
  check(!requestIds.has(requestId), '每个响应的 request ID 必须独立')
  requestIds.add(requestId)
  return response
}

function readSession(response) {
  const cookies = response.headers
    .getSetCookie()
    .filter((value) => value.startsWith(`${COOKIE_NAME}=`))
  check(cookies.length === 1, '响应必须签发唯一 AI 会话 Cookie')
  const [cookie, ...attributes] = cookies[0].split(';').map((part) => part.trim())
  const value = cookie.slice(COOKIE_NAME.length + 1)
  const match = /^v1\.([0-9a-f-]{36})\.([1-9][0-9]{0,10})\.([0-9a-f]{64})$/.exec(value)
  check(Boolean(match) && UUID_V4.test(match[1]), 'Cookie 必须包含版本、UUID v4、过期时间和签名')
  const now = Math.floor(Date.now() / 1000)
  check(Number(match[2]) > now && Number(match[2]) <= now + 1800, '会话过期时间必须在 30 分钟以内')
  check(
    attributes.some((part) => /^httponly$/i.test(part)),
    'Cookie 必须为 HttpOnly',
  )
  check(
    attributes.some((part) => /^samesite=lax$/i.test(part)),
    'Cookie 必须为 SameSite=Lax',
  )
  check(
    attributes.some((part) => /^secure$/i.test(part)),
    '生产 Cookie 必须保留 Secure',
  )
  check(attributes.includes('Path=/'), 'Cookie 必须作用于根路径')
  // Secure 保持不变；测试只在回环 HTTP 上手动转发 name=value，不转发属性。
  return { cookie, id: match[1] }
}

async function chat(sessionKey, cookie, expectedError = null) {
  const response = await request(
    JSON.stringify({ sessionKey, mode: 'shopping', text: 'Show me everyday sneakers' }),
    cookie ? { cookie } : {},
  )
  check(response.status === 200, 'AI 流请求必须返回 HTTP 200')
  check(response.headers.get('content-type')?.startsWith('text/event-stream'), 'AI 响应必须是 SSE')
  const session = readSession(response)
  const events = (await response.text())
    .split(String.fromCharCode(10))
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)))
  if (expectedError) {
    check(events.length === 1, '护栏拒绝只能返回一个事件')
    check(events[0]?.type === 'error', '护栏拒绝必须返回 error')
    check(events[0]?.code === expectedError, '护栏错误码必须与实际拒绝原因一致')
    check(!events.some((event) => event.type === 'done'), '护栏拒绝不能返回 done')
  } else {
    check(!events.some((event) => event.type === 'error'), 'Mock SSE 不得含 error')
    check(events.at(-1)?.type === 'done', 'Mock SSE 必须以 done 完成')
    check(events.filter((event) => event.type === 'done').length === 1, 'Mock SSE 只能完成一次')
    check(
      events.some(
        (event) =>
          event.type === 'delta' && typeof event.text === 'string' && event.text.length > 0,
      ),
      'Mock SSE 必须产生非空文本',
    )
  }
  return session
}

const oversized = await chat('x'.repeat(129))
const first = await chat(randomUUID())
check(first.id !== oversized.id, '相同客户端不能靠 legacy key 共享无 Cookie 的会话')
const second = await chat(randomUUID(), first.cookie)
check(second.id === first.id, '轮换 legacy key 后，两回合仍必须复用签名 Cookie 的 session ID')

if (values['check-turn-limit']) {
  const refused = await chat(randomUUID(), second.cookie, 'turns')
  check(refused.id === first.id, '轮换 legacy key 不得绕过服务端回合限制')
}

const tamperedCookie = second.cookie.slice(0, -1) + (second.cookie.endsWith('0') ? '1' : '0')
const replaced = await chat(randomUUID(), tamperedCookie)
check(replaced.id !== first.id, '篡改签名必须产生不同的新会话')
const forgedId = randomUUID()
const forgedCookie = `${COOKIE_NAME}=v1.${forgedId}.${Math.floor(Date.now() / 1000) + 1800}.${'0'.repeat(64)}`
const forged = await chat(randomUUID(), forgedCookie)
check(
  forged.id !== forgedId && forged.id !== first.id && forged.id !== replaced.id,
  '伪造 Cookie 的 session ID 不得被接受或复用',
)

const foreignOrigin = new URL(baseUrl)
foreignOrigin.port = baseUrl.port === '65535' ? '65534' : '65535'
for (const [body, headers, status, code] of [
  [
    JSON.stringify({ text: 'Show me everyday sneakers' }),
    { origin: foreignOrigin.origin, cookie: second.cookie },
    403,
    'invalid_origin',
  ],
  ['{', {}, 422, 'invalid_request'],
  [JSON.stringify({ text: [] }), {}, 422, 'invalid_request'],
]) {
  const response = await request(body, headers)
  check(response.status === status, '非法来源或输入必须返回指定 HTTP 状态')
  check(
    response.headers.get('content-type')?.startsWith('application/json'),
    '入口拒绝必须返回 JSON',
  )
  check(response.headers.getSetCookie().length === 0, '入口拒绝不得签发 Cookie')
  check((await response.json()).code === code, '入口拒绝必须返回指定安全错误码')
}
console.log(
  `PASS: legacy 超长 key 被忽略；签名 Cookie 两回合稳定；篡改/伪造轮换；来源/JSON/shape 拒绝；${values['check-turn-limit'] ? '真实 turns 护栏通过；' : ''}HTTP 请求 ${requests} 次，断言 ${assertions} 条。`,
)
