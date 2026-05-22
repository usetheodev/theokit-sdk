# D199 — `theokit eval` v1 wraps `Agent.batch`; swaps to `Eval.run` later

**Date:** 2026-05-22
**Status:** Accepted

## Decision

`theokit eval` v1 is a minimal runner:
- Dynamic `import()` of `eval.config.{ts,mjs}` (default export).
- Validates shape (lightweight — `Array.isArray` checks; Zod only if a
  detected violation needs a clearer error).
- Runs prompts through `Agent.batch` (D134) with concurrency from
  config (default 4).
- Applies user-supplied scorers (sync OR async via EC-K) to each
  output.
- Emits a markdown report at `--output` (default `./eval-report.md`).

When Adoption Roadmap #2 (`Eval.create/Eval.run`) ships, this runner's
internals swap to `Eval.run(config)` — the public `EvalConfig` shape
stays compatible.

## Rationale

- **Chicken-and-egg solved**: `theokit eval` (#1) and `Eval.run` (#2)
  reference each other. Shipping a thin wrapper unblocks #1 without
  waiting for #2 + provides a stable consumption surface that #2 can
  match.
- **Reuses existing primitives**: `Agent.batch` (D134-D140) gives
  concurrency, failure isolation, credential pool sharing for free.
  v1 eval is literally a thin score-and-aggregate wrapper.
- **Forward-compatible config**: `EvalConfig` shape (dataset / scorers
  / agent) was designed against the future `Eval.create` API so
  user-authored configs work post-swap.

Alternatives rejected:

- **Wait for `Eval.*` API** — blocks adoption of `theokit eval` and
  postpones documenting the consumption flow.
- **Ship a third-party-eval shim** (Braintrust, LangSmith) — locks
  consumers to an external service.

## Consequences

- Enables: ship CLI #1 today; eval is functional v1 not stub.
- Constrains: v1 doesn't have aggregation UI, dataset streaming for
  large corpora, or trace viewer — Roadmap #2 handles. Documented as
  v1 limitation in README.
