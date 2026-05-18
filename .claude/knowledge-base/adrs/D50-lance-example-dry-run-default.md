# D50 — LanceDB example default = dry-run + graceful degradation sem módulo

**Status:** Decided
**Date:** 2026-05-17

## Decision

`examples/memory-lance/` NÃO declara `@lancedb/lancedb` como dependency. Roda em "dry-run first" mode:

1. Sempre roda `migrateSqliteToLance({ cwd, dryRun: true })` que funciona com OU sem Lance instalado.
2. Tenta abrir Lance backend via `Memory.create({ index: { backend: "lance" } })`; captura `ConfigurationError(code: "lance_backend_unavailable")` e imprime msg amigável.

Script sempre exit 0, com ou sem Lance instalado.

## Rationale

- **Lance binding nativo falha em CI Alpine/musl/ARM** — declarar como dep do example bloqueia `pnpm install` nesses envs (já documentado em risco do v1.2 plan).
- **Padrão SDK** — Lance é optional peer dep (ADR D43); examples seguem o mesmo princípio.
- **Dry-run sempre funciona** — `migrateSqliteToLance --dry-run` é puro SQLite read; não escreve em disco real, não exige Lance.
- **Discoverability** — dev rodando sem Lance ainda vê o pattern de uso da API + a msg de "instale Lance pra escalar"; isso é o gancho de marketing.

Alternativas consideradas:

- **Declarar `@lancedb/lancedb` como dep**: rejeitado por CI compatibility.
- **Skip example silenciosamente sem Lance**: rejeitado — perde a oportunidade de mostrar a API.
- **Mock Lance inline**: rejeitado — mock não exercita o ConfigurationError code path real.

## Consequences

- Example funciona em qualquer ambiente Node 22+ (mesmo Alpine/ARM/sem-Lance).
- README documenta como ativar Lance: `pnpm add @lancedb/lancedb` no example (não no SDK).
- Script tem branch `try { Memory.create({ backend: "lance" }) } catch (lance_backend_unavailable) { print friendly msg }` — explícito.
- Migration CLI `theokit-migrate-memory --dry-run` é o smoke path principal — sempre exit 0 em workspace tmpdir vazio.
