# D382 — Budget windows are UTC calendar-aligned

- **Status:** Accepted
- **Date:** 2026-05-27
- **Plan:** `token-budget-cost-tracker-plan` (Phase 0)

## Context

LiteLLM convention: daily limit resets at UTC midnight. Usuário espera "1 USD por dia" = "desde meia-noite UTC", não "última janela móvel".

## Decision

`BudgetWindow = "1h" | "1d" | "1w" | "30d" | "365d"`. Reset alinhado a UTC: midnight (1d), monday (1w), 1st (30d) — except `1h` is relative.

## Rationale

- DST irrelevant (UTC).
- Leap year covered by `Date.UTC` math.
- LiteLLM/Bifrost converge on this; user expectations consistent.

## Consequences

Caller que precisa de timezone diferente do UTC (e.g., business-day Pacific) deve fazer post-process. Documented in concept page.
