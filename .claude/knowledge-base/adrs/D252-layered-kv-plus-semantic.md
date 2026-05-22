# D252 — Layered architecture: KV exact pre-filter + vector semantic search

**Date:** 2026-05-22
**Status:** Accepted

## Decision

Every lookup tries KV exact (hash of normalized prompt) first; on miss, embeds and runs vector search. Vector top-1 within threshold = hit. KV is O(1); vector is O(N) for v1.

## Rationale

GPTCache validates layered design — embedding calls (100ms-500ms) are expensive; KV pre-filter avoids them when prompts repeat verbatim. Common in chat (same question asked twice).

## Consequences

- Two storage views over the same Map (KV by key, vector via `Map.values()`).
- Metrics separate `cache.kv.hit` from `cache.semantic.hit`.
- Tests cover both paths.
