# D264 — False positive risk documented; NO automatic mitigation in v1

**Date:** 2026-05-22
**Status:** Accepted

## Decision

v1 does NOT implement LLM-as-judge verification (Krites paper) or hybrid lexical+semantic (BM25+dense). Callers needing correctness guarantees use a conservative threshold (0.95+) OR aggressive exclude regex. Limitation documented in `docs.md`.

## Rationale

LLM-as-judge doubles cost (every potential hit = LLM call to verify). Hybrid BM25+dense requires Lucene-shaped index — significant scope. v1 delivers 80% of value; high-stakes scenarios opt into stricter threshold.

## Consequences

- Roadmap v1.x: opt-in `verify: "llm-judge"` mode.
- Tests don't cover negation collapse — documented known limitation.
- Examples show threshold tuning.
