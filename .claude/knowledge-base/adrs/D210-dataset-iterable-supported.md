# D210 — Dataset accepts array OR factory-of-iterable

**Date:** 2026-05-22
**Status:** Accepted

## Decision

`EvalOptions.dataset` accepts:

```ts
type Dataset =
  | ReadonlyArray<DatasetEntry>
  | (() => Iterable<DatasetEntry> | AsyncIterable<DatasetEntry>);
```

Internally normalized to `AsyncIterable<DatasetEntry>` by `internal/eval/dataset-iter.ts`.

## Rationale

- **Streaming sources.** Production datasets often: too large for memory,
  loaded from Postgres / Hugging Face, generated on-the-fly. Forcing array
  materialization upfront blocks all three.
- **Async-iterable is canonical.** JS standard for streaming data.

Alternatives rejected:

- **Array-only** — works for ≤10k rows; loses streaming use cases.
- **AsyncIterable-only** — array case becomes verbose (`() => arr[Symbol.iterator]()`).

## Consequences

- Enables: streaming datasets.
- Constrains: when dataset is iterable, runner can't know `totalRows` until
  exhausted — `aggregate.totalRows` computed at end (not upfront estimate);
  v1 still materializes into a list before fanout (`Agent.batch` requires
  array of prompts); true streaming aggregate deferred to v2 per Out-of-Scope.
