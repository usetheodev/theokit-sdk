# `theokit-sdk` packages

This monorepo ships **12 packages** — the Agent-AI **Harness** — organized in **3 families**. The family lets you find a package by what it does, not by alphabetical position.

> **Monorepo cohesion split (2026-06-18, plan `monorepo-cohesion-split`).** The non-Harness clusters were extracted to sibling repos so the SDK is a coherent harness ("LEGO pieces to build any agent"). See the "Extracted to sibling repos" section below.

## Families

### Core — agent runtime + extensions + data layer

| Package | Status | Purpose |
|---|---|---|
| `@theokit/sdk` | **1.9.0** | Agent kernel: `Agent`, `AgentBuilder`, `AgentFactory`, `defineTool`, runtime loop, plugin foundation, persistence primitives, MCP, hooks, providers, subscription/a2a/sandbox/client/server sub-paths. |
| `@theokit/sdk-cache` | **0.1.0** | Semantic LLM response cache. Integrates via Plugin protocol. |
| `@theokit/sdk-tools` | **0.1.0** | Built-in tools (read-file, list-dir, search-text, git-diff, subprocess, run-vitest). |
| `@theokit/sdk-memory` | **0.1.0** | `MemoryProvider` port consumer — markdown store with disk-backed session-summary write/recall + `memory_remember` / `memory_search` tools + agent-scope privacy filter. |
| `@theokit/sdk-budget` | **0.1.0** | `BudgetTracker` port consumer + USD pricing tracker. |
| `@theokit/sdk-handoff` | **0.1.0** | Inter-agent dispatch via plugin protocol. `Handoff.asPlugin()` + lazy-loaded `internal/tool-injector`. |

### Memory adapters — external memory backends

| Package | Purpose |
|---|---|
| `@theokit/memory-honcho` | Honcho.dev memory backend. |
| `@theokit/memory-mem0` | mem0.ai memory backend. |
| `@theokit/memory-supermemory` | supermemory.ai memory backend. |

### Integrations — protocol adapters + tooling

| Package | Purpose |
|---|---|
| `@theokit/acp` | Agent Client Protocol (ACP) server adapter. |
| `@theokit/cli` | `theokit` CLI binary (init, dev, inspect, eval, acp). |
| `@theokit/codemod-sdk-2-0` | **DEPRECATED (archived 2026-07-09)** — codemod for an abandoned `@theokit/sdk` → `@theokit/sdk-core` rename; `@theokit/sdk-core` never shipped (npm 404). Do not use. |
| `@theokit/codemod-sdk-3-0` | Consumer migration codemod for the SDK 2.x → 3.0 SE36 rename (`defineTool`/`createSquad`/… → `X.create`). jscodeshift-based. |
| `@theokit/sdk-peer-integration-tests` | **Private, test-only (not published).** Integration tests for `@theokit/sdk` ↔ `@theokit/sdk-memory` peer routing. Lives outside `@theokit/sdk` so the core does not devDepend on its own satellite (breaks the turbo build-ordering cycle; SE43 DoD#3). |

## Extracted to sibling repos (2026-06-18)

These clusters left the Harness monorepo (history-preserving `git filter-repo`). They consume `@theokit/sdk` as a published npm dependency.

| Cluster | New repo | Packages |
|---|---|---|
| Backend-DX | `theokit-di` | `@theokit/di`, `@theokit/di-agent`, `@theokit/orm` |
| Gateways | `theokit-gateways` | `@theokit/gateway` + `gateway-{telegram,discord,slack,whatsapp,teams,email,sms,line,matrix,mattermost}` |
| React | `theokit-react` | `@theokit/react` |
| RAG | `theokit-rag` | `@theokit/rag` (was `@theokit/sdk/rag`) |
| Voice | `theokit-voice` | `@theokit/voice` (was embedded in the SDK) |
| Skills (Google Workspace) | `theokit-skills-google-workspace` → Skills pillar | `@theokit/skills-google-workspace` |

## SDK 2.0 split status

The earlier "SDK 2.0 package split" extracted the `@theokit/sdk-*` extensions out of the kernel. That work is reflected in the Core family above; the cohesion split (2026-06-18) then removed the non-Harness clusters entirely. Historical status table:

| Phase | Task | Status |
|---|---|---|
| 0 | Baseline subsystem map + bundle snapshot | ✅ DONE |
| 1 | Extract `@theokit/sdk-memory` | ✅ DONE |
| 2 | Extract `@theokit/sdk-budget` | ✅ DONE |
| 3 | Extract `@theokit/sdk-cache` | ✅ DONE |
| 4 | Extract `@theokit/sdk-handoff` | ✅ DONE |
| 5 | Extract `@theokit/sdk-tools` | ✅ DONE |
| 6 | Rename `@theokit/sdk` → `@theokit/sdk-core` | ⏳ deferred (not required by cohesion split) |
| 7 | Cohort bump dependent packages | ⏳ operator step |
| 8 | Codemod jscodeshift | ✅ DONE |
| 9 | Documentation (this file) | ✅ DONE |
| 10 | CI bundle budget gate | ✅ DONE |

## License

Apache-2.0.
