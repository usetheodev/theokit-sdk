---
id: D1
status: Decided
date: 2026-05-16
plan: sdk-v1-ga-completion
---

# D1 — Node 22.12+ mandatory in CI + local

## Context
`.nvmrc` declares `>=22.12.0`. Until this ADR, every local validation ran in Node 20 with `WARN Unsupported engine` and `pnpm quality:dead` (knip full) OOMed at 4 GB heap. The SDK was effectively never validated in the engine it declares.

## Decision
All gates (`pnpm test`, `pnpm typecheck`, `pnpm check`, `pnpm validate`, `pnpm quality`, `pnpm quality:dead`, dogfood) run on Node 22.12+ exclusively. Pre-push hook exits 1 with a friendly remediation message when local Node is <22.12. CI matrix pins `node@22.12` + `node@22-latest`.

## Rationale
Running validation in a different engine than the declared one produces engine warnings and tooling failures (knip OOM). Either align the engine and the validation or stop declaring a minimum.

## Consequences
- Contributors must `nvm use` before working.
- CI workflow drops Node 18/20 (never validated).
- Native deps (`better-sqlite3`) rebuild on Node 22 when contributors switch engines.

## Alternatives Considered
- **Lower the engine to ≥20** — rejected; loses Node 22 features (built-in `node:sqlite` fallback, stable `using` declarations, `WeakRef` stable, etc.).
- **Keep engine as-is, validate in 20** — rejected; engine warning is the problem.
