# Release @theokit/sdk@3.2.2 + @theokit/sdk-memory@0.2.1

**Date:** 2026-07-14
**Verdict:** RELEASED
**PR:** https://github.com/usetheodev/theokit-sdk/pull/110
**Merge commit:** b21f27d772503a48b29400bbe6ede0812eced11c
**Tags:** @theokit/sdk@3.2.2, @theokit/sdk-memory@0.2.1
**npm:** @theokit/sdk@3.2.2, @theokit/sdk-memory@0.2.1

## Cycle
Two CYCLEs (M0 security floor + M1 correctness core), each: discover -> plan ->
implement (TDD) -> adversarial review (3 agents) -> release. Adversarial review found
genuine residual gaps in already-shipped fixes; all closed with TDD.

## Closed
- M0 #54/#56/#59 (+ #68 verified) — env scrub, cross-tenant cache (sdk + sdk-memory), MCP body timeout.
- M1 #58/#55/#65 (+ #57 verified) — JobQueue deadlock + cancelled status, subagent permission propagation, transform_llm_output seam.

## Evidence
Full suite @theokit/sdk 3554 passed/36 skipped; @theokit/sdk-memory 342 passed. typecheck 0; biome clean.
ROADMAP M0 + M1 flipped with evidence.
