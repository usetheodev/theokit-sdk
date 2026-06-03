# Container Diagram — `runtime` (BASELINE 2026-05-25)

## Top-level containers inside `@theokit/sdk`

| Container | Path | Responsibility | Persistence |
|---|---|---|---|
| Façade | `src/agent.ts` (576 lines) | Public API static class | none |
| Local runtime | `internal/runtime/local-agent*.ts` (8 files) | Send loop, hooks, tools | session store + registry |
| Cloud runtime | `internal/runtime/cloud-*.ts` (4 files) | PaaS delegate | registry only |
| LLM transport | `internal/llm/` (18 files) | Provider clients + routing | none (memory) |
| Tool dispatch | `internal/tool-dispatch/` (4 files) | Validate + execute tool calls | none |
| Persistence | `internal/persistence/` (12 files) | Atomic write, mutex, paths | filesystem |
| Errors | `errors.ts` (337 lines) + `internal/errors/mappers/` | Error hierarchy + provider mapping | none |

## What this plan touches

- **Phase 1** — adds new container `Conversation Storage` (interface + 2 impls inside `internal/persistence/`)
- **Phase 2** — adds new container `Live Agent Registry` (inside `internal/runtime/`, distinct from `agent-registry.ts`)
- **Phase 3** — expands `Errors` container (more codes + computed getters)
- **Phase 4** — wires existing `AbortSignal` from `local-agent` → `real-local-run` → `internal/llm/router.ts`
- **Phase 5** — adds wrapping layer around `internal/tool-dispatch/dispatch.ts`
- **Phase 6** — adds gates in Façade (`Agent.create`) + Local runtime (`agent.send`)
