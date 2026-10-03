# AI request boundary and correlation — 2026-10-03

This step hardens the public Next.js AI Route Handler before it reaches session,
rate, budget or provider code. It keeps the existing signed HttpOnly session and
SSE contract while bounding parser work and adding a server-owned correlation ID.

## Input contract

`POST /api/ai/chat` checks same-origin first, then reads at most 16 KiB with the
standard Web `Request.arrayBuffer()` API. A numeric `Content-Length` above that
limit is rejected before the body is read; chunked requests are checked again after
reading. Invalid UTF-8, malformed JSON, arrays/scalars and unknown fields return:

```json
{"code":"invalid_request","message":"Request validation failed"}
```

The response is `422`, `Cache-Control: no-store`, and has a server-generated
`X-Request-ID`. The legacy `sessionKey` field remains accepted and ignored so old
clients do not get a false sense of authority. The server never uses it for a
session or budget key.

Validated fields are bounded before session creation:

- `mode` must be one of `shopping`, `size-fit`, `outfit`, `find-shoes`, or `support`;
- `text` must be a string within `AI_MAX_MESSAGE_CHARS` (default 800) without control characters;
- product `handle` is lowercase slug syntax and at most 100 characters;
- product `title` is non-empty, at most 200 characters and contains no control characters;
- `footMm` is finite or null and must be between 200 and 330 mm.

Invalid input creates no signed session cookie, does not call `chat()`, and therefore
does not consume a turn, rate bucket, budget reservation or provider request.

When a trusted immediate proxy supplies `X-Forwarded-For`, the first forwarded token is
limited to 128 characters before it becomes a rate-limit key. Invalid or overlong values
fall back to the already trusted immediate peer; when no peer is available, the bounded
`untrusted` bucket remains the fallback.

## Correlation and logging

The route creates a UUIDv4 and ignores any client-supplied request ID. It returns the
same ID on origin/configuration errors and SSE responses, and passes it to the chat
orchestrator. AI refusal, provider failure, stream cleanup failure and budget
finalization logs are JSON objects containing only event type, stable refusal code,
request ID, phase and elapsed milliseconds. They never include session IDs, IPs,
message text, cookies, tokens, connection strings or provider exception text.

The budget reservation keeps a separate internal idempotency key; it is deliberately
not the HTTP correlation ID. This prevents logs from becoming a budget authority and
keeps retry accounting unchanged.

## Evidence

- `npm test -- src/app/api/ai/chat/route.test.ts src/server/ai/chat-budget.test.ts`: 2 files, 38 tests passed.
- `npm run typecheck`: passed.
- Tests cover malformed/oversized/overlong/unknown-field input, invalid mode/product/foot length,
  no chat call or cookie on rejection, UUIDv4 response headers, provider failure log shape,
  cancellation cleanup and existing signed-session compatibility.
- The installed Next.js 16.3.4 Route Handler guide was read; implementation uses standard Web
  `Request.arrayBuffer()` body access and retains `dynamic = 'force-dynamic'` plus Node runtime.
- Follow-up forwarded-token bound: `npm test -- --run src/server/guardrails/request.test.ts
  src/server/guardrails/bounded-store.test.ts` passed 44 tests; `npm run verify` passed 581
  tests and `npm run build` completed successfully.

This is a process-local input and observability boundary. It does not provide shared
multi-instance rate/session state, replace production proxy controls, or prove an
external deployment is configured correctly. The separate TypeScript PostgreSQL TLS
step rejects normalized production plaintext and `NODE_TLS_REJECT_UNAUTHORIZED=0`.
