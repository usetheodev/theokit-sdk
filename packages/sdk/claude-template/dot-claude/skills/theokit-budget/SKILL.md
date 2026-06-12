---
user-invocable: false
paths:
  - "**/*budget*"
  - "**/*Budget*"
  - "**/*cost*"
  - "**/*token*"
description: TheoKit SDK Budget API reference — cost tracking, token budget enforcement, usage reporting
---

# TheoKit Budget

Token cost enforcement primitive. Track, warn, and block LLM spend at the
process level with stacked USD limits and configurable enforcement modes.

## Quick start

```typescript
import { Budget } from "@theokit/sdk";

const handle = Budget.create({
  name: "my-bot",
  scope: "process",
  mode: "warn",
  limits: [
    { window: "1h", limitUsd: 5.0 },
    { window: "1d", limitUsd: 50.0 },
  ],
  onThreshold: (event) => {
    console.warn(`Budget ${event.budgetName}: ${event.threshold * 100}% of ${event.window} limit`);
  },
  onExceed: (event) => {
    console.error(`Budget ${event.budgetName}: exceeded ${event.window} limit`);
  },
});
```

## Enforcement modes

| Mode | Behavior |
|---|---|
| `"audit"` | Log only. Never throws, never blocks. |
| `"warn"` | Callbacks fire at 80%, 95%, and 100% thresholds. No throw. Default. |
| `"block"` | Preflight throw (`BudgetExceededError`) BEFORE the LLM call when would-exceed. |

## Stacked limits

Pass multiple limits. ANY exceeded limit triggers enforcement:

```typescript
Budget.create({
  name: "emergency-stop",
  scope: "process",
  mode: "block",
  limits: [
    { window: "1h", limitUsd: 2.0 },
    { window: "1d", limitUsd: 10.0 },
    { window: "30d", limitUsd: 100.0 },
  ],
});
```

Empty `limits[]` is valid: pure tracking with no threshold/exceed callbacks.

## Time windows

| Window | Alignment |
|---|---|
| `"1h"` | Relative (last 60 minutes) |
| `"1d"` | UTC midnight boundary |
| `"1w"` | Monday 00:00 UTC |
| `"30d"` | 1st of month 00:00 UTC |
| `"365d"` | Jan 1 00:00 UTC |

## Managing budgets

```typescript
// Retrieve a budget handle
const handle = Budget.get("my-bot");

// Check spend and remaining
handle?.spentIn("1d");       // USD spent in current day window
handle?.remainingIn("1d");   // USD remaining before limit

// List all active budgets
const budgets = Budget.list();

// Snapshot all windows for all budgets
const snapshots = Budget.snapshot();
// [{ name, window, spentUsd, limitUsd, ratio }, ...]

// Delete a budget
Budget.delete("my-bot");
```

## Type reference

```typescript
type BudgetScope = "agent" | "call" | "process";
type BudgetWindow = "1h" | "1d" | "1w" | "30d" | "365d";
type BudgetMode = "audit" | "warn" | "block";

interface BudgetLimit {
  readonly window: BudgetWindow;
  readonly limitUsd: number;
}

interface BudgetOptions {
  readonly name: string;          // must match ^[a-z0-9][a-z0-9_-]*$
  readonly scope: BudgetScope;
  readonly limits: ReadonlyArray<BudgetLimit>;
  readonly mode?: BudgetMode;     // default "warn"
  readonly onThreshold?: (event: BudgetThresholdEvent) => void | Promise<void>;
  readonly onExceed?: (event: BudgetExceedEvent) => void | Promise<void>;
}

interface BudgetHandle {
  readonly name: string;
  readonly mode: BudgetMode;
  readonly scope: BudgetScope;
  readonly limits: ReadonlyArray<BudgetLimit>;
  spentIn(window: BudgetWindow): number;
  remainingIn(window: BudgetWindow): number;
}

interface BudgetSnapshot {
  readonly name: string;
  readonly window: BudgetWindow;
  readonly spentUsd: number;
  readonly limitUsd: number;
  readonly ratio: number;
}

interface BudgetThresholdEvent {
  readonly budgetName: string;
  readonly window: BudgetWindow;
  readonly threshold: 0.8 | 0.95;
  readonly spentUsd: number;
  readonly limitUsd: number;
}

interface BudgetExceedEvent {
  readonly budgetName: string;
  readonly window: BudgetWindow;
  readonly spentUsd: number;
  readonly limitUsd: number;
  readonly mode: BudgetMode;
}
```

## Wiring with agents

Budget enforcement integrates with `agent.send()`. When a budget is active
and mode is `"block"`, a preflight check runs before the LLM call. If the
estimated cost would exceed a limit, `BudgetExceededError` is thrown.

The `turn-ended` InteractionUpdate carries token usage that feeds the budget
ledger automatically:

```typescript
{ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }
```

## Errors

| Error | When |
|---|---|
| `ConfigurationError` | Invalid `name` (grammar violation) or duplicate `name` |
| `BudgetExceededError` | `mode: "block"` and spend would exceed a limit |

## Known limitations

- v1 supports `scope: "process"` only. `"agent"` and `"call"` scopes are
  reserved for future multi-tenant scenarios.
- In-flight `agent.send` calls referencing a deleted budget treat subsequent
  charges as a silent no-op with a stderr warning.
