# Security maintenance checkpoint — 2026-09-28

This is a local engineering checkpoint, not a production-release or whole-project
completion claim. Work follows the maintenance instructions supplied with the
task and preserves the existing commerce architecture.

## Verified starting point

- Base: `2067536`, the tip of the existing commerce PR stack. GitHub inspection
  found #7 → #8 → #9 → #13 → #10 → #11 → #12 open; the older #5/#6 also remain open.
  No existing PR was closed, merged, approved or retargeted during this batch.
- The original checkout contains uncommitted AGENTS/SEO work. All changes in this
  batch were made in the separate managed `security-guardrails` worktree.
- Commerce MVP code, inventory expiry and Python CI exist, but their presence
  does not establish deployment. SQLite tests and live local HTTP smoke passed.
- Confirmed P1 defects: PostgreSQL explicitly skipped certificate verification;
  AI bucket/session maps and stored history could grow without a storage bound.

## Two review groups

1. `codex/verify-postgres-tls` (base: `codex/commerce-python-ci-docs`): verified
   production TLS, explicit CA-file configuration, sanitized configuration errors,
   and connection-string override protection. Real driver/Node TLS tests also
   uncovered an IP endpoint identity fallback; the client now checks the actual
   configured hostname/IP. Core files: `src/db/client.ts`, TLS tests and a clearly
   public test-only certificate/key fixture, `.env.example`, `README.md`.
2. `codex/bound-ai-guardrail-state` (base: `codex/verify-postgres-tls`): 1,000
   sessions, 10,000 buckets per rate dimension, 128-character restricted keys,
   timer plus overdue-on-access cleanup, fail-closed new-key capacity, physically
   trimmed 12-message history with 4,000 characters per message, and explicit
   disposal. Core files: `src/server/guardrails/bounded-store.ts`, `rate-limit.ts`,
   `session-state.ts`, `index.ts`, their regression tests and README.

Neither group changes a schema, dependency, commerce API, inventory transaction,
payment behavior or storefront layout. The legacy display/AI database still uses
its existing bootstrap DDL; this batch does not claim to migrate it to Alembic.

Publication is incomplete: the first Git push timed out connecting to GitHub,
and permission for its retry was rejected. No new remote PR or CI run is claimed.
Both branches are prepared as separate local review groups; no network workaround
or branch-protection bypass was attempted.

## Executed validation

Commands ran in the isolated checkout. Python used the existing project's
`backend/.venv/Scripts/python.exe` from the original checkout, with the worktree's
`backend/` as working directory and disposable SQLite databases.

| Check | Observed result |
| --- | --- |
| Baseline `npm test` | 66 files / 397 tests passed |
| Baseline `npm run lint`, `npm run build` | Passed |
| TLS `npx vitest run src/db/db.test.ts src/db/postgres-tls.test.ts src/db/postgres-tls-handshake.test.ts` | 29 tests passed |
| TLS final `npm run verify`, `npm run build` | Passed; 68 files / 418 tests |
| Guardrails `npx vitest run src/server/guardrails` | Included in 7 targeted files / 48 passing tests |
| Final `npm run verify`, `npm run build` | Passed; 69 files / 434 tests |
| `python -m pytest -q` | 30 passed; two existing dependency deprecation warnings |
| `python -m ruff check app migrations tests` | Passed |
| `python -m ruff format --check app migrations tests` | Passed, 25 files |
| `python -m mypy` | Passed, 18 source files |
| `python -m compileall -q app migrations tests` | Passed |
| Fresh `python -m alembic upgrade head` and `python -m alembic check` | Passed; no schema drift |
| `python scripts/smoke-commerce.py` against both live local services | Passed: pages, cookie proxy, cart mutations, repricing, idempotency, disabled payment, cancellation and stock restoration |
| `node scripts/smoke-ai.mjs` against production Next server in forced Mock mode | Passed: oversized session refused; two valid SSE turns completed |

The TLS handshake test uses a real local TLS server and postgres.js client, then
returns a test PostgreSQL startup error after successful verification. It proves
unknown-CA rejection, correct-host acceptance and wrong-host rejection; it is not
a PostgreSQL SQL/transaction integration test.

During implementation, type-checking caught test import typings and callback
parameter annotations; both were corrected. The initial wrong-host handshake test
failed and exposed the driver fallback; it passed only after the endpoint check
was fixed. Final checks above reflect the repaired version.

Not executed: real PostgreSQL transactions/load tests (no isolated instance
provided), remote CI for these commits (not pushed), deployment and public URL/SEO
verification (not part of this unpublished security batch).

## Local reproduction

Follow README's existing environment setup. From `backend/`, run Alembic upgrade,
the explicit demo seed and `python -m uvicorn app.main:app --host 127.0.0.1 --port 8000`.
From the frontend checkout, set `PYTHON_API_URL=http://127.0.0.1:8000`,
`SHOPIFY_ENABLED=false`, `AI_DISABLE_REAL=1`, then run `npm run build` and `npm run start`.
Open `/shop` → a product → select color/size → add to cart → checkout →
`pending_payment` order → cancel. Payment remains disabled. Smoke orders were
created and cancelled only in the isolated `backend/security-smoke.db`; the
original local databases and environment files were not modified.

## Remaining gates, in priority order

1. Publish/review the two P1 groups, configure the real deployment's trusted CA
   and endpoint, then verify production connectivity. No live TLS success is claimed.
2. Replace client-controlled AI session identities and untrusted forwarded-IP
   handling; add signed/server-owned session, origin and cross-user tests.
3. Replace the read/check/call/write AI budget with atomic reservations and
   idempotent settlement/release, including concurrency, failure and abort tests.
4. Separate commerce business exceptions from FastAPI; add response contracts,
   stable safe errors/request IDs and frontend runtime validation.
5. Verify PostgreSQL runtime/concurrency and migration behavior; address catalog
   authority/version/deletion drift and snapshot/currency invariants.
6. Only then proceed to measured performance and verified site facts/SEO work.
   Production URLs, product evidence and post-release measurements still need
   validation; existing uncommitted SEO drafts are not acceptance evidence.

Until session/IP/budget work is verified, keep real AI disabled and do not scale
the in-process guardrails horizontally or across independent serverless instances.
No Redis, real payment, Shopify synchronization or marketing claims were added.

## Monitoring and rollback

Track TLS connection errors, existing `rate_limited`/`turns` refusals, process
memory and 5xx without logging credentials, certificate contents, cookies or chat
history. Capacity rejection intentionally shares the existing safe user message;
dedicated aggregate occupancy telemetry remains future work.

There are no schema changes to reverse. Revert only the relevant security commit
to undo its code; reverting restores its original risk, so disable real AI or keep
the affected deployment offline while repairing it. Prefer restoring the previous
trusted certificate/CA bundle over reverting TLS verification. Timer state is
process-local and resets on restart; do not present restarts as a shared limiter.
