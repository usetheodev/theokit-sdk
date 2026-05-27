# D387 — `RunResult.usage?` + `RunResult.cost?` are optional

- **Status:** Accepted
- **Date:** 2026-05-27
- **Plan:** `token-budget-cost-tracker-plan` (Phase 0)

## Context

D108 (v1.2 caller API preserved byte-by-byte). Adding required fields to `RunResult` breaks every existing caller.

## Decision

`RunResult.usage?: TokenUsage` and `RunResult.cost?: CostBreakdown` are optional. Populated em todo status onde ≥1 LLM call completou (incluindo `error`/`cancelled` partial — EC-5).

## Rationale

- Backward compat absoluto.
- EC-5 update: surface usage on partial failure preserves billing audit.
- `undefined` apenas quando ZERO LLM calls aconteceram (e.g., abort pre-send).

## Consequences

Mirrors D363 (Task wrapping opt-in pattern). Callers que ignoram ficam idênticos a v1.1; callers que usam Budget recebem populated.
