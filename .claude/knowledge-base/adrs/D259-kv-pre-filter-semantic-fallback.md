# D259 — KV exact tried first; semantic fires only on KV miss

**Date:** 2026-05-22
**Status:** Accepted

## Decision

In `pre_user_send`:
1. Normalize prompt.
2. Compute `kvKey = hash(normalized)`.
3. KV lookup → if hit + TTL valid → return cached.
4. Else embed + vector search.
5. If top-1 distance ≤ threshold → return cached.
6. Else miss; prompt flows to LLM.

## Rationale

Embedder API calls cost money + latency. Skipping when exact match exists is free. GPTCache validates this layered architecture.

## Consequences

- Tests cover both paths (KV hit, KV miss + vector hit, full miss).
- Metrics split `cache.kv.hit` from `cache.semantic.hit`.
