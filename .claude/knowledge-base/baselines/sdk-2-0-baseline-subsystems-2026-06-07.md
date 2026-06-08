---
slug: sdk-2-0-package-split
artifact: baseline-subsystems
date: 2026-06-07
measured_at: 2026-06-07T22:55Z
package: "@theokit/sdk@1.7.0"
purpose: Subsystem map snapshot before SDK 2.0 package split — diff baseline
---

# SDK 1.7.0 — Subsystem map (pre-split)

Empirical map of the 17 subsystems inside `@theokit/sdk@1.7.0`. Used as diff baseline for the SDK 2.0 split — after extraction, the same subsystems must be locatable in their new home (sdk-core sub-paths or separate `@theokit/sdk-*` packages).

**Measurement method:** `find packages/sdk/src/<scope> -name "*.ts" ! -name "*.test.ts"` for file count, `xargs cat | wc -l` for LOC. Cross-imports verified via `grep -rln "from ['\"].*/<scope>"`.

## 1. Agent

The kernel that ties everything together. Owns the agent loop, builder, factory, runtime context.

- **Public surface:** `agent.ts` (728 LOC), `agent-builder.ts`, `agent-factory.ts`, `theokit.ts`
- **Internal:** `internal/agent-loop/` (loop logic), `internal/runtime/` (context, hooks, lifecycle)
- **Extractability:** STAY in `sdk-core` — this IS the kernel. Cannot extract.
- **Cross-imports:** imports from budget, memory, handoff (auto-wired today).

## 2. Memory

Conversation persistence, embedding-based retrieval, dreaming sweep, multi-adapter store.

- **Public surface:** `memory.ts` (191 LOC), `memory-adapter-helpers.ts`
- **Internal:** `internal/memory/` — **40 files / 4070 LOC**
  - `adapters/` (8 files): openai, mistral, voyage, ollama, deepinfra, openrouter, anthropic embedders + catalog
  - `dreaming/` (sleep-time consolidation)
  - `storage/` (Lance + SQLite-vec + chunk)
  - `tools/` (retrieval operators)
