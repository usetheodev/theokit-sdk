---
slug: sdk-2-0-package-split
artifact: baseline-bundle
date: 2026-06-07
measured_at: 2026-06-07T22:55Z
package: "@theokit/sdk@1.7.0"
purpose: Bundle size snapshot before SDK 2.0 package split
---

# SDK 1.7.0 — Bundle baseline (pre-split)

Measured 2026-06-07 against `packages/sdk/dist/` after `pnpm -F @theokit/sdk build`.

## Method

For each entry declared in `packages/sdk/package.json` `exports` field, measure:

- **raw bytes:** `wc -c < <dist-file>`
- **gzipped bytes:** `gzip -c <dist-file> | wc -c`

## Results — all 12 sub-paths

| # | sub-path | dist file | raw bytes | gzipped bytes | notes |
|---|---|---|---:|---:|---|
| 1 | `.` (barrel) | `dist/index.js` | 558964 | **138677** | god-export, blocks split goal |
| 2 | `./cron` | `dist/cron.js` | 481533 | 117810 | already isolated sub-path |
| 3 | `./errors` | `dist/errors.js` | 7714 | 1950 | small, internal |
| 4 | `./eval` | `dist/eval.js` | 489268 | 120573 | already isolated sub-path |
| 5 | `./package.json` | (manifest) | N/A | N/A | metadata only, no bundle |
| 6 | `./path-safety` | `dist/path-safety.js` | 3893 | 1342 | small util |
| 7 | `./server/auth` | `dist/server/auth/index.js` | 10782 | 3235 | G11 auth orchestrator |
| 8 | `./server/errors-envelope` | `dist/server/errors-envelope.js` | 7734 | 2355 | G5 error envelope |
| 9 | `./subscription` | `dist/subscription/index.js` | 12008 | 3406 | G8 streaming primitives |
| 10 | `./task-store` | `dist/task-store.js` | 6819 | 2100 | task registry |
| 11 | `./tools` | `dist/tools.js` | 22900 | 5923 | built-in tools |
| 12 | `./workflow` | `dist/workflow.js` | 72173 | 16735 | already isolated sub-path |

## Additional measurements (informational)

| File | raw bytes | gzipped bytes |
|---|---:|---:|
| `dist/index.cjs` (CJS variant of barrel) | 564795 | 139395 |

## Aggregate

- **Total `dist/` size:** 14,610,274 bytes (~14.6 MB on disk).
- **Source file count (non-test):** 361 `.ts` files in `packages/sdk/src/`.

## Comparison anchors

- TheoKit default scaffold (web app: React 19 + router + SSR + devtools): **193 KB gzipped**.
- `@theokit/sdk@1.7.0` barrel alone: **138 KB gzipped** — 71% of a full web app, just to construct an `Agent`.

## Target post-split (per plan ADR D9)

| Package | Budget (gzipped) |
|---|---:|
| `@theokit/sdk-core` | ≤ 30 KB |
| `@theokit/sdk-memory` | ≤ 60 KB |
| `@theokit/sdk-budget` | ≤ 20 KB |
| `@theokit/sdk-cache` | ≤ 25 KB |
| `@theokit/sdk-handoff` | ≤ 15 KB |
| `@theokit/sdk-tools` | ≤ 15 KB |
