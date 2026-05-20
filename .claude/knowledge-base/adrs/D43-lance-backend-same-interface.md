# D43 — LanceDB backend para Memory.index atrás da mesma interface

**Status:** Decided
**Date:** 2026-05-17

## Decision

`Memory` aceita novo campo `index.backend: "sqlite" | "lance"` (default `"sqlite"`). LanceDB é implementado em `internal/memory/lance-index.ts` implementando a mesma interface abstrata `MemoryIndex` que `SQLiteIndex`.

Refactor: extrair interface abstrata `MemoryIndex` em `internal/memory/index-interface.ts`; `IndexManager.open()` vira factory que delega para o backend escolhido.

`@lancedb/lancedb` é declarado como **optionalDependency**. Ausente + `backend: "lance"` → `ConfigurationError(code: "lance_backend_unavailable")` informando como instalar.

Filtros internos (namespace/scope) usam Lance structured filter API (`.where({ namespace: opts.namespace })`), **NUNCA** string interpolation. EC-1 do edge-case-review: SQL injection via namespace é vetor real se algum dia user-supplied input fluir até o filter.

## Rationale

- **Promise debt repayment**: ADR D12 prometeu LanceDB para v1.1 e ficou deferido sem deadline. Manter ADRs como promessa quebrada destrói credibilidade.
- **Escalabilidade real**: SQLite + sqlite-vec funciona até ~10k facts; acima disso latency p95 > 100ms. LanceDB é o standard 2026 para >100k embeddings (Lance file format é colunar, vector-aware).
- **SQLite continua sendo default**: zero-dependency, built-in (Node 22.5+ tem `node:sqlite`). Lance só é melhor para workloads grandes.
- **Polimorfismo já existe**: ADR D11 deixou catálogo de embedding providers polimórfico. Trocar backend agora é mudar UMA option.

Alternativas consideradas:

- **Replace SQLite por LanceDB completo**: rejeitado — SQLite ainda é melhor para <10k facts (sem servidor, faster startup, zero deps); breaking change não justificado.
- **API separada (Memory.openLance, Memory.openSqlite)**: rejeitado — polimorfismo via option é mais simples.
- **Auto-fallback baseado em count (>10k → use Lance)**: rejeitado — surpresa para user; melhor escolha explícita.
- **Inverted index custom em JSON**: rejeitado — reinventar roda; LanceDB resolve.

## Consequences

- `Memory.create({ index: { backend: "lance" } })` é a forma de opt-in.
- Default behavior 100% inalterado. v1.1 users não veem nada.
- Lance binding nativo falha em Alpine/musl/ARM em alguns ambientes — documentar como gotcha; SQLite default cobre esses casos.
- Migration SQLite → Lance é tópico próprio (ADR D44).
- Schema entre SQLite e Lance mapeia 1-1 (id, text, source, embedding vector, metadata). Tests de roundtrip enforce.
- Embedding dimension validado ao open: se workspace tem facts em dim X e provider config aponta dim Y, erro tipado `ConfigurationError(code: "embedding_dimension_mismatch")` (EC-8).
- Filtros structured-only: jamais string interpolation. Test obrigatório de injection prevention.
