import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

// Start the local server with AI_DISABLE_REAL=1 before running this smoke check.

async function chat(sessionKey) {
  const response = await fetch('http://127.0.0.1:3000/api/ai/chat', {
    method: 'POST',
    signal: AbortSignal.timeout(25_000),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionKey, mode: 'shopping', text: 'Show me everyday sneakers' }),
  })
  assert.equal(response.status, 200)
  assert.ok(response.headers.get('content-type').startsWith('text/event-stream'))
  return (await response.text())
    .split(String.fromCharCode(10))
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)))
}
const invalid = await chat('x'.repeat(129))
assert.equal(invalid[0].type, 'error')
assert.equal(invalid[0].code, 'rate_limited')
const sessionKey = randomUUID()
for (let turn = 0; turn < 2; turn++) {
  const events = await chat(sessionKey)
  assert.equal(
    events.some((event) => event.type === 'error'),
    false,
  )
  assert.equal(events.at(-1).type, 'done')
}
console.log('PASS: invalid oversized AI session refused; two valid Mock SSE turns completed.')
