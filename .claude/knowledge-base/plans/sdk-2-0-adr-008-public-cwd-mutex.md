---
slug: sdk-2-0-adr-008-public-cwd-mutex
artifact: architectural-decision-record
number: 008
created_at: 2026-06-08
parent: sdk-2-0-phase-1-2-adr.md
title: Promote `withCwdMutex` to public sdk-core utility
purpose: Unblock Phase 2 (Budget) physical extraction by sharing the process-level mutex Map across extracted packages
status: ACCEPTED
---

# ADR-008 — `withCwdMutex` is a public sdk-core utility

## Status

ACCEPTED 2026-06-08 (iter 18+).

## Context

Phase 2 physical extraction (moving `internal/budget/*` source files to
`@theokit/sdk-budget`) hit a blocker: `internal/budget/ledger.ts:5`
imports `withCwdMutex` from `../../persistence/cwd-mutex.js` — a
sdk-core INTERNAL utility, not publicly exported.

`withCwdMutex(key, fn)` is a per-key serialization primitive backed by
a module-scoped `Map<string, Promise>`. It prevents concurrent
read-modify-write races on files like `MEMORY.md` and the Budget
ledger within a single process.

The mutex's correctness depends on **all callers sharing the same
Map**. Module-scoped state in JavaScript means: every import of
`cwd-mutex.js` resolves to the SAME runtime module instance —
guaranteeing one Map per process.

If `@theokit/sdk-budget` duplicates the `withCwdMutex` source file in
its own `internal/`, the duplicated module gets its OWN Map. Concurrent
budget-ledger writes from sdk-budget code would NOT serialize against
memory-system writes from sdk-core code → data race in production.

## Decision

Promote `withCwdMutex` from `@internal` to `@public`. Export it from
the `@theokit/sdk` main barrel:

```ts
// packages/sdk/src/index.ts
export { withCwdMutex } from "./internal/persistence/cwd-mutex.js";
```

Extracted packages consume the SAME registry by importing from
`@theokit/sdk`:

```ts
// packages/sdk-budget/src/internal/ledger.ts
import { withCwdMutex } from "@theokit/sdk";
```

Because Node's ESM module resolution caches each package by absolute
path, `@theokit/sdk`'s `cwd-mutex.js` resolves once per process — the
Map is shared across every consumer.

## Stability guarantee

- Signature `withCwdMutex<T>(key: string, fn: () => Promise<T>): Promise<T>`
  will not change before sdk-core v3.0.
- Semantics (process-level keyed serialization, last-writer-wins on
  identical keys, error isolation between consecutive calls) are part
  of the contract.

## Consequences

### Positive

- Phase 2 physical extraction unblocked: ledger.ts + dependents
  (enforcement, registry) can move to sdk-budget without losing
  cross-package serialization.
- Same pattern unlocks Phase 1 physical extraction: `dreaming/run.ts`
  (sdk-memory) imports `withCwdMutex` too — promoting it to public
  enables both extractions consistently.
- Public surface increases by exactly one function (no other internals
  promoted).

### Negative

- Stability surface grows. We now own backwards-compat for this
  signature even when the impl evolves.
- A future need for richer locking (e.g., a reader-writer lock or
  cross-process file lock) requires a NEW public name, not
  modification of this one.

### Neutral

- Internal callers (10+ kernel files) keep using the SAME function —
  zero behavior change. The promotion is purely additive at the
  module exports level.

## Alternatives considered

### Alternative 1 — Duplicate `withCwdMutex` per extracted package

Rejected. Module-scoped Map per package = each package has its own
serialization registry = cross-package writes can race against each
other. Defeats the purpose of the mutex.

### Alternative 2 — Keep ledger.ts in sdk-core; partial Budget extraction only

Possible (only calendar-window + normalize-usage move, ~209 LOC out of
the 864 LOC moveable). Doesn't reach the bundle-size target for Phase
6 rename. Punts the architectural decision.

### Alternative 3 — Introduce a shared `@theokit/sdk-internals` package

Add a private utility package every extracted package depends on.
Rejected as over-engineering: `withCwdMutex` is the ONLY internal
utility that needs cross-package sharing. A whole new package is
disproportionate to the need.

## Migration

None. Internal callers keep working. New callers in extracted
packages import from `@theokit/sdk`.

## References

- Phase 2 physical survey: `sdk-2-0-phase-2-physical-survey.md`
- Source: `packages/sdk/src/internal/persistence/cwd-mutex.ts`
- Existing usage: 5+ kernel runtime files
  (memory/dreaming, runtime/cloud-agent, runtime/registry,
  local-agent-personality-extensions, plus the Budget ledger).
