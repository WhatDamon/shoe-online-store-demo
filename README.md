# Evoloop — 3D-Printed Casual Shoes (Demo)

A consumer-facing storefront demo for a fictional brand of **3D-printed casual / lifestyle shoes**
(digitally crafted, printed to order in your size). Built with **Next.js (App Router) + Bun +
Tailwind + shadcn/ui**, with a server-side AI shopping guide that stays deliberately subtle
(spec principle P1: consumer language only, no "AI" branding).

This is a **product prototype / frontend demo**: there is no checkout. Product detail CTAs are a
placeholder until a Shopify storefront exists (a switchable catalog adapter is ready for it). The
catalog is a local seed of **29 real supplier styles** (imported from the brand supply-chain
workbook, spec decision #16) with **real product photos** (WebP in `public/products/`); image-less
entries fall back to programmatic SVG visuals. `/shop` also carries the "spend $50, get a free
gift" offer with a gallery of leftover-offcut trinkets.

> Docs: [design spec](docs/superpowers/specs/2026-09-04-shoe-store-ai-design.md) ·
> [implementation plan](docs/superpowers/plans/2026-09-04-shoe-store-frontend-ai.md) ·
> [implementation report](docs/implementation-report.md)

## Tech stack

- **Next.js 16.3.4** (App Router, Turbopack) + React 19 + TypeScript 5
- **Bun 1.3** as package manager and runtime (required — see below)
- **Tailwind CSS v4** + **shadcn/ui** (Base UI preset)
- **Drizzle ORM**, dual-driver (spec decision #13): **SQLite** (`bun:sqlite`, default, zero-setup) or **Postgres** (`postgres.js`, Cloud SQL-ready) — chosen by `DB_DRIVER` in the environment
- **Vitest** (unit + React Testing Library), **ESLint**, `tsc --noEmit`
- AI: OpenAI-compatible streaming client with a deterministic **Mock mode** when no key is set

## Prerequisites

- **Bun ≥ 1.3** (project ships `packageManager: bun@1.3.14`). Verify with `bun --version`.
- No API keys are required to run the demo — the AI assistant works in Mock mode.

## Quick start

```bash
bun install
cp .env.example .env.local      # defaults are fine — empty AI_API_KEY = Mock mode
bun run dev               # http://localhost:3000
```

> **Bun runtime required for the default SQLite driver.** The `next` CLI normally runs on the Node
> runtime, but the SQLite driver imports `bun:sqlite` (server-only code under `src/server`, `src/db`),
> so the npm scripts bake in `bun --bun next …` — plain `bun run dev|build|start` already runs the
> CLI on the Bun runtime. (No `--bun` prefix needed anymore; the scripts do it.)
>
> Set `DB_DRIVER=postgres` (with a `DATABASE_URL=postgres://…`) and the app runs on plain Node
> runtimes too — the pg path uses `postgres.js` only, no Bun-specific imports.

First run auto-creates the schema (two tables `product_embeddings`, `ai_usage`) via idempotent
`CREATE TABLE IF NOT EXISTS` on **either** driver — SQLite file at `./data/local.db`, or the
Postgres database behind `DATABASE_URL`. No migration step.

### What you can do without any setup

- Landing page, `/shop` (URL-driven filters), product detail pages (SSG, 29 products)
- Wishlist (localStorage), size picker with market conversion (US system by default)
- Floating assistant (right-bottom "Need a hand?" FAB on non-landing pages):
  chips `Find my size` / `Style it with` / `Help me pick` / `Everyday sneakers under $150`,
  streamed answers, product result cards, deterministic size recommendation — all in Mock mode.
- PDP → "Find my size" opens the assistant pre-seeded with the current shoe.

## Scripts

| Command | Meaning |
|---|---|
| `bun run dev` | Next dev server (Turbopack) on the Bun runtime (script bakes in `bun --bun`). |
| `bun run build` | Production build on the Bun runtime. |
| `bun run start` | Serve the production build on the Bun runtime. |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run lint` | ESLint over the repo |
| `bun run test` | Vitest (35 files, 158 tests) — runs on Node; DB tests use a `node:sqlite` test compat shim aliased in `vitest.config.mts`, production code still imports real `bun:sqlite`. |
| `bun run test:watch` | Vitest watch mode |

The acceptance gate is **lint + typecheck + test + build**, all green on `feat/shoe-store` (HEAD).

## Environment variables

See [`.env.example`](.env.example) for the annotated template. Summary:

| Variable | Default | Meaning |
|---|---|---|
| `SITE_MARKET` | `US` | Market (`US\|EU\|UK\|JP\|CN`); drives the size-display system + mm-anchored conversions |
| `AI_API_KEY` | *(empty)* | **Empty → Mock mode** (zero cost, demoable). Set to enable the real OpenAI-compatible provider. |
| `AI_BASE_URL` | *(empty)* | OpenAI-compatible endpoint base URL (empty = official OpenAI) |
| `AI_MODEL` | `gpt-5.6-luna` | Chat model for the real provider (2026-09: GPT-5.6 budget tier; quality-upgrade: `gpt-5.6-terra`) |
| `AI_EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model for semantic search (cached locally) |
| `AI_MAX_TURNS` | `20` | Per-session turn cap (soft message when exceeded) |
| `AI_MAX_OUTPUT_TOKENS` | `500` | Max output tokens per provider response |
| `AI_REQUEST_TIMEOUT_MS` | `20000` | Provider request timeout |
| `AI_MAX_MESSAGE_CHARS` | `800` | Max characters per incoming user message |
| `AI_DAILY_TOKEN_CAP` | `1000000` | Daily token budget (SUM over `ai_usage` per UTC day) |
| `AI_DISABLE_REAL` | `0` | `1` forces Mock mode even with a key (abuse kill switch) |
| `DB_DRIVER` | `sqlite` | `sqlite` (default) or `postgres` — selects the app DB driver (decision #13) |
| `DATABASE_URL` | `./data/local.db` | sqlite: local file; postgres: `postgres://…` connection string |
| `SHOPIFY_DOMAIN`, `SHOPIFY_STOREFRONT_TOKEN` | *(empty)* | Reserved. Catalog adapter switches seed → Shopify only when **both** are set (not yet active). |

### Enabling real AI

1. Put a real key in `AI_API_KEY` (optionally `AI_BASE_URL` for a gateway / custom endpoint).
2. Set `AI_EMBEDDING_MODEL` + `AI_BASE_URL` to activate semantic retrieval; without them the
   assistant transparently uses keyword search over the catalog.
3. Restart. Guardrails (rate limit, turn cap, daily budget) apply to real and Mock alike.
   `AI_DISABLE_REAL=1` is the one-switch rollback to Mock.

### Switching market / sizes

`SITE_MARKET` is a **deployment-level, single-market** setting (no runtime market switching):
sizes are stored once in a canonical EU system and converted to the market's system
(US/EU/UK/JP/CN, foot-length-mm anchored) for display, filtering and "Find my size". Currency and
copy stay English/USD.

## Directory map

```
src/
  app/                     # App Router pages & routes
    page.tsx               # Landing (zero AI presence by design)
    shop/page.tsx          # /shop — SSR list, URL-state filters (collection/size/price/sort/q)
    product/[handle]/page.tsx  # PDP — SSG (generateStaticParams), buy CTA placeholder
    api/ai/chat/route.ts   # POST SSE endpoint (delta|productCards|sizeFit|done|error frames)
    og/route.tsx           # Local OpenGraph image (ImageResponse, no network)
  components/
    marketing/             # AppBar, Footer, Hero, CollectionCards, Story, ...
    shop/                  # ProductCard/Grid, ProductVisual (SVG), size selector, wishlist, PDP cluster
    assistant/             # FAB + Sheet chat panel, SSE hook, chips, message list
    ui/                    # shadcn/ui primitives
  server/                  # Server-only layers (never imported by client code except `type`)
    catalog/               # Seed/Shopify adapter + market-aware service (conversions, related)
    search/                # embedder, keyword search, retrieval (embedding cache + cosine), vector
    ai/                    # providers (Mock/OpenAI-compatible), chat orchestration, SSE events, prompts
    guardrails/            # rate limit, session state (turns/TTL/trim), token budget, soft copy
  db/                      # Drizzle dual-driver schemas (2 tables each: sqlite-core + pg-core), clients
  lib/                     # shared pure helpers (site, market, wishlist, size charts, formats, SEO)
  test/                    # bun:sqlite → node:sqlite test compat shim (test-only)
```

## Architecture notes

- **Catalog**: the seed adapter serves 29 supplier styles across 4 collections
  (Everyday/Comfort/Travel/Minimal) from `src/server/catalog/seed.ts` (curation over
  `data/supplier.json`, generated by `scripts/import-catalog/import.py`). Product cards and PDP
  galleries use real photos (`Product.images`, WebP under `public/products/<handle>/`) and fall
  back to SVG visuals only when image-less. A separate `gifts.ts` module feeds the `/shop` free-gift
  gallery (gifts are display-only, never in the sellable catalog). The Shopify adapter mirrors the
  Storefront API shape and activates when `SHOPIFY_*` is configured — no other code changes.
- **AI**: RAG-lite, zero tool-calling — every real/gateway model only needs chat completions.
  Retrieved product cards are injected into the system prompt; the model must answer from that
  injected content only. Modes: `shopping`, `size-fit` (deterministic), `outfit`, `find-shoes`.
- **Guardrails** (all anonymous, no PII): in-memory token bucket rate limit (IP + session),
  per-session turn cap + history trim + idle TTL, output-token cap + timeout, and a **persisted**
  daily token budget on `ai_usage`. Soft copy everywhere ("taking a short break"), never
  "rate limited". Runs entirely in-process (single-instance assumption, spec P7).
- **Search**: embedding vectors cached in `product_embeddings` (contentHash-validated), cosine in
  app code (fine below ~2k products — beyond that, move to a native vector backend).

## Known limitations (see `docs/implementation-report.md` for the full list)

- Checkout is not implemented; the detail CTA is an "Available soon" placeholder driven by a
  `getBuyUrl` adapter contract (returns `null` until the Shopify store exists).
- Unknown product handles return the not-found UI with **HTTP 200 + `noindex`** under the current
  `dynamicParams` SSG setting (a deliberate, documented tradeoff; revisit if SEO on 404s matters).
- Compliance: no cookies, no tracking, no personal data sent to AI providers. Anonymous `ai_usage`
  token counts are stored locally for budget enforcement only.

## Disclaimer

Demo / prototype. Brand: **Evoloop** (decided). Supplier product codes, photos, colors and size
segments are real (from the brand supply-chain workbook); English marketing names, prices and copy
are demo placeholders, as is the size conversion table (foot-length-mm anchored, canonical EU
35–48). The free-gift offer is a demo promotion. No real purchase flow is connected.
