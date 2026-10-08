# Commerce internal proxy authentication — 2026-10-03

The browser-facing Next route now sends a server-only `X-Internal-Proxy-Secret`
to Python. Python applies a constant-time comparison to every `/api/v1/*` route;
missing or incorrect values are rejected before database work. Production settings
require at least 32 UTF-8 bytes, and the Next route returns a generic `503` before
fetching Python when its production secret is missing or too short. Client-supplied
copies of the header are ignored because the proxy constructs the upstream headers.

Development keeps the existing local flow when the secret is empty. If a secret is
configured there, it is still enforced. The health endpoint remains public for
liveness checks; commerce data routes are protected. The session UUID remains an
ownership credential and is not replaced by the proxy secret.

Evidence:

- TypeScript proxy tests cover forwarding the configured secret, ignoring a browser
  spoof and production fail-closed behavior: 9 focused tests passed; the full
  frontend verify run passed 574 tests across 76 files.
- Python tests cover production configuration and missing, wrong and correct proxy
  credentials on a commerce route; the full backend suite passed 103 tests with one
  opt-in PostgreSQL test skipped.
- The root preflight now checks the production secret length without printing it.
  Its two Pester tests passed.
