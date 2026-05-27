# D383 — Three budget modes: audit / warn / block

- **Status:** Accepted
- **Date:** 2026-05-27
- **Plan:** `token-budget-cost-tracker-plan` (Phase 0)

## Context

Audit-mode rollout é load-bearing operationally — [TrueFoundry](https://www.truefoundry.com/blog/rate-limiting-ai-agents-preventing-llm-api-exhaustion): *"Skipping audit mode is how you wake up to an angry team whose pipelines all failed at 03:00."*

## Decision

3 modos:
- `audit` — log only, no throw, never block.
- `warn` — log + callbacks at 80/95/100%, no throw.
- `block` — preflightCheck throws `BudgetExceededError` BEFORE LLM call when would-exceed.

Default: `warn`.

## Rationale

Default `warn` (não `audit`) porque caller que cria Budget explicitamente já decidiu querer enforcement. Audit é for rollout phase.

## Consequences

Mastra has only 2 modes (block/warn). Our 3rd mode (audit) facilitates safe rollout.
