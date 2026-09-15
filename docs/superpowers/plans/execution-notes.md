# Execution Notes

Subagent-driven execution record for the 18-task plan
([`2026-09-04-shoe-store-frontend-ai.md`](./2026-09-04-shoe-store-frontend-ai.md)),
branch `feat/shoe-store`. Live per-task ledger (reviews, findings, carry-forwards, gate items)
lives in the git-ignored workspace at `.superpowers/sdd/2026-09-04-shoe-store-frontend-ai/`.

## Commit trail (task → head commit)

| Task | Summary                                                             | Commits                         |
| ---- | ------------------------------------------------------------------- | ------------------------------- |
| 1    | Scaffold + toolchain (Next 16 / Tailwind v4 / shadcn / Vitest)      | `39c20ed`, `6637200`            |
| 2    | Domain types + libs (Product, CatalogAdapter, market, format)       | `fd074da`                       |
| 3    | mm-anchored size conversion + size-hint parser                      | `3131e8b`                       |
| 4    | Seed catalog — 16 3D-printed casual shoes, 4 collections            | `eb953ac`                       |
| 5    | CatalogAdapter (seed) + market-aware service layer                  | `0523777`                       |
| 6    | bun:sqlite + Drizzle two-table DB, embedding repo, cosine           | `5b28fe0`                       |
| 7    | Parametric inline-SVG product visual (3 views; honeycomb fixed R1)  | `9874d72`, `acf4d5b`            |
| 8    | Wishlist (localStorage) provider + hook + accessible toggle         | `a5b9f6f`                       |
| 9    | ProductCard / ProductGrid                                           | `498dcd8`                       |
| 10   | /shop URL-driven filters + SSR grid (race fixed R1, back-path R2)   | `8cc1287`, `e7d7269`, `cfb00ab` |
| 11   | AppBar + Landing + root-layout providers (Collections nav fixed R1) | `1a29ca2`, `646a262`            |
| 12   | PDP — gallery, size selector, buy bar, related (order fixed R1)     | `5cec42e`, `9eefc9e`            |
| 13   | SEO metadata + local OG route + not-found/error/loading shells      | `70dc5be`, `ea26f63`            |
| 14   | Retrieval — embedder probe, lazy embed + cache, keyword fallback    | `96557e1`                       |
| 15   | AI guardrails — turns/trim/TTL, token bucket, daily budget          | `d590b61`                       |
| 16   | AI orchestration + SSE endpoint (Mock/real providers)               | `8833887`                       |
| 17   | Assistant UI — FAB, Sheet chat, SSE stream, chips (fixed R1)        | `246bf48`, `6c7bfdd`            |
| 18   | README + .env.example + acceptance gate + reports                   | _(this task)_                   |

Base commit for the worktree was `4cc9494` (feat/shoe-store worktree start).

## Review outcomes

Every task passed review; fix rounds were run where a review required it (tasks 7, 10 ×2, 11, 12,
13, 17). Deferred / gate-required items are tracked in the SDD ledger and summarized in
[`../../implementation-report.md`](../../implementation-report.md).

## Gate commands (all green at HEAD)

```bash
bun run typecheck   # tsc --noEmit
bun run lint        # eslint .
bun run test        # vitest run — 28 files / 121 tests
bun --bun run build # next build — 22/22 static incl. 16 PDP SSG routes
```

---

## 架构精化执行记录（2026-09-15）

驱动技能：`superpowers:executing-plans`。计划：
[`2026-09-15-code-architecture-refactor.md`](./2026-09-15-code-architecture-refactor.md)。
分支 `refactor/high-cohesion-low-coupling`（从 `main` 09ac764 切出），**一个批次一个提交**作回滚点。
包管理器层去 Bun 拆到独立分支 `chore/de-bun-package-manager`（见
[`../../../adr/0006-bun-to-node-scope.md`](../../adr/0006-bun-to-node-scope.md)）。

### 批次 → 提交 → 门禁

| 批次 | 内容                                  | 提交       | verify   | build | 环    |
| ---- | ------------------------------------- | ---------- | -------- | ----- | ----- |
| —    | 计划文档 + 基线（56 文件 / 294 用例） | `cc216ee`  | ✅       | ✅    | 2     |
| 1    | 消除重复真源                          | `5f58b91`  | 57 / 297 | 42/42 | —     |
| 2    | 共享状态与配置基座                    | `04c3c90`  | 58 / 318 | 42/42 | **0** |
| 3    | 域边界重组                            | `dc238be`  | 58 / 318 | 42/42 | 0     |
| 4    | AI 编排解耦                           | `6748280`  | 60 / 341 | 42/42 | 0     |
| 5    | 助手状态与模态统一                    | `93b443c`  | 63 / 375 | 42/42 | 0     |
| 6    | 收口与文档                            | _(本提交)_ | 63 / 375 | 42/42 | 0     |

import 环扫描基线为 **2 组**（AI provider 的两处纯类型导入），批次 2 归零后保持。

### 计划外或不按计划执行的事项

五条偏差写在计划文档各批次的「执行记录」小节，其中三条值得单独记住：

1. **批次 4 的 `TurnContext` 未按计划携带 `provider` / `guardrails`**，改为注入 `stream` / `record`：
   计划原样会把刚拆掉的耦合重新引回。
2. **批次 5 的计划出口「UI 测试行数下降」未采纳。** 实测 `assistant.test.tsx` 10 例中仅 3 例沾
   会话规则，`assistant-speak.test.tsx` 8 例全是 TTS 副作用 —— 这些恰是 reducer 单测覆盖不到的接线。
   故只增不删（+34 例单测，UI 测试原样保留），该条出口未达成但总覆盖变好。
3. **批次 6 的 6.1（收缩死接口面）跳过。** 计划的前置确认问「Shopify 通道是否仍要保持休眠可启用」，
   答案在 README / `.env.example` / spec 中是明确的「是，预留（spec #14 远期可选）」——
   于是计划自己给的选项 (b)（删除 `shopify-stub` 与 `shopifyEnabled()`）**方向相反**，故不做。

### 批次 6 的额外发现

计划的 6.4 要求删除「各处 `规格 §x` / `决策 #n` 编号引用」。执行时**验证了这些编号已失效**，
而不是照着描述删：

- spec 中 `决策 #15`–`#20` 的标签**已不存在**（列表裁剪后重新编号，见 `09ac764`），
  而 src/ 中有 36 处引用它们；`§8.5.2` / `§8.5.6` / `§8.3.4` 同样从未存在（spec 只到 `### 8.5`）。
- 结论：编号引用已**自行腐烂**，删掉编号并保留描述性文字后，注释变成自足的。
  机械替换产生了几处破损片段（`（，消费端措辞`、`（/§8.5.5`、`（注）`），逐一修掉，25 处独立粗体标签
  改为真标题。

### 追加的门禁命令

```bash
bun run check:boundary  # scripts/check-server-boundary.mjs — 'use client' 不得运行时导入 @/server/**
```

已接入 `verify`，位于 `typecheck` 与 `lint` 之间。无 allowlist，用临时违规探针验证过有判别力。
