# D258 — Embedder change invalidates cache via namespace versioning

**Date:** 2026-05-22
**Status:** Accepted

## Decision

`embedder.id` is part of the cache key (D253). Switching embedder makes all prior entries unreachable. No cross-embedder rerank in v1.

## Rationale

Vectors from different embedders live in incompatible spaces. Cosine compare across them is meaningless. Clean failure mode: "switch embedder = fresh cache", documented.

## Consequences

- Migration between embedders loses cache. Caller can pre-warm via batch script.
- Tests verify namespace changes when embedder.id changes.
