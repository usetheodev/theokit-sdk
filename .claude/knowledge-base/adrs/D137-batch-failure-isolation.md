# D137 — Failures are isolated per-prompt; `Agent.batch` never throws on a single failure

**Date:** 2026-05-20
**Status:** Accepted

## Decision

`BatchResult` is a discriminated union by `ok`. On per-prompt error,
`runOne` catches and returns `{ ok: false, error: TheokitAgentError, ... }`.
The batch resolves with the full array — no partial throws.

```ts
type BatchResult =
  | { ok: true; index; prompt; result: RunResult; metadata?; durationMs }
  | { ok: false; index; prompt; error: TheokitAgentError; metadata?; durationMs };
```

Caller filters via `r.ok` (TS narrows correctly). The only exceptions
that propagate from `Agent.batch` are validation errors (e.g.,
`ConfigurationError` for invalid concurrency, EC-2) — caught before any
work begins.

## Rationale

Batch processing semantics is "best-effort N runs". A single bad prompt
(invalid input, transient 429, network blip) should not lose 999
successful ones. Mirror the behavior of `Promise.allSettled`, not
`Promise.all`.

Failure isolation is also what Hermes-Agent's `batch_runner.py` does
(it persists each result independently and continues). Diverging would
surprise callers porting from Python.

## Consequences

- **Enables:** robust scaling — one rate-limited prompt doesn't poison
  the rest; consumers can keep their long-running fine-tuning data
  generation alive across thousands of prompts.
- **Constrains:** caller MUST check `ok` before reading `result` or
  `error`. TS enforces this via the discriminated union — runtime
  errors are impossible if the caller uses TypeScript.
