# D386 — `BudgetExceededError extends TheokitAgentError`

- **Status:** Accepted
- **Date:** 2026-05-27
- **Plan:** `token-budget-cost-tracker-plan` (Phase 0)

## Context

Caller branchea em errors tipados. Mesma régua de D133 (CredentialPoolExhaustedError), D366 (InvalidTaskIdError), D370 (UnsupportedTaskOperationError).

## Decision

```ts
class BudgetExceededError extends TheokitAgentError {
  override readonly name: string = "BudgetExceededError";
  readonly budgetName: string;
  readonly window: BudgetWindow;
  readonly spentUsd: number;
  readonly limitUsd: number;
  readonly mode: BudgetMode;  // EC-1
  constructor(args: { budgetName; window; spentUsd; limitUsd; mode; cause? });
}
```

`code: "budget_exceeded"`, `isRetryable: false`.

## Rationale

- `mode` field (EC-1) — caller branchea em logging/Sentry context (audit vs block).
- `isRetryable: false` — cap não desaparece em retry; precisa esperar reset.

## Consequences

Throw acontece em `block` mode preflight ANTES da LLM call. `audit`/`warn` nunca throw essa.
