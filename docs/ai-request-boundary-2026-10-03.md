# AI request boundary and correlation — 2026-10-03

This step hardens the public Next.js AI Route Handler before it reaches session,
rate, budget or provider code. It keeps the existing signed HttpOnly session and
SSE contract while bounding parser work and adding a server-owned correlation ID.

## Input contract

`POST /api/ai/chat` checks same-origin first, then uses the shared streaming reader
in `src/server/guardrails/request-body.ts`. A numeric `Content-Length` above 16 KiB
is rejected before pulling. Missing or understated lengths are checked on every
chunk; the reader cancels on the first chunk crossing 16 KiB instead of buffering
the complete body. The retained buffer is bounded; a single upstream chunk may
already exceed that limit, so deployment-level ingress limits are still required.
Abort and read failures reject the request and release the reader lock.
Invalid UTF-8, malformed JSON, arrays/scalars and unknown fields return:

```json
{ "code": "invalid_request", "message": "Request validation failed" }
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

## 2026-10-05 follow-up: commerce and current evidence

The commerce proxy uses the same 16 KiB streaming bound for non-GET requests.
Oversized bodies return safe `413 invalid_request`; stream failures return `422`.
Rejected bodies neither contact Python nor issue a cart Cookie. Production cart
Cookies always have Secure even when TLS terminates before Next; HTTP development
continues to work. No schema, prices, payment or Shopify behavior changes.

A separate Python integrity regression found that an inventory inner join could
hide a cart item with a missing inventory row and allow partial checkout to clear
the full cart. `cart_view` now uses an outer join: such items stay visible with
`available=0`, `sellable=false`; preview and checkout reject them with
`409 variant_unavailable`. Removing the unavailable item permits checkout. The
new API regression verifies cart preservation and no order/reservation/stock writes.

Current local evidence, based on HEAD `f8e0964` plus the uncommitted fix:

- Red: 4 HTTP boundary tests and 1 missing-inventory API test failed before fixes.
- Green: `npm run verify` passed 593 tests, skipped 16 PostgreSQL tests; 80 files passed.
- `npm run build` passed, including 45/45 static page generation. The build used a
  disposable display SQLite path and seed catalog, not the business database.
- Python full suite: 105 passed, 1 PostgreSQL integration skipped, 2 dependency
  deprecation warnings; Ruff, format, mypy and compileall passed.
- Alembic upgrade head and check passed against a newly created isolated SQLite DB.
- Real loopback HTTP against the production Next build and a disposable Python DB
  passed pages, cart quantity, authoritative repricing, idempotency, ownership,
  disabled Mock payment, cancellation/stock restoration, chunked oversize rejection,
  Secure Cookies and Mock AI SSE. Test servers were stopped afterwards.
- HTTP tests disabled environment proxy inheritance for loopback calls. Since there
  was no local trusted HTTPS certificate, the harness explicitly supplied its own
  isolated cart Cookie over HTTP. This is not browser HTTPS or reverse-proxy acceptance.
- Current PostgreSQL concurrency/TLS, remote CI, deployment and browser UI acceptance
  remain unverified. Historic evidence below is retained with its original date.
- The SQLite expiry and old AI smoke items above were candidates at this checkpoint;
  the continuation below records their independent reproduction and resolution.

## 2026-10-05 continuation: expiry UTC and signed-session smoke

SQLite candidate selection failed for an explicit UTC-8 `now` at the exact UTC
deadline (1 failed, 3 passed for UTC-8/UTC/UTC+8/naive expressions). `expiry.py`
now reuses `as_utc` before building the SQL predicate. Locks, per-order transactions,
release/audit behavior and schema are unchanged. The default worker already used
UTC; this is a fix for explicit non-UTC inputs, not evidence of a general worker outage.
After the fix, 41 expiry/availability regressions and the full SQLite suite
(109 passed, 1 PostgreSQL integration skipped, 2 existing warnings) passed.

The old AI smoke failed against an isolated production Mock server because its
first event was `delta`, not the expected `error` for an oversized legacy key.
`scripts/smoke-ai.mjs` now verifies ignored legacy keys, two-turn signed Cookie
session ID continuity, tampered/forged Cookie replacement, Origin 403, JSON/shape
422 without Cookies, no-store and server-owned request IDs. A separate fresh
`AI_MAX_TURNS=2` instance verifies that changing legacy keys cannot evade the
third-turn `turns` refusal. Two instances passed 17 real HTTP requests and 229
assertions, repeated against the freshly rebuilt final artifact. A route regression
also asserts that the actual AI input equals the UUID from the Cookie payload and
is not the complete signed value. The deadline regression additionally asserts
unchanged cart revision before expiry, closing premature SQL selection coverage.
All test services were stopped; no complete Cookies are logged.

Final `npm run verify`: 593 passed, 16 PostgreSQL tests skipped; the production
build generated 45/45 static pages. Ruff/format/mypy/compileall and a fresh
SQLite Alembic upgrade/check passed. The isolated frontend driver hides dotenv
files and uses a whitelisted environment; it does not alter repository assertions.

The script requires an isolated production-mode Mock server and only accepts
HTTP loopback targets; each request has a 25-second timeout and rejects redirects:

```powershell
node scripts/smoke-ai.mjs --base-url http://127.0.0.1:3000
# Only against a different fresh instance started with AI_MAX_TURNS=2:
node scripts/smoke-ai.mjs --base-url http://127.0.0.1:3108 --check-turn-limit
```

These checks do not substitute for browser HTTPS, real provider compatibility,
PostgreSQL/TLS, remote CI or deployment acceptance. No migration, new configuration
variable, dependency or real payment integration was introduced.

## Historical evidence (2026-10-03)

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
