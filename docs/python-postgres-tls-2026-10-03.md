# Python commerce PostgreSQL TLS boundary — 2026-10-03

The Python transaction service now has an explicit `APP_ENV` setting. When `APP_ENV` is
omitted, `NODE_ENV=production` also selects production mode; otherwise the local
default remains development. In production,
database engine creation accepts only PostgreSQL URLs with an explicit host and
`sslmode=verify-full`. SQLite, a hostless or `hostaddr`-only URL, an omitted mode,
`require`, and `verify-ca` fail before SQLAlchemy creates a connection pool. Development
and test environments retain local SQLite and disposable PostgreSQL support, including
the existing opt-in integration runner.

The check is applied by `make_engine`, so application startup, online Alembic runs and
catalog commands share the same boundary. The URL may include `sslrootcert` for a
private CA; hostname identity remains the responsibility of libpq's `verify-full`
mode. No credentials or URL values are included in errors.

Evidence:

- `backend/tests/test_database_tls.py` covers weak production modes, hostless and
  duplicate-mode URLs, accepted `verify-full`, local development behavior and unknown
  environments without opening a network connection: 11 tests passed.
- The backend regression suite passed 100 tests with one opt-in PostgreSQL test skipped;
  Ruff, format, mypy, compileall and `alembic check` passed after upgrading the local
  ignored demo database to the current head.
- The required PostgreSQL runtime integration remains opt-in through the dedicated
  `_test` database fixture; this change does not claim a production certificate or
  remote deployment has been verified.
