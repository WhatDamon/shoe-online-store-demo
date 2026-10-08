# AI resource configuration boundaries — 2026-10-03

AI resource settings now use `envIntMax` after parsing. Positive values still work
as before, while values above the hard limits are clamped instead of silently
expanding process-local memory, provider output, timeout or daily cost exposure:

| Setting | Default | Hard maximum |
| --- | ---: | ---: |
| `AI_MAX_MESSAGE_CHARS` | 800 | 4,000 |
| `AI_MAX_OUTPUT_TOKENS` | 500 | 2,000 |
| `AI_MAX_TURNS` | 20 | 100 |
| `AI_REQUEST_TIMEOUT_MS` | 20,000 | 120,000 |
| `AI_DAILY_TOKEN_CAP` | 1,000,000 | 10,000,000 |

The limits are applied at each call site, so test stubs and runtime environment
changes are still observed without module reloads. Invalid, empty or non-positive
values retain the existing fallback behavior. This bounds configuration mistakes;
it does not provide shared multi-instance budget or rate state.

Evidence: `src/config.test.ts` and
`src/server/guardrails/config-limits.test.ts` cover clamping and defaults. The
full frontend verification and production build remain required after changes to
AI runtime limits.
