# D243 — `.parallel` error policy is `fail-fast` by default; opt-in `collect` for best-effort

**Date:** 2026-05-22
**Status:** Accepted

## Decision

In `.parallel([a, b, c])`:
- Default (`errorPolicy: "fail-fast"`): first branch error aborts the rest via `AbortSignal`, returns `WorkflowParallelError` aggregating failures.
- Opt-in (`errorPolicy: "collect"`): all branches complete; output is array of `{ ok: true, value } | { ok: false, error }`.

## Rationale

Fail-fast is the default because cancelling pending operations on real error saves time and quota. Collect is useful for "best-effort fan-out" patterns (status checks across N providers). Conservative default + permissive opt-in is the right ergonomics.

## Consequences

- Tests must cover both modes with deterministic timing assertions.
- Documenting trade-off prominently (fail-fast loses partial progress; collect masks errors as data).
- `WorkflowParallelError` extends `AggregateError` for ergonomic `errors[]` access.
