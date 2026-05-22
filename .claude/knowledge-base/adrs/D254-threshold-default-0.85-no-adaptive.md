# D254 — Threshold default `0.85` cosine distance; NO adaptive per-entry in v1

**Date:** 2026-05-22
**Status:** Accepted

## Decision

Default `threshold: 0.85` (cosine distance; lower = stricter). Override via `Cache.semantic({ threshold: 0.9 })`. v1 does NOT implement vCache-style per-entry adaptive threshold — deferred to v1.x.

## Rationale

LangCache guidance suggests 0.7-0.95 range; 0.85 is a balanced midpoint. vCache requires online learning + per-key state — significant scope. Conservative default + caller-tunable.

## Consequences

- False positive risk documented (D264).
- High-stakes scenarios (medical/financial) should pass `threshold: 0.95+`.
- Tests cover threshold boundaries (0.0, 1.0).
