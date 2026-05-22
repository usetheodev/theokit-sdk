# D253 — Composite cache key: `${namespace}:${embedderId}:${modelId}:hash(prompt)`

**Date:** 2026-05-22
**Status:** Accepted

## Decision

Cache key always includes `namespace` (multi-tenant), `embedderId` (cross-embedder invalidation), `modelId` (cross-model isolation), and SHA-256 hash of normalized prompt (first 16 hex chars).

## Rationale

CacheAttack paper documents 86% hit rate in response hijacking when keys collide. Composite key resolves privacy (tenant), correctness (cross-model), and invalidation (cross-embedder) in one decision.

## Consequences

- Cache never shared across tenants or models.
- Vector index implicitly partitioned by namespace (all entries with same namespace are candidates).
- Changing `modelId` per send invalidates.
