# @theokit/sdk-budget

USD-cost-aware `BudgetTracker` impls for [`@theokit/sdk`](https://www.npmjs.com/package/@theokit/sdk).
Consumes the kernel-facing `BudgetTracker` port (SDK 2.0 Phase 2 / T2.1 —
ADR D1, interface inversion).

## Install

```bash
pnpm add @theokit/sdk-budget
```

`@theokit/sdk` (>=4.0.0) is a peer dependency — install it alongside. Nothing else is required:
this package has no runtime dependencies of its own.

```ts
import { Agent } from "@theokit/sdk";
import { createUsdBudgetTracker } from "@theokit/sdk-budget";

const agent = await Agent.create({
  agentId: "support-bot",
  model: { id: "anthropic/claude-3-5-haiku-latest" },
  budgetTracker: createUsdBudgetTracker({ maxUsd: 5 }), // hard $5 cap
  // ...other options
});

// During the run, check spend from outside:
const spent = (agent.budgetTracker as ReturnType<typeof createUsdBudgetTracker>).getTotalUsd();
console.log(`Spent so far: $${spent.toFixed(4)}`);
```

## What ships today

### USD-cost tracker (BudgetTracker port impl)

- `createUsdBudgetTracker({ maxTokens?, maxUsd?, pricing? })` — extends
  the counter-based reference from sdk-core with per-model USD cost
  computation. Built-in pricing table covers the most-used
  OpenAI / Anthropic / Google models; supply `pricing` to override or
  add custom models.
- `BUILTIN_PRICING` (read-only) — the static table powering the built-in
  rates. Export so consumers can audit current values.
- `computeUsdCost(pricing, model, type, tokens)` — pure helper for
  ad-hoc cost calc outside the tracker.

### Budget facade (Phase 2 physical Stage 1 — iter 19)

The Budget facade primitives (registry, ledger, enforcement,
normalize-usage, calendar-window) were physically extracted from sdk-core
to this package:

```ts
import {
  // Registry — manage named Budget instances
  createBudget, getBudget, listBudgets, deleteBudget, snapshotAll,
  defaultMode, getBudgetOptionsRaw,
  // Enforcement — preflight + threshold callbacks
  preflightCheck, chargeAndCheckThresholds,
  // Usage normalization — Anthropic / OpenAI Chat / OpenAI Responses
  inferApiMode, normalizeUsage,
  // Calendar window helpers — UTC-aligned 1h/1d/1w/30d/365d
  startOfDayUtc, startOfWeekUtc, windowStartMs,
  // Low-level ledger ops
  charge, spentIn,
} from "@theokit/sdk-budget";
```

sdk-core retains its own copies for v1.x sync API back-compat. Consumers
SHOULD migrate to importing from `@theokit/sdk-budget` directly before
sdk-core v3.0 (which will drop the duplicated source).

## When to use vs `createCounterBudgetTracker` (sdk-core)

| Need | Use |
|------|-----|
| Cap iterations only | `createCounterBudgetTracker` from `@theokit/sdk` |
| Cap raw token count | either (counter is lighter) |
| Cap USD spend | **`createUsdBudgetTracker` from `@theokit/sdk-budget`** |
| Need custom pricing logic | extend the contract directly — `BudgetTracker` is the port |

## Architecture

This package is a **port consumer**, not a kernel mod. The contract
lives in `@theokit/sdk/internal/runtime/budget-tracker.ts` and is
exposed to consumers via:

```ts
import type {
  BudgetTracker,
  BudgetUsageEvent,
  BudgetCheck,
  BudgetTotal,
} from "@theokit/sdk";
```

The agent loop calls `tracker.track(...)` after each LLM completion and
`tracker.check()` before each iteration. Your impl fulfills the
contract; sdk-core never imports this package directly — that's the
seam that makes the split possible.

## Cross-package coupling

sdk-budget's `ledger` consumes `withCwdMutex` from sdk-core via the
main `@theokit/sdk` barrel (per ADR-008). The mutex's process-level
Map is shared across all consumers via Node ESM's module-cache
guarantee — `internal/budget/ledger.ts` in this package serializes
writes against the SAME registry that sdk-core's `internal/memory`
subsystem uses. No double-mutex hazard.

## Roadmap

- v0.2: Pluggable pricing source (fetch live rates).
- v0.3: Ledger persistence (Postgres / SQLite adapters).
- v0.4: Per-user / per-tenant budget aggregation.

## API reference

Every symbol this package exports, with the exact specifier to import it from, is in the generated
capability map that ships inside `@theokit/sdk`:

```
node_modules/@theokit/sdk/docs/harness-capability-map.md   # symbol -> import specifier
node_modules/@theokit/sdk/docs/error-codes.md              # every `code` an error can carry
```

Both are generated from the built type declarations, so they describe the version you installed
rather than the version someone wrote a page about.

## License

Apache-2.0 © useTheo
