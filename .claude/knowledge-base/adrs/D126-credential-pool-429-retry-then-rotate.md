# D126 — 429 handling: retry same key once, rotate on second consecutive 429

**Date:** 2026-05-20
**Status:** Accepted

## Decision

`PoolAwareLlmClient.stream()` tracks `hasRetried429: boolean` local to the invocation. First 429 → retry same key (set flag). Second 429 (or any non-rate-limit error) → rotate. Flag resets to false on rotation.

## Rationale

Mirrors Hermes (`run_agent.py:7404-7417`). A single transient 429 is often a network blip or thundering-herd microburst — rotating immediately burns an extra key. Two-in-a-row signals real quota exhaustion. Saves 1 key-credit per transient race per agent.

## Consequences

- **Enables:** Single-key pools degrade gracefully (1 retry then surface 429 to caller); transient blips don't waste keys.
- **Constrains:** First 429 adds 1 HTTP retry latency before propagating — documented in JSDoc.
