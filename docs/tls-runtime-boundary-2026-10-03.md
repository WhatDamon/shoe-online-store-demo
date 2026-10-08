# PostgreSQL TLS and TypeScript database boundary — 2026-10-03

The current TypeScript PostgreSQL client enforces certificate verification before
opening a connection. `NODE_ENV` is trimmed and compared case-insensitively, so a
deployment value such as `" Production "` cannot turn `PG_SSL=0` into plaintext
mode. Production also fails closed when the process-wide
`NODE_TLS_REJECT_UNAUTHORIZED=0` escape hatch is present. A configured
`PG_SSL_CA_FILE` is parsed as PEM and passed with `rejectUnauthorized: true`; the
client supplies an explicit hostname check so certificate identity is validated
for both DNS names and IP endpoints.

The evidence is in `src/db/postgres-tls.test.ts` (configuration and parser
regressions), `src/db/postgres-tls-handshake.test.ts` (real Node TLS handshake),
and `src/db/postgres-tls.integration.test.ts` (real PostgreSQL query with
trusted/untrusted/mismatched certificates when the disposable integration
service is configured). The targeted configuration and handshake run on
2026-10-03 passed 25 tests; `npm run typecheck` also passed.

TypeScript's five-table display/AI store still uses idempotent startup DDL in
`src/db/client.ts`, because it has no Alembic-managed commerce schema. This is a
separate boundary from Python commerce: the latter's 13 transaction tables are
created only by Alembic and application startup never calls `create_all()`. The
TypeScript DDL must not be pointed at the Python commerce database or treated as
a production migration mechanism for orders, inventory, or payments.
