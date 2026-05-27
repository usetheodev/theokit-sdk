# D385 — In-process shared ledger, mutex-protected; persistence deferred

- **Status:** Accepted
- **Date:** 2026-05-27
- **Plan:** `token-budget-cost-tracker-plan` (Phase 0)

## Context

Concurrent `agent.send` calls do mesmo processo precisam compartilhar contador para enforcement preciso. Persistência cross-restart traz JsonFile + corruption + lock + escopo cresce.

## Decision

Ledger é um singleton in-process, mutex-protected via `withCwdMutex('budget-ledger')` (mesmo padrão de `JsonFileTaskStore`). v1 zera ao restart; JsonFile persistence deferred to v0.2.

## Rationale

- Single-process invariant simplifies; cross-process budget é raro em v1.
- v0.2 adiciona JsonFile com mesmo padrão de D364 (TaskStore).

## Consequences

EC-6: GC eviction roda dentro do MESMO mutex que charge. EC-9: preflightCheck + provisional reserve são única região crítica.
