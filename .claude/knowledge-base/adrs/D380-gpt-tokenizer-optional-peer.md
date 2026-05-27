# D380 — `gpt-tokenizer` is an optional peer dependency

- **Status:** Accepted
- **Date:** 2026-05-27
- **Plan:** `token-budget-cost-tracker-plan` (Phase 0)

## Context

Pre-call token estimation precisa de tokenizer; bundle de 50 KB caro para callers que não usam Budget. PkgPulse 2026 benchmark elege `gpt-tokenizer` para small-text speed.

## Decision

`gpt-tokenizer@^3.4.0` é optional peer dep (`peerDependenciesMeta.optional: true`). `Budget.preflightCheck()` lazy `require()` o peer; ausente → return `undefined` graciosamente.

## Rationale

Pay-for-what-you-use. Caller sem Budget instalado economiza 50 KB.

## Consequences

`mode: 'block'` sem gpt-tokenizer degrada para post-call enforce (EC-21 documented).
