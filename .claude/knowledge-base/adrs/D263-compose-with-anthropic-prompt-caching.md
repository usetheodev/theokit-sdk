# D263 — Cache.semantic composes with Anthropic prompt_caching — documented, no code

**Date:** 2026-05-22
**Status:** Accepted

## Decision

Cache.semantic is a layer BEFORE the LLM. Anthropic prompt_caching is provider-side, AFTER LLM ingress. The two are orthogonal — semantic resolves paraphrases (cache hit/miss decision); prompt_caching resolves prefix-identical (Anthropic-side 90% discount on input tokens). Document combination in `docs.md`; no code work needed.

## Rationale

Ideal workload: 70% semantic hit + 90% prompt_caching discount on misses ≈ 95% composed savings. Caller uses both — no orchestration in SDK.

## Consequences

- `docs.md` section "Composing with provider-side caching" explains the pattern.
- Tests don't validate Anthropic-specific behavior.
