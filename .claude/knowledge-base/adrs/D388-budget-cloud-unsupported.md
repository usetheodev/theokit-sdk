# D388 — `CloudAgent.send({ budget })` throws `UnsupportedBudgetOperationError`

- **Status:** Accepted
- **Date:** 2026-05-27
- **Plan:** `token-budget-cost-tracker-plan` (Phase 0)

## Context

Cloud runtime é pre-release. `runUntil` (D122), `usePersonality` (D169), `runWorkflow` (D244), Task (D370), Bedrock Converse (D296) — todos throw `UnsupportedRunOperationError` em CloudAgent.

## Decision

`CloudAgent.send` rejeita SendOptions com `budget` via `throw new UnsupportedBudgetOperationError("send")`. Local-only em v1.

## Rationale

In-process ledger não persiste cross-cloud; Theo PaaS GA tratará via cloud-side budget API.

## Consequences

Caller cloud-gating recebe erro tipado. v1.x estende quando PaaS expõe budget surface.