- **External usage:** theokit.ts, migrate.ts, internal/llm/credential-pool.ts, internal/runtime/fixtures/*, internal/runtime/local-agent-dispatch.ts, local-agent-personality-extensions.ts
- **Extractability:** EXTRACT to `@theokit/sdk-memory` (Phase 1). Cross-imports need careful handling.

## 3. Budget

USD/token enforcement, pricing registry, ledger, calendar-window aggregation.

- **Public surface:** `budget.ts` (85 LOC)
- **Internal:** `internal/budget/` — **8 files / 932 LOC**
  - compute-cost, enforcement, usage-accumulator, normalize-usage, pricing-registry, ledger, registry, calendar-window
- **Cross-imports:** agent-loop directly imports `UsageAccumulator`, `computeCost`, and `IterationBudget` (`internal/runtime/budget.js`) — proven via grep against `packages/sdk/src/internal/agent-loop/loop.ts`.
- **Extractability:** EXTRACT to `@theokit/sdk-budget` (Phase 2). Requires `BudgetTracker` interface inversion (ADR D1) to break circular dep.

## 4. Cache

Semantic cache with vector + FTS hybrid lookup. Integrates via Plugin protocol.

- **Public surface:** `cache.ts` (247 LOC)
- **Internal:** `internal/cache/` — **9 files / 722 LOC**
  - lookup (vector + FTS), stores (in-memory + JSON file), embed-helper, cosine, ttl, telemetry
- **External usage:** types/index.ts, index.ts barrel only.
- **Extractability:** CLEAN EXTRACT to `@theokit/sdk-cache` (Phase 3). Plugin protocol already abstracts integration.

## 5. Handoff

Inter-agent dispatch. Auto-injected today into tool registry; will move to plugin protocol.

- **Public surface:** `handoff.ts` (120 LOC)
- **Internal:** `internal/handoff/` — **4 files / 491 LOC**
  - dispatcher, registry, tool-injector, telemetry
- **External usage:** types/handoff.ts, types/index.ts, index.ts barrel. Indirect via internal/runtime/agent-init.ts (auto-wire).
- **Extractability:** EXTRACT to `@theokit/sdk-handoff` (Phase 4). Requires agent-init refactor (remove auto-wire).

## 6. Registry & Plugins

The plugin foundation. Lifecycle hooks, registry of installed plugins, `definePlugin` factory.

- **Internal:** `internal/plugins/` (definePlugin + types + manager + lifecycle)
- **Internal:** `internal/tool-registry/` (LiveAgentRegistry singleton)
- **Extractability:** STAY in `sdk-core` (ADR D8). Extracting creates circular dep with Agent class.

## 7. Cron

Time-triggered handlers, 5-field schedule, persistence to disk.

- **Public surface:** `cron.ts`
- **Internal:** `internal/cron/`
- **Extractability:** STAY as `@theokit/sdk-core/cron` sub-path (ADR D7). Already isolated, no bundle benefit to extracting.

## 8. Eval (Judge, Scorers)

LLM-based regression eval, scorers (accuracy, latency, cost), judge model selection.

- **Public surface:** `eval.ts`, `scorers.ts`
- **Internal:** `internal/eval/`, `internal/judge/`, `internal/scorers/`
- **Extractability:** STAY as `@theokit/sdk-core/eval` sub-path (ADR D7). Already isolated.

## 9. Workflow

Declarative workflow DSL — 7 control-flow primitives (agentStep, fn, parallel, sequence, switch, repeat, await).

- **Public surface:** `workflow.ts`
- **Internal:** `internal/workflow/`
- **Extractability:** STAY as `@theokit/sdk-core/workflow` sub-path (ADR D7).

## 10. Task

Task registry observability (5-state enum + pluggable TaskStore).

- **Public surface:** `task.ts`, `task-store.ts`
- **Internal:** `internal/task/`
- **Extractability:** STAY in sdk-core sub-path (similar reasoning to cron/eval).

## 11. Subscription

G8 streaming primitives — `defineSubscription`, `subscribe`, SSE/WS transport, lastEventId resume.

- **Public surface:** `subscription/`
- **Internal:** `subscription/internal/`
- **Extractability:** STAY as `@theokit/sdk-core/subscription` sub-path (ADR D7). Recently shipped (1.7.0), pre-isolated.

## 12. Tools

Built-in tools — read-file, list-dir, search-text, git-diff, subprocess, run-vitest, path-scope.

- **Public surface:** `tools/` — **8 files / 931 LOC**
- **Internal:** `internal/tool-dispatch/` (separate concern)
- **Extractability:** EXTRACT to `@theokit/sdk-tools` (Phase 5). Has own optional peer-deps (simple-git, vitest).

## 13. Server/Auth

G11 auth orchestrator — `defineAuth`, providers, OAuth transactions, session rotation.

- **Public surface:** `server/auth/`
- **Internal:** `internal/auth/`
- **Extractability:** STAY as `@theokit/sdk-core/server/auth` sub-path (ADR D7).

## 14. Persistence

Shared utility — `atomic-write`, conversation persistence, persistence-schema.

- **Internal:** `internal/persistence/`
- **Extractability:** STAY in sdk-core. Used by Memory + Cache + conversation storage. New exports sub-path `./internal/persistence` declared in T1.1 to allow extracted packages to import (EC-1 absorbed).

## 15. LLM Infrastructure

Provider clients, MCP client, catalog, model identifier parsing.

- **Internal:** `internal/llm/`, `internal/providers/`, `internal/mcp/`, `internal/catalog/`
- **Extractability:** STAY in sdk-core. Foundation for Agent runtime.

## 16. Observability

Telemetry, logging, traceparent propagation, structured logs.

- **Internal:** `internal/observability/`, `internal/telemetry/`
- **Extractability:** STAY in sdk-core. Cross-cutting concern.

## 17. Misc / Types / Security / Personality

Cross-cutting utilities — types/, errors, security, personality, zod helpers, migrate, batch, generate-object, stream-object, path-safety.

- **Public surface:** `types/`, `errors.ts`, `security.ts`, `migrate.ts`, `batch.ts`, `generate-object.ts`, `stream-object.ts`, `path-safety.ts`
- **Internal:** `internal/errors/`, `internal/security/`, `internal/personality/`, `internal/zod/`
- **Extractability:** STAY in sdk-core. Foundational types and utilities required by every consumer.

---

## Cross-import matrix (snapshot)

Agent-loop import surface (from `packages/sdk/src/internal/agent-loop/loop.ts`):

- `UsageAccumulator` from `../budget/usage-accumulator.js` ← **breaks split without ADR D1 inversion**
- `computeCost` from `../budget/compute-cost.js`
- `IterationBudget` from `../runtime/budget.js`

This is the **only** subsystem with hard runtime cross-import into agent-loop. Memory/Cache/Handoff integrate via plugin protocol or types only.

## Verdict — extractability summary

| Subsystem | Verdict | Phase |
|---|---|---|
| Agent | STAY (kernel) | — |
| Memory | EXTRACT | Phase 1 |
| Budget | EXTRACT (with interface inversion) | Phase 2 |
| Cache | EXTRACT | Phase 3 |
| Handoff | EXTRACT | Phase 4 |
| Registry & Plugins | STAY (kernel) | — |
| Cron, Eval, Workflow, Task, Subscription, Server/Auth | STAY (sub-paths) | — |
| Tools | EXTRACT | Phase 5 |
| Persistence, LLM Infra, Observability, Misc | STAY | — |
