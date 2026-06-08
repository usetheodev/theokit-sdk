---
slug: sdk-2-0-phase-2-physical-survey
artifact: extraction-survey
created_at: 2026-06-08
parent: sdk-2-0-phase-1-2-adr.md
purpose: Map the Phase 2 (Budget) physical source extraction blast radius before attempting the move
---

# Phase 2 physical extraction — pre-move survey

After iter 18+ shipped `@theokit/sdk-budget@0.1.0` (cohort-ready), the
remaining work is the **physical source move** of `internal/budget/*`
out of `@theokit/sdk` into the new package. This document records the
survey so the next iteration starts with full context.

## Files in `internal/budget/`

| File | LOC | Decision |
|---|---|---|
| `usage-accumulator.ts` | 68 | **KEEP in sdk-core** — kernel hot path in `agent-loop/loop.ts` (lines ~4, 333, …) and `agent-loop/usage-and-cost.ts`. Moving would force kernel → extension dep, violating ADR-003. |
| `calendar-window.ts` | 53 | Move |
| `compute-cost.ts` | 167 | Move |
| `enforcement.ts` | 148 | Move |
| `ledger.ts` | 106 | Move |
| `normalize-usage.ts` | 156 | Move |
| `pricing-registry.ts` | 129 | Move |
| `pricing-data.json` | — | Move |
| `registry.ts` | 105 | Move |
| **Total moveable** | **~864 LOC** | sdk-budget destination |
| **Total kept** | **~68 LOC** | sdk-core retained |

## Public-API blast radius

`src/budget.ts` re-exports as `@theokit/sdk` public surface:

```ts
export {
  chargeAndCheckThresholds, // enforcement.ts
  computeCost,              // compute-cost.ts
  getPricingEntry,          // pricing-registry.ts
  inferApiMode,             // normalize-usage.ts
  normalizeUsage,           // normalize-usage.ts
  preflightCheck,           // enforcement.ts
  UsageAccumulator,         // STAYS in sdk-core
};
export class Budget { … }   // facade over registry.ts
```

`internal/runtime/budget.ts` provides `IterationBudget` — also kernel
hot path; STAYS in sdk-core.

## Strategy options

### Option A — optional-peer pattern (mirrors sdk-handoff iter 6)

`src/budget.ts` becomes a thin shim:

```ts
let _impl: typeof import("@theokit/sdk-budget") | undefined;
try {
  _impl = await import("@theokit/sdk-budget");
} catch {
  /* package not installed — exports throw with actionable message */
}
export const computeCost: typeof _impl["computeCost"] = (
  _impl?.computeCost ?? (() => { throw new Error("Install @theokit/sdk-budget"); })
) as never;
// … same for the other 6 re-exports + Budget class
```

**Pros:** Zero kernel → extension dep at the type level; bundle win.
**Cons:** Top-level await (TLA) constraints in CJS consumers — sdk-handoff
solved this with a lazy-init pattern that defers the import to first use.

### Option B — formally deprecate the re-exports from sdk-core

`src/budget.ts` re-exports become `@deprecated`; new code imports from
`@theokit/sdk-budget` directly; the source files stay in sdk-core for
one minor cycle then removed in v2.0.

**Pros:** Clean break in v2.0.
**Cons:** Doesn't reduce bundle size in the interim.

### Option C — hybrid

- Move the moveable 864 LOC to `@theokit/sdk-budget`.
- Keep `src/budget.ts` as a back-compat shim that re-exports from
  `@theokit/sdk-budget` (creating a public-API → optional-peer dep that
  fails at import time when the peer is absent).
- Document the migration: "install `@theokit/sdk-budget` for `Budget`
  features; sdk-core no longer ships them."

**Pros:** Bundle wins, clean version story.
**Cons:** Breaking change shape for users who don't have sdk-budget
installed but use `Budget.create({ … })`.

## Recommendation

**Option A** mirrors the precedent set by sdk-handoff in Phase 4
(iter 6). The lazy-init wrapper pattern is the canonical FAANG-style
answer when a re-export needs to migrate to a different package
without breaking consumers.

## Estimated effort

- Move 7 files + pricing-data.json to `packages/sdk-budget/src/`
  (~30 min — mostly path rewrites).
- Rewrite `src/budget.ts` as a lazy-init optional-peer shim
  (~2 hours — pattern from sdk-handoff).
- Update tests that currently import from `@theokit/sdk` budget
  surface to either work with lazy-load OR import from
  `@theokit/sdk-budget` directly (~3 hours).
- Bundle measurement: verify the sdk-core bundle dropped by ≥ 5KB
  gzipped (the target is the eventual 30 KB sdk-core threshold for
  Phase 6).

Total: ~1 dev-day in a single focused iteration.

## Next iteration scope

- T2.physical.1 — copy 7 files to `packages/sdk-budget/src/`
- T2.physical.2 — rewrite `src/budget.ts` as optional-peer shim
- T2.physical.3 — measure bundle delta + commit
- T2.physical.4 — update CHANGELOG + ADR-002 status

Do NOT attempt without a fresh focused session; the kernel hot-path
risk is too high for an aside.
