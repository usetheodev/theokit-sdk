# Release @theokit/sdk@3.2.3

**Date:** 2026-07-14
**Verdict:** RELEASED
**PR:** https://github.com/usetheodev/theokit-sdk/pull/111
**Merge commit:** 788a59cf341e084357d4d4ec389a06d42d3d3f44
**Tag:** @theokit/sdk@3.2.3
**npm:** @theokit/sdk@3.2.3

## Cycle
M2 (resilience) — discover -> plan -> implement (TDD) -> adversarial review (3 agents) -> release.
Closed #59 (reconnect re-arm), #60 (Retry-After HTTP-date), #61 (Anthropic truncation guard),
#63 (pagination validation + cross-process lock proof). One initial fix (#60 same-key retry sleep)
honestly reverted when it broke fast key-rotation.

## Milestone
Completes M0-M3 harness-hardening floor: 16/16 issues (#54-#68) closed + adversarial-verified.

## Evidence
Full suite green (run in chunks): changed-areas 521, internal 1382, + 3 sweeps, zero failures.
typecheck 0; biome clean. ROADMAP M0-M3 all [x].
