# D213 — `Eval.run` is single-flight per name per process

**Date:** 2026-05-22
**Status:** Accepted

## Decision

Two concurrent `Eval.run` calls with the same `name` throw `EvalAlreadyRunningError`.
Different names race freely. Enforcement is in-process only.

Implementation: module-level `Set<string>` of running names; acquire at start,
release in `finally`.

## Rationale

- **Telemetry correlation requires unique `eval.name` span attribute.** Two
  concurrent runs with the same name emit overlapping span trees —
  observability noise.
- **Cheap to enforce.** `Set.has/add/delete` is O(1); negligible overhead.

Alternatives rejected:

- **No guard** — overlapping spans become a debug nightmare.
- **Append nonce to name** — silently changes user-provided identifier;
  surprising.

## Consequences

- Enables: clean telemetry; per-eval observability boundaries.
- Constrains: matrix evals (`for model in [a, b, c]: eval.run()`) MUST give
  each run a unique name (e.g. include model id); multi-process needs
  caller coordination (out of scope).
