# D377 — `CostStatus` is a 4-value closed enum

- **Status:** Accepted
- **Date:** 2026-05-27
- **Plan:** `token-budget-cost-tracker-plan` (Phase 0)

## Context

Hermes Agent ([usage_pricing.py:17](../../../referencia/hermes-agent/agent/usage_pricing.py)) ships `CostStatus = "actual" | "estimated" | "included" | "unknown"`. Mostrar $0 quando pricing é desconhecido é mentira — caller perde info.

## Decision

`CostStatus = "actual" | "estimated" | "included" | "unknown"`. Mirror Hermes.

## Rationale

UI exibe `~$1.23` ("estimated"), `n/a` ("unknown"), `included` ("included", e.g. Codex CLI subscription), `$1.23` ("actual" — após reconciliação OpenRouter `/generation`).

## Consequences

Caller branchea explicitamente. CostBreakdown sem amount NÃO é o mesmo que `amountUsd: 0`.
