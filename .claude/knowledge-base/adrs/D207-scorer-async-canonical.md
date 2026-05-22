# D207 — `Scorer` is `(output, expected?) => Score | Promise<Score>`

**Date:** 2026-05-22
**Status:** Accepted

## Decision

The canonical scorer type is async-tolerant — implementers may return `Score`
synchronously OR `Promise<Score>`. The Eval runner always awaits.

```ts
export type Scorer = (output: string, expected?: unknown) => Score | Promise<Score>;
```

Identical shape to the CLI's existing `Scorer` type (`packages/cli/src/eval/types.ts:22`)
— that file was deliberately designed against this future contract per D199.

## Rationale

- **D199 forward-compat.** Adopting the CLI's exact shape means D199's
  promise actually holds — the CLI's `EvalConfig` becomes a strict subset
  of the SDK's `EvalOptions`.
- **`llmJudge` is async.** Network-bound scorers fit the same interface as
  sync (`regex`).
- **Trivial overhead.** `await` on a sync return is micro-cost; eval is
  network-bound anyway.

Alternatives rejected:

- **Sync-only `Scorer` + `AsyncScorer`** — two types to learn; can't compose.
- **Always async return** — forces sync scorers to wrap in `Promise.resolve`.

## Consequences

- Enables: zero migration cost for D199 CLI consumers; uniform interface.
- Constrains: every scorer is awaited (micro-overhead negligible at eval scale).
